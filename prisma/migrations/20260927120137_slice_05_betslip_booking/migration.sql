-- CreateTable
CREATE TABLE "betslips" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'REAL',
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "stakeMinor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "betslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "betslip_selections" (
    "id" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "betslip_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceSlipId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "priceBasis" TEXT NOT NULL DEFAULT 'SNAPSHOT_AT_BOOKING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 100,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "booking_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "betslips_userId_state_idx" ON "betslips"("userId", "state");

-- CreateIndex
CREATE INDEX "betslip_selections_slipId_idx" ON "betslip_selections"("slipId");

-- CreateIndex
CREATE INDEX "betslip_selections_eventId_idx" ON "betslip_selections"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "betslip_selections_slipId_marketId_key" ON "betslip_selections"("slipId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "betslip_selections_slipId_outcomeId_key" ON "betslip_selections"("slipId", "outcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_codes_code_key" ON "booking_codes"("code");

-- CreateIndex
CREATE INDEX "booking_codes_createdByUserId_createdAt_idx" ON "booking_codes"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_codes_expiresAt_idx" ON "booking_codes"("expiresAt");

-- AddForeignKey
ALTER TABLE "betslip_selections" ADD CONSTRAINT "betslip_selections_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "betslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_codes" ADD CONSTRAINT "booking_codes_sourceSlipId_fkey" FOREIGN KEY ("sourceSlipId") REFERENCES "betslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
