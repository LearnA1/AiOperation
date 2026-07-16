// DEV-ONLY test route.
//
// Lets you push a fake inbound message through the *real* pipeline
// (extraction -> approval -> action creation -> executor) without needing
// Twilio, Gmail, or PM software credentials. Bypasses only the "how did
// this message arrive" step — everything after that is the real code path.
//
// Not meant to ship to production — there's no auth on this route and it
// creates tenants directly rather than looking them up in a real PMS.

import { Router } from "express";
import { PrismaClient, Channel, MessageSender, ActorType } from "@prisma/client";
import { extractMessage } from "../engine/extraction";
import { decide } from "../engine/approval";
import { executeAction } from "../engine/executor";
import { record } from "../audit/log";
import { POLICY_CONTEXT } from "../policyContext";

const prisma = new PrismaClient();
export const devRouter = Router();

devRouter.post("/simulate-message", async (req, res) => {
  const { tenantName = "Test Tenant", unitNumber = "101", propertyName = "Demo Property", phone = "+15555550100", message } = req.body ?? {};

  if (!message) {
    return res.status(400).json({ error: "Include a 'message' field in the request body." });
  }

  // Find or create the property/unit/tenant directly — standing in for a
  // real PMS connector lookup, since we're bypassing that for this test route.
  let property = await prisma.property.findUnique({ where: { name: propertyName } });
  if (!property) {
    property = await prisma.property.create({ data: { name: propertyName, address: "123 Demo St" } });
  }

  let unit = await prisma.unit.findFirst({ where: { propertyId: property.id, unitNumber } });
  if (!unit) {
    unit = await prisma.unit.create({ data: { propertyId: property.id, unitNumber } });
  }

  let tenant = await prisma.tenant.findFirst({ where: { phone } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { unitId: unit.id, name: tenantName, phone, rent: 1800, dueDay: 1, leaseStart: new Date(), leaseEnd: new Date() },
    });
  }

  const conversation = await prisma.conversation.create({
    data: { tenantId: tenant.id, channel: Channel.SMS, category: "general", status: "OPEN" },
  });

  const savedMessage = await prisma.message.create({
    data: { conversationId: conversation.id, sender: MessageSender.TENANT, body: message, channel: Channel.SMS },
  });

  await record({ actorType: ActorType.SYSTEM, actorId: "dev-simulate-route", action: "message.received", entityType: "Message", entityId: savedMessage.id, afterState: savedMessage });

  const extraction = await extractMessage(message, POLICY_CONTEXT);

  await prisma.conversation.update({ where: { id: conversation.id }, data: { category: extraction.category, urgent: extraction.urgent } });

  const approval = await decide(extraction);

  const action = await prisma.action.create({
    data: {
      conversationId: conversation.id,
      type: extraction.proposedAction.type,
      payload: { to: phone, body: extraction.draftReply },
      confidence: extraction.confidence,
      requiresApproval: approval.requiresApproval,
      forceManual: approval.forceManual,
      forceReason: approval.forceReason,
      status: approval.initialStatus,
    },
  });

  await record({ actorType: ActorType.AI, actorId: "ai-extraction-engine", action: "action.created", entityType: "Action", entityId: action.id, afterState: { ...action, extraction } });

  // If auto-approved, try to execute — but this test route has no real
  // Twilio/Gmail credentials, so we expect this to fail loudly rather than
  // crash the server. That failure itself gets audit-logged, which is
  // useful to see.
  if (action.status === "APPROVED") {
    try {
      await executeAction(action.id);
    } catch (err: any) {
      return res.status(200).json({
        note: "Action was auto-approved and execution was attempted, but failed — expected, since no real Twilio/Gmail credentials are set yet. See the audit log for the failure entry.",
        error: err.message,
        conversationId: conversation.id,
        actionId: action.id,
      });
    }
  }

  res.status(200).json({ conversationId: conversation.id, actionId: action.id, extraction, action });
});