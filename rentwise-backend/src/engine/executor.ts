// Action executor.
//
// The only file in the codebase that calls sendEmailReply(), sendSms(), or
// createServiceRequest(). It only ever runs on Actions whose status is
// APPROVED — never PENDING_APPROVAL. Every attempt, success, and failure
// is written to the audit log.

import { PrismaClient, ActionStatus, ActorType, MessageSender } from "@prisma/client";
import { sendEmailReply } from "../connectors/gmail";
import { sendSms } from "../connectors/twilio";
import { pmsConnector } from "../connectors/pms";
import { record } from "../audit/log";

const prisma = new PrismaClient();

export async function executeAction(actionId: string) {
  const action = await prisma.action.findUniqueOrThrow({
    where: { id: actionId },
    include: { conversation: { include: { tenant: { include: { unit: true } } } } },
  });

  if (action.status !== ActionStatus.APPROVED) {
    throw new Error(`Refusing to execute Action ${actionId}: status is ${action.status}, not APPROVED`);
  }

  try {
    const payload = action.payload as Record<string, any>;

    switch (action.type) {
      case "SEND_REPLY": {
        if (action.conversation.channel === "EMAIL") {
          await sendEmailReply(payload.to, payload.subject ?? "Re: your message", payload.body);
        } else {
          await sendSms(payload.to, payload.body);
        }
        // The dashboard's conversation thread reads from Message, not
        // from Action -- without this, a sent reply would never actually
        // show up in the tenant's message history, only its own draft
        // form pre-send.
        await prisma.message.create({
          data: {
            conversationId: action.conversationId,
            sender: MessageSender.AI,
            body: payload.body,
            channel: action.conversation.channel,
          },
        });
        await prisma.conversation.update({
          where: { id: action.conversationId },
          data: { updatedAt: new Date() },
        });
        break;
      }
      case "NOTIFY_VENDOR": {
        await sendSms(payload.vendorPhone, payload.body);
        break;
      }
      case "CREATE_SERVICE_REQUEST": {
        const tenant = action.conversation.tenant;
        await pmsConnector.createServiceRequest({
          unitPmsId: tenant.unit.pmsId ?? tenant.unit.id,
          category: payload.category,
          description: payload.description,
          urgent: action.conversation.urgent,
        });
        break;
      }
      case "NOTIFY_MANAGER": {
        // Intentionally a no-op integration for now — surfaces only in the
        // manager's queue via GET /api/actions?status=PENDING_APPROVAL.
        break;
      }
    }

    const updated = await prisma.action.update({
      where: { id: actionId },
      data: { status: ActionStatus.EXECUTED, executedAt: new Date() },
    });

    await record({
      actorType: ActorType.SYSTEM,
      actorId: "action-executor",
      action: "action.executed",
      entityType: "Action",
      entityId: actionId,
      beforeState: action,
      afterState: updated,
    });
  } catch (err: any) {
    const updated = await prisma.action.update({
      where: { id: actionId },
      data: { status: ActionStatus.FAILED, failureReason: err.message },
    });

    await record({
      actorType: ActorType.SYSTEM,
      actorId: "action-executor",
      action: "action.failed",
      entityType: "Action",
      entityId: actionId,
      beforeState: action,
      afterState: updated,
    });

    throw err;
  }
}
