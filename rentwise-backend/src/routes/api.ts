// Internal API — this is what the RentWise dashboard (the frontend
// artifact) calls. Every mutating route requires an authenticated manager
// session (auth middleware omitted here for brevity — see README).

import { Router } from "express";
import { PrismaClient, ActionStatus, ActorType, ActionType, TrustLevel, Prisma } from "@prisma/client";
import { executeAction } from "../engine/executor";
import { record } from "../audit/log";
import { getTrail } from "../audit/log";
import { POLICY_CONTEXT } from "../policyContext";

const prisma = new PrismaClient();
export const apiRouter = Router();

// ---- tenants ----
// Powers the dashboard's Tenants roster view. Read-only -- tenants come
// from the PM software via the PMS connector, not created here.

apiRouter.get("/tenants", async (req, res) => {
  const tenants = await prisma.tenant.findMany({
    include: { unit: { include: { property: true } } },
    orderBy: { name: "asc" },
  });
  res.json(tenants);
});

// ---- policy context ----
// Read-only view of the policy text the extraction engine is grounded on.
// Editing it still means editing src/policyContext.ts directly for now --
// this route just makes it visible in the dashboard instead of buried in code.

apiRouter.get("/policy", async (req, res) => {
  res.json({ text: POLICY_CONTEXT });
});

// ---- conversations ----

apiRouter.get("/conversations", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    include: { tenant: { include: { unit: true } }, messages: true, actions: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json(conversations);
});

apiRouter.get("/conversations/:id", async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { tenant: { include: { unit: true } }, messages: { orderBy: { createdAt: "asc" } }, actions: true },
  });
  if (!conversation) return res.status(404).json({ error: "not found" });
  res.json(conversation);
});

// ---- approval queue ----

apiRouter.get("/actions", async (req, res) => {
  const status = (req.query.status as ActionStatus) ?? ActionStatus.PENDING_APPROVAL;
  const actions = await prisma.action.findMany({
    where: { status },
    include: { conversation: { include: { tenant: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(actions);
});

apiRouter.post("/actions/:id/approve", async (req, res) => {
  const managerId = req.header("X-Manager-Id") ?? "unknown-manager";
  const editedBody = req.body?.editedBody as string | undefined;

  const before = await prisma.action.findUniqueOrThrow({ where: { id: req.params.id } });

  const payload = (editedBody ? { ...(before.payload as object), body: editedBody } : before.payload) as Prisma.InputJsonValue;

  const updated = await prisma.action.update({
    where: { id: req.params.id },
    data: { status: ActionStatus.APPROVED, decidedBy: managerId, decidedAt: new Date(), payload },
  });

  await record({
    actorType: ActorType.MANAGER,
    actorId: managerId,
    action: "action.approved",
    entityType: "Action",
    entityId: updated.id,
    beforeState: before,
    afterState: updated,
  });

  await executeAction(updated.id);
  res.json(await prisma.action.findUnique({ where: { id: updated.id } }));
});

apiRouter.post("/actions/:id/reject", async (req, res) => {
  const managerId = req.header("X-Manager-Id") ?? "unknown-manager";
  const before = await prisma.action.findUniqueOrThrow({ where: { id: req.params.id } });

  const updated = await prisma.action.update({
    where: { id: req.params.id },
    data: { status: ActionStatus.REJECTED, decidedBy: managerId, decidedAt: new Date() },
  });

  await record({
    actorType: ActorType.MANAGER,
    actorId: managerId,
    action: "action.rejected",
    entityType: "Action",
    entityId: updated.id,
    beforeState: before,
    afterState: updated,
  });

  res.json(updated);
});

// ---- audit trail ----

apiRouter.get("/audit", async (req, res) => {
  const entries = await getTrail({
    entityType: req.query.entityType as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json(entries);
});

// ---- playbook ----
// One rule per ActionType, each with a live trust lever: AUTOMATE /
// ASK_FIRST / NEVER. This is what a manager actually tunes day to day --
// engine/approval.ts reads these on every Action, so a change here takes
// effect on the very next matching message, nothing to redeploy.

apiRouter.get("/playbook", async (req, res) => {
  const rules = await prisma.playbookRule.findMany({ orderBy: { actionType: "asc" } });
  res.json(rules);
});

apiRouter.put("/playbook/:actionType", async (req, res) => {
  const managerId = req.header("X-Manager-Id") ?? "unknown-manager";
  const actionType = req.params.actionType as ActionType;
  const trustLevel = req.body.trustLevel as TrustLevel;

  if (!Object.values(TrustLevel).includes(trustLevel)) {
    return res.status(400).json({ error: `trustLevel must be one of: ${Object.values(TrustLevel).join(", ")}` });
  }

  const before = await prisma.playbookRule.findUnique({ where: { actionType } });
  if (!before) {
    return res.status(404).json({ error: `No playbook rule exists for action type ${actionType}. Run the seed script first.` });
  }

  const updated = await prisma.playbookRule.update({
    where: { actionType },
    data: { trustLevel },
  });

  await record({
    actorType: ActorType.MANAGER,
    actorId: managerId,
    action: "playbook.updated",
    entityType: "PlaybookRule",
    entityId: updated.id,
    beforeState: before,
    afterState: updated,
  });

  res.json(updated);
});

// ---- automation settings ----

apiRouter.get("/settings", async (req, res) => {
  const settings = await prisma.automationSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  res.json(settings);
});

apiRouter.put("/settings", async (req, res) => {
  const managerId = req.header("X-Manager-Id") ?? "unknown-manager";
  const before = await prisma.automationSettings.findUnique({ where: { id: "singleton" } });

  const updated = await prisma.automationSettings.upsert({
    where: { id: "singleton" },
    update: { mode: req.body.mode, threshold: req.body.threshold },
    create: { id: "singleton", mode: req.body.mode, threshold: req.body.threshold },
  });

  await record({
    actorType: ActorType.MANAGER,
    actorId: managerId,
    action: "settings.updated",
    entityType: "AutomationSettings",
    entityId: "singleton",
    beforeState: before,
    afterState: updated,
  });

  res.json(updated);
});
