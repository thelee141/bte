-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "adjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reversalLedgerTxnId" TEXT,
ADD COLUMN     "supersedesSettlementId" TEXT;

-- Historical Slice 04 settlements were first revisions, so their adjustment
-- from the pre-settlement entitlement of zero equals their full credit.
UPDATE "settlements"
SET "adjustmentMinor" = "creditMinor";

-- CreateIndex
CREATE UNIQUE INDEX "settlements_reversalLedgerTxnId_key" ON "settlements"("reversalLedgerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_supersedesSettlementId_key" ON "settlements"("supersedesSettlementId");

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_reversalLedgerTxnId_fkey" FOREIGN KEY ("reversalLedgerTxnId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_supersedesSettlementId_fkey" FOREIGN KEY ("supersedesSettlementId") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
