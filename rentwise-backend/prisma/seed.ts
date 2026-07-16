// Seeds one PlaybookRule per ActionType. Safe to run repeatedly --
// upserts on actionType, so re-running never overwrites a trust level a
// manager has already changed from the default.
//
// Defaults chosen to mirror Rational's own playbook example, translated
// to property management:
//   - routine, reversible, low-cost actions -> Automate
//   - anything that spends money or touches a vendor -> Ask first
// (Nothing defaults to Never here -- that lever exists for a manager to
// set deliberately once they know which action types they don't want
// the AI touching at all, the same way "send wire transfers" is Never
// in Rational's own accounting playbook.)

import { PrismaClient, ActionType, TrustLevel } from "@prisma/client";

const prisma = new PrismaClient();

const RULES: {
  actionType: ActionType;
  label: string;
  description: string;
  trustLevel: TrustLevel;
}[] = [
  {
    actionType: ActionType.SEND_REPLY,
    label: "Send a drafted reply to a tenant",
    description:
      "Routine tenant replies -- billing questions, general info, acknowledgments. Still gated by the confidence threshold even when set to Automate.",
    trustLevel: TrustLevel.AUTOMATE,
  },
  {
    actionType: ActionType.NOTIFY_MANAGER,
    label: "Notify a manager",
    description: "Purely informational -- surfaces in the manager's queue. Low risk either way.",
    trustLevel: TrustLevel.AUTOMATE,
  },
  {
    actionType: ActionType.CREATE_SERVICE_REQUEST,
    label: "Create a maintenance service request in the PM software",
    description:
      "Opens a real work order against the PM software and can trigger vendor dispatch cost. New or ambiguous requests get a manager's eyes first.",
    trustLevel: TrustLevel.ASK_FIRST,
  },
  {
    actionType: ActionType.NOTIFY_VENDOR,
    label: "Notify a vendor directly",
    description: "Sends an outbound message to a vendor on the manager's behalf.",
    trustLevel: TrustLevel.ASK_FIRST,
  },
];

async function main() {
  for (const rule of RULES) {
    await prisma.playbookRule.upsert({
      where: { actionType: rule.actionType },
      update: {}, // don't clobber a trust level a manager already changed
      create: rule,
    });
  }
  console.log(`Seeded ${RULES.length} playbook rules (existing rows left untouched).`);
}

main()
  .catch((err) => {
    console.error("Playbook seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
