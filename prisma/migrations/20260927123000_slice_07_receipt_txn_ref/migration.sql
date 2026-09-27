-- Add receipt transaction reference without assuming the database has no historical bets.
ALTER TABLE "bets" ADD COLUMN "txnRef" TEXT;

-- Slice 03+ stores the immutable stake ledger transaction with refType=BET
-- and refId=betRef. Backfill any pre-Slice-07 bets from that authoritative record.
UPDATE "bets" AS b
SET "txnRef" = lt."id"
FROM "ledger_transactions" AS lt
WHERE lt."refType" = 'BET'
  AND lt."refId" = b."betRef"
  AND b."txnRef" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bets" WHERE "txnRef" IS NULL) THEN
    RAISE EXCEPTION 'Cannot add bets.txnRef: one or more historical bets have no matching BET ledger transaction';
  END IF;
END $$;

ALTER TABLE "bets" ALTER COLUMN "txnRef" SET NOT NULL;

CREATE UNIQUE INDEX "bets_txnRef_key" ON "bets"("txnRef");
