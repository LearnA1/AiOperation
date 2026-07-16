/*
  Warnings:

  - A unique constraint covering the columns `[pmsId]` on the table `Property` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Property_pmsId_key" ON "Property"("pmsId");
