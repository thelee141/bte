-- CreateTable
CREATE TABLE "bets" (
    "id" TEXT NOT NULL,
    "betRef" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "stakeMinor" INTEGER NOT NULL,
    "totalOdds" TEXT NOT NULL,
    "potentialWinMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bet_legs" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "priceVersion" INTEGER NOT NULL,
    "decimalOdds" TEXT NOT NULL,
    "marketVersion" INTEGER NOT NULL,
    "marketState" TEXT NOT NULL,
    "outcomeState" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bet_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bets_betRef_key" ON "bets"("betRef");

-- CreateIndex
CREATE UNIQUE INDEX "bets_idempotencyKey_key" ON "bets"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bets_userId_idx" ON "bets"("userId");

-- CreateIndex
CREATE INDEX "bets_walletAccountId_idx" ON "bets"("walletAccountId");

-- CreateIndex
CREATE INDEX "bet_legs_betId_idx" ON "bet_legs"("betId");

-- CreateIndex
CREATE INDEX "bet_legs_eventId_idx" ON "bet_legs"("eventId");

-- CreateIndex
CREATE INDEX "bet_legs_marketId_idx" ON "bet_legs"("marketId");

-- CreateIndex
CREATE INDEX "bet_legs_outcomeId_idx" ON "bet_legs"("outcomeId");

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_betId_fkey" FOREIGN KEY ("betId") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
