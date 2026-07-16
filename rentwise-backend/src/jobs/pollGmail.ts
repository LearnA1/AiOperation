// Runs on a schedule (e.g. every 60s via node-cron, or a serverless cron
// trigger) and feeds new emails through the exact same pipeline the
// Twilio webhook uses, so there is only one extraction/approval/executor
// path for both channels.

import { PrismaClient, Channel, MessageSender, ActorType } from "@prisma/client";
import { fetchNewEmails } from "../connectors/gmail";
import { pmsConnector } from "../connectors/pms";
import { extractMessage } from "../engine/extraction";
import { decide } from "../engine/approval";
import { executeAction } from "../engine/executor";
import { record } from "../audit/log";
import { POLICY_CONTEXT } from "../policyContext";

const prisma = new PrismaClient();

export async function pollGmailOnce() {
  const emails = await fetchNewEmails();

  for (const email of emails) {
    const tenantRecord = await pmsConnector.findTenantByContact({ email: email.fromEmail });
    if (!tenantRecord) {
      await record({ actorType: ActorType.SYSTEM, actorId: "gmail-poll", action: "message.unmatched_sender", entityType: "Message", entityId: email.externalId, afterState: email });
      continue;
    }

    const tenant = await prisma.tenant.findFirst({ where: { pmsId: tenantRecord.pmsId } });
    if (!tenant) continue;

    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: Channel.EMAIL, category: "general", status: "OPEN" },
    });

    const message = await prisma.message.create({
      data: { conversationId: conversation.id, sender: MessageSender.TENANT, body: email.body, channel: Channel.EMAIL, externalId: email.externalId },
    });

    await record({ actorType: ActorType.SYSTEM, actorId: "gmail-poll", action: "message.received", entityType: "Message", entityId: message.id, afterState: message });

    const extraction = await extractMessage(email.body, POLICY_CONTEXT);

    await prisma.conversation.update({ where: { id: conversation.id }, data: { category: extraction.category, urgent: extraction.urgent } });

    const approval = await decide(extraction);

    const action = await prisma.action.create({
      data: {
        conversationId: conversation.id,
        type: extraction.proposedAction.type,
        payload: { to: tenant.email ?? tenant.phone, subject: `Re: ${email.subject}`, body: extraction.draftReply },
        confidence: extraction.confidence,
        requiresApproval: approval.requiresApproval,
        forceManual: approval.forceManual,
        forceReason: approval.forceReason,
        status: approval.initialStatus,
      },
    });

    await record({ actorType: ActorType.AI, actorId: "ai-extraction-engine", action: "action.created", entityType: "Action", entityId: action.id, afterState: { ...action, extraction } });

    if (action.status === "APPROVED") {
      await executeAction(action.id);
    }
  }
}
