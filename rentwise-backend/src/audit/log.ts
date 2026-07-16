// Audit log.
//
// Append-only, on purpose — no update() or delete() exported from this
// file. Every write anywhere in the system (a message arriving, an action
// being created, a manager approving or rejecting, an action executing or
// failing) goes through record() so there is one place a manager or an
// auditor can see the full history of what the AI did and why.

import { PrismaClient, ActorType } from "@prisma/client";

const prisma = new PrismaClient();

export async function record(entry: {
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: unknown;
  afterState?: unknown;
}) {
  await prisma.auditLogEntry.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeState: entry.beforeState ? JSON.parse(JSON.stringify(entry.beforeState)) : undefined,
      afterState: entry.afterState ? JSON.parse(JSON.stringify(entry.afterState)) : undefined,
    },
  });
}

export async function getTrail(filters: { conversationId?: string; entityType?: string; limit?: number }) {
  return prisma.auditLogEntry.findMany({
    where: {
      entityType: filters.entityType,
      // When filtering by conversation, callers pass entityId sets in via entityType="Action"/"Message"
      // scoped elsewhere — kept simple here since this is a thin read layer over one table.
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });
}
