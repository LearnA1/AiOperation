-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('AUTOMATE', 'ASK_FIRST', 'NEVER');

-- CreateTable
CREATE TABLE "PlaybookRule" (
    "id" TEXT NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "trustLevel" "TrustLevel" NOT NULL DEFAULT 'ASK_FIRST',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybookRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookRule_actionType_key" ON "PlaybookRule"("actionType");
