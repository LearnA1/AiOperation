// Inbound webhook routes.
//
// This is the full pipeline for a single message, start to finish:
//   1. verify + normalize (connector)
//   2. find the tenant, create/reuse the Conversation, store the Message
//   3. extract structured meaning (engine/extraction)
//   4. decide auto vs. needs-approval (engine/approval)
//   5. create the Action
//   6. if approved, execute immediately (engine/executor)
//   7. audit-log every step
//
// Gmail uses a poll loop (see src/jobs/pollGmail.ts, called on a schedule)
// instead of a webhook, since Gmail push notifications require Cloud
// Pub/Sub setup that's out of scope for a first pilot.

import { Router } from "express";
import { PrismaClient, Channel, MessageSender, ActorType } from "@prisma/client";
import { verifyAndParseWebhook } from "../connectors/twilio";
import { pmsConnector } from "../connectors/pms";
import { extractMessage } from "../engine/extraction";
import { decide } from "../engine/approval";
import { executeAction } from "../engine/executor";
import { record } from "../audit/log";
import { POLICY_CONTEXT } from "../policyContext";

const prisma = new PrismaClient();
export const webhookRouter = Router();

webhookRouter.post("/twilio", async (req, res) => {
  const inbound = verifyAndParseWebhook(req);
  if (!inbound) {
    return res.status(403).send("Invalid Twilio signature");
  }

  // 1. Identify the tenant via the PM software — this is why the PMS
  // connector needs read access even before any write access is set up.
  const tenantRecord = await pmsConnector.findTenantByContact({ phone: inbound.fromPhone });
  const tenant = tenantRecord
  ? await prisma.tenant.upsert({
      where: { pmsId: tenantRecord.pmsId },
      update: {},
      create: {
        pmsId: tenantRecord.pmsId,
        name: tenantRecord.name,
        phone: tenantRecord.phone,
        email: tenantRecord.email,
        rent: 0,
        dueDay: 1,
        leaseStart: new Date(),
        leaseEnd: new Date(),
        unit: {
          connectOrCreate: {
            where: { pmsId: tenantRecord.unitPmsId },
            create: {
              pmsId: tenantRecord.unitPmsId,
              unitNumber: tenantRecord.unitNumber,
              property: {
                connectOrCreate: {
                  where: { pmsId: tenantRecord.propertyPmsId },
                  create: { pmsId: tenantRecord.propertyPmsId, name: tenantRecord.propertyName, address: "" },
                },
              },
            },
          },
        },
      },
    })
  : null;

  if (!tenant) {
    // Couldn't match the phone number to a known tenant — always a
    // human-review case, never a silent drop.
    await record({ actorType: ActorType.SYSTEM, actorId: "twilio-webhook", action: "message.unmatched_sender", entityType: "Message", entityId: inbound.externalId, afterState: inbound });
    return res.status(200).send("<Response></Response>"); // ack to Twilio; manager gets an unmatched-sender alert separately
  }

  const conversation = await prisma.conversation.create({
    data: { tenantId: tenant.id, channel: Channel.SMS, category: "general", status: "OPEN" },
  });

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      sender: MessageSender.TENANT,
      body: inbound.body,
      channel: Channel.SMS,
      externalId: inbound.externalId,
    },
  });

  await record({ actorType: ActorType.SYSTEM, actorId: "twilio-webhook", action: "message.received", entityType: "Message", entityId: message.id, afterState: message });

  // 3. Understand it.
  const extraction = await extractMessage(inbound.body, POLICY_CONTEXT);

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { category: extraction.category, urgent: extraction.urgent },
  });

  // 4 + 5. Decide, then create the Action record either way.
  const approval = await decide(extraction);

  const action = await prisma.action.create({
    data: {
      conversationId: conversation.id,
      type: extraction.proposedAction.type,
      payload: buildPayload(extraction, tenant),
      confidence: extraction.confidence,
      requiresApproval: approval.requiresApproval,
      forceManual: approval.forceManual,
      forceReason: approval.forceReason,
      status: approval.initialStatus,
    },
  });

  await record({
    actorType: ActorType.AI,
    actorId: "ai-extraction-engine",
    action: "action.created",
    entityType: "Action",
    entityId: action.id,
    afterState: { ...action, extraction },
  });

  // 6. If it was auto-approved, execute right away. If not, it just sits
  // in the manager's queue (GET /api/actions?status=PENDING_APPROVAL) until
  // someone approves, edits, or dismisses it.
  if (action.status === "APPROVED") {
    await executeAction(action.id);
  }

  res.status(200).send("<Response></Response>");
});

function buildPayload(extraction: Awaited<ReturnType<typeof extractMessage>>, tenant: { phone: string | null; email: string | null }) {
  if (extraction.proposedAction.type === "CREATE_SERVICE_REQUEST") {
    return { category: extraction.proposedAction.vendorCategory, description: extraction.draftReply, to: tenant.phone, body: extraction.draftReply };
  }
  return { to: tenant.phone ?? tenant.email, body: extraction.draftReply };
}
