-- AlterTable
ALTER TABLE "bet_legs" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "resultVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "creditMinor" INTEGER NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "ledgerTxnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_legs" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "betLegId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlements_ledgerTxnId_key" ON "settlements"("ledgerTxnId");

-- CreateIndex
CREATE INDEX "settlements_betId_createdAt_idx" ON "settlements"("betId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_betId_resultVersion_key" ON "settlements"("betId", "resultVersion");

-- CreateIndex
CREATE INDEX "settlement_legs_betLegId_idx" ON "settlement_legs"("betLegId");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_legs_settlementId_betLegId_key" ON "settlement_legs"("settlementId", "betLegId");

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_betId_fkey" FOREIGN KEY ("betId") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_ledgerTxnId_fkey" FOREIGN KEY ("ledgerTxnId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_legs" ADD CONSTRAINT "settlement_legs_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_legs" ADD CONSTRAINT "settlement_legs_betLegId_fkey" FOREIGN KEY ("betLegId") REFERENCES "bet_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
