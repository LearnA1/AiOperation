// Approval engine.
//
// Every Action passes through here exactly once, right after it's created.
//
// Decision order:
//   1. safetyCritical always wins -- PENDING_APPROVAL, no exceptions.
//   2. A PlaybookRule for this Action's type, if one exists:
//        NEVER      -> always PENDING_APPROVAL, forceManual (mirrors
//                      Rational's "send wire transfers -> Never": some
//                      actions never run without a person doing them)
//        ASK_FIRST  -> always PENDING_APPROVAL
//        AUTOMATE   -> auto-approved, but still gated by the confidence
//                      threshold as a safety net -- "automate" doesn't
//                      mean "never look," it means "don't wait on a
//                      routine case the AI is confident about."
//   3. No PlaybookRule row yet for this type -- fall back to the
//      original global mode/threshold behavior, unchanged. This keeps
//      the engine additive: nothing breaks before the playbook is seeded.

import { PrismaClient, ActionStatus, ActionType } from "@prisma/client";
import type { ExtractionResult } from "./extraction";

const prisma = new PrismaClient();

export interface ApprovalDecision {
  requiresApproval: boolean;
  forceManual: boolean;
  forceReason?: string;
  initialStatus: ActionStatus;
}

export async function decide(extraction: ExtractionResult): Promise<ApprovalDecision> {
  if (extraction.safetyCritical) {
    return {
      requiresApproval: true,
      forceManual: true,
      forceReason: "Safety-critical reports always require manager review, regardless of automation settings.",
      initialStatus: ActionStatus.PENDING_APPROVAL,
    };
  }

  const rule = await prisma.playbookRule.findUnique({
    where: { actionType: extraction.proposedAction.type as ActionType },
  });

  if (rule) {
    return decideFromPlaybookRule(extraction, rule.trustLevel, rule.label);
  }

  return decideFromGlobalMode(extraction);
}

async function decideFromPlaybookRule(
  extraction: ExtractionResult,
  trustLevel: "AUTOMATE" | "ASK_FIRST" | "NEVER",
  ruleLabel: string
): Promise<ApprovalDecision> {
  if (trustLevel === "NEVER") {
    return {
      requiresApproval: true,
      forceManual: true,
      forceReason: `Playbook rule "${ruleLabel}" is set to Never -- this action always requires a manager.`,
      initialStatus: ActionStatus.PENDING_APPROVAL,
    };
  }

  if (trustLevel === "ASK_FIRST") {
    return {
      requiresApproval: true,
      forceManual: false,
      initialStatus: ActionStatus.PENDING_APPROVAL,
    };
  }

  // AUTOMATE -- still respect the confidence threshold as a safety net.
  const settings = await prisma.automationSettings.findUnique({ where: { id: "singleton" } });
  const threshold = settings?.threshold ?? 70;
  const requiresApproval = extraction.confidence < threshold;

  return {
    requiresApproval,
    forceManual: false,
    initialStatus: requiresApproval ? ActionStatus.PENDING_APPROVAL : ActionStatus.APPROVED,
  };
}

async function decideFromGlobalMode(extraction: ExtractionResult): Promise<ApprovalDecision> {
  const settings = await prisma.automationSettings.findUnique({ where: { id: "singleton" } });
  const mode = settings?.mode ?? "confidence";
  const threshold = settings?.threshold ?? 70;

  let requiresApproval: boolean;
  if (mode === "manual") requiresApproval = true;
  else if (mode === "autonomous") requiresApproval = false;
  else requiresApproval = extraction.confidence < threshold;

  return {
    requiresApproval,
    forceManual: false,
    initialStatus: requiresApproval ? ActionStatus.PENDING_APPROVAL : ActionStatus.APPROVED,
  };
}
