import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { BettingService } from "../src/betting/service.js";
import type { AcceptedBet } from "../src/betting/types.js";
import { SettlementService } from "../src/settlement/service.js";
import { FixtureSportsProvider } from "../src/sports/provider.js";
import { MarketState } from "../src/sports/types.js";
import type { CanonicalMarket, CanonicalPrice } from "../src/sports/types.js";
import { FundingService } from "../src/wallet/funding.js";
import { LedgerService } from "../src/wallet/ledger.js";
import { calculatePotentialWin, toMinorUnits } from "../src/wallet/money.js";
import { cleanDatabase } from "./helpers/db.js";

const prisma = new PrismaClient();
const ledger = new LedgerService(prisma);
const funding = new FundingService(prisma, ledger);
const provider = new FixtureSportsProvider("settlement-test-seed");
const betting = new BettingService({ prisma, ledger, funding, provider });
const settlement = new SettlementService({ prisma, ledger });

beforeEach(async () => {
  await cleanDatabase(prisma);
  await ledger.ensureSystemAccounts();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueKey(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

async function setupUserWithBalance(amount: string): Promise<string> {
  const userId = `user_${randomUUID()}`;
  await ledger.createAccount(userId, "REAL", "NGN");
  await funding.grantPlayMoney({
    userId,
    amount: toMinorUnits(amount),
    idempotencyKey: uniqueKey("grant"),
  });
  return userId;
}

async function openLegs(count: number): Promise<
  Array<{
    eventId: string;
    marketId: string;
    outcomeId: string;
    price: CanonicalPrice;
    market: CanonicalMarket;
  }>
> {
  const events = await provider.listEvents();
  const result: Array<{
    eventId: string;
    marketId: string;
    outcomeId: string;
    price: CanonicalPrice;
    market: CanonicalMarket;
  }> = [];

  for (const event of events) {
    const markets = await provider.listMarkets(event.id);
    const market = markets.find((candidate) => candidate.state === MarketState.OPEN);
    if (!market) continue;
    const outcome = market.outcomes.find((candidate) => candidate.state === MarketState.OPEN);
    if (!outcome) continue;
    const prices = await provider.getPrices(outcome.id);
    const price = [...prices].sort((a, b) => b.version - a.version)[0];
    if (!price) continue;
    result.push({
      eventId: event.id,
      marketId: market.id,
      outcomeId: outcome.id,
      price,
      market,
    });
    if (result.length === count) break;
  }

  if (result.length !== count) throw new Error(`Need ${count} open fixture legs, got ${result.length}`);
  return result;
}

async function placeFixtureBet(userId: string, legCount = 1, stake = "10.00"): Promise<AcceptedBet> {
  const legs = await openLegs(legCount);
  return betting.placeBet({
    userId,
    idempotencyKey: uniqueKey("bet"),
    stakeMinor: toMinorUnits(stake),
    legs: legs.map((leg) => ({
      eventId: leg.eventId,
      marketId: leg.marketId,
      outcomeId: leg.outcomeId,
      expectedPriceVersion: leg.price.version,
      expectedDecimalOdds: leg.price.decimalOdds,
    })),
  });
}

async function userBalance(userId: string): Promise<number> {
  const account = await prisma.walletAccount.findFirst({
    where: { userId, kind: "REAL", currency: "NGN" },
  });
  if (!account) throw new Error("user wallet missing");
  return ledger.getBalance(account.id);
}

describe("settlement engine", () => {
  it("settles a winning single atomically and credits the accepted payout", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);

    const result = await settlement.settleBet({
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "WON" }],
    });

    expect(result.outcome).toBe("WON");
    expect(result.creditMinor).toBe(bet.potentialWinMinor);
    expect(result.ledgerTxnId).not.toBeNull();
    expect(await userBalance(userId)).toBe(9000 + bet.potentialWinMinor);

    const storedBet = await prisma.bet.findUnique({
      where: { id: bet.id },
      include: { legs: true, settlements: true },
    });
    expect(storedBet?.status).toBe("SETTLED");
    expect(storedBet?.settledAt).not.toBeNull();
    expect(storedBet?.legs[0].status).toBe("WON");
    expect(storedBet?.settlements).toHaveLength(1);
  });

  it("settles a lost bet without creating a payout transaction", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);

    const result = await settlement.settleBet({
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "LOST" }],
    });

    expect(result.outcome).toBe("LOST");
    expect(result.creditMinor).toBe(0);
    expect(result.ledgerTxnId).toBeNull();
    expect(await userBalance(userId)).toBe(9000);
    expect(await prisma.ledgerTransaction.count({ where: { refType: "BET_SETTLEMENT" } })).toBe(0);
  });

  it("refunds the original stake when every leg is void", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);

    const result = await settlement.settleBet({
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "VOID" }],
    });

    expect(result.outcome).toBe("VOID");
    expect(result.creditMinor).toBe(bet.stakeMinor);
    expect(await userBalance(userId)).toBe(10000);

    const txn = await prisma.ledgerTransaction.findUnique({
      where: { id: result.ledgerTxnId ?? "" },
    });
    expect(txn?.kind).toBe("STAKE_REFUND");
  });

  it("drops void legs from a winning multiple and recalculates payout from accepted odds", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId, 2);

    const wonLeg = bet.legs[0];
    const voidLeg = bet.legs[1];
    const expectedCredit = calculatePotentialWin(toMinorUnits("10.00"), wonLeg.decimalOdds);

    const result = await settlement.settleBet({
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [
        { betLegId: wonLeg.id, outcome: "WON" },
        { betLegId: voidLeg.id, outcome: "VOID" },
      ],
    });

    expect(result.outcome).toBe("PARTIAL_VOID");
    expect(result.creditMinor).toBe(expectedCredit);
    expect(await userBalance(userId)).toBe(9000 + expectedCredit);
  });

  it("replays the same settlement idempotently without double credit", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);
    const input = {
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "WON" as const }],
    };

    const first = await settlement.settleBet(input);
    const balanceAfterFirst = await userBalance(userId);
    const second = await settlement.settleBet(input);

    expect(second.settlementId).toBe(first.settlementId);
    expect(second.ledgerTxnId).toBe(first.ledgerTxnId);
    expect(await userBalance(userId)).toBe(balanceAfterFirst);
    expect(
      await prisma.ledgerTransaction.count({
        where: { idempotencyKey: `settlement_${bet.id}_1` },
      }),
    ).toBe(1);
  });

  it("rejects different decisions for an already-used result version", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);

    await settlement.settleBet({
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "WON" }],
    });

    await expect(
      settlement.settleBet({
        betId: bet.id,
        resultVersion: 1,
        source: "fixture-result",
        legs: [{ betLegId: bet.legs[0].id, outcome: "LOST" }],
      }),
    ).rejects.toMatchObject({ code: "RESULT_CONFLICT" });
  });

  it("requires the complete set of bet legs and rejects foreign leg ids", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId, 2);

    await expect(
      settlement.settleBet({
        betId: bet.id,
        resultVersion: 1,
        source: "fixture-result",
        legs: [{ betLegId: bet.legs[0].id, outcome: "WON" }],
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE_RESULT" });

    await expect(
      settlement.settleBet({
        betId: bet.id,
        resultVersion: 1,
        source: "fixture-result",
        legs: [
          { betLegId: bet.legs[0].id, outcome: "WON" },
          { betLegId: "foreign_leg", outcome: "WON" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_LEG_RESULT" });
  });

  it("rejects a higher result version until explicit resettlement support is invoked", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);

    await settlement.settleBet({
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "WON" }],
    });

    await expect(
      settlement.settleBet({
        betId: bet.id,
        resultVersion: 2,
        source: "fixture-correction",
        legs: [{ betLegId: bet.legs[0].id, outcome: "LOST" }],
      }),
    ).rejects.toMatchObject({ code: "RESETTLEMENT_REQUIRED" });
  });

  it("handles concurrent identical settlement requests without double credit", async () => {
    const userId = await setupUserWithBalance("100.00");
    const bet = await placeFixtureBet(userId);
    const input = {
      betId: bet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: bet.legs[0].id, outcome: "WON" as const }],
    };

    const [first, second] = await Promise.all([
      settlement.settleBet(input),
      settlement.settleBet(input),
    ]);

    expect(first.settlementId).toBe(second.settlementId);
    expect(await userBalance(userId)).toBe(9000 + bet.potentialWinMinor);
    expect(await prisma.settlement.count({ where: { betId: bet.id } })).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({
        where: { idempotencyKey: `settlement_${bet.id}_1` },
      }),
    ).toBe(1);
  });

  it("lists open and settled bet history independently", async () => {
    const userId = await setupUserWithBalance("200.00");
    const settledBet = await placeFixtureBet(userId);
    const openBet = await placeFixtureBet(userId);

    await settlement.settleBet({
      betId: settledBet.id,
      resultVersion: 1,
      source: "fixture-result",
      legs: [{ betLegId: settledBet.legs[0].id, outcome: "LOST" }],
    });

    const open = await settlement.listBetHistory(userId, { state: "OPEN" });
    const settled = await settlement.listBetHistory(userId, { state: "SETTLED" });
    const all = await settlement.listBetHistory(userId);

    expect(open.map((item) => item.betId)).toContain(openBet.id);
    expect(open.map((item) => item.betId)).not.toContain(settledBet.id);
    expect(settled).toHaveLength(1);
    expect(settled[0].betId).toBe(settledBet.id);
    expect(settled[0].settlement?.outcome).toBe("LOST");
    expect(all).toHaveLength(2);
  });
});
