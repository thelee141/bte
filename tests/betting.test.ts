import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FixtureSportsProvider } from "../src/sports/provider.js";
import { MarketState } from "../src/sports/types.js";
import type { SportsProvider, CanonicalMarket, CanonicalPrice, CanonicalEvent, CanonicalSport, EventFilter } from "../src/sports/types.js";
import { LedgerService } from "../src/wallet/ledger.js";
import { FundingService } from "../src/wallet/funding.js";
import { BettingService } from "../src/betting/service.js";
import { toMinorUnits } from "../src/wallet/money.js";
import type { AcceptedBet } from "../src/betting/types.js";

const prisma = new PrismaClient();
const ledger = new LedgerService(prisma);
const funding = new FundingService(prisma, ledger);

function uniqueUserId(): string {
  return `user_${randomUUID()}`;
}

function uniqueKey(): string {
  return `key_${randomUUID()}`;
}

// Test provider wrapper that can simulate suspended and price bumps
class TestProvider implements SportsProvider {
  public readonly providerId = "test-provider";
  private base = new FixtureSportsProvider("betting-test-seed");
  private suspendedMarkets = new Set<string>();
  private suspendedOutcomes = new Set<string>();
  private priceBumpOutcomes = new Set<string>();

  suspendMarket(marketId: string) {
    this.suspendedMarkets.add(marketId);
  }
  suspendOutcome(outcomeId: string) {
    this.suspendedOutcomes.add(outcomeId);
  }
  bumpPrice(outcomeId: string) {
    this.priceBumpOutcomes.add(outcomeId);
  }
  clear() {
    this.suspendedMarkets.clear();
    this.suspendedOutcomes.clear();
    this.priceBumpOutcomes.clear();
  }

  async listSports(): Promise<CanonicalSport[]> {
    return this.base.listSports();
  }
  async listEvents(filter?: EventFilter): Promise<CanonicalEvent[]> {
    return this.base.listEvents(filter);
  }
  async getEvent(eventId: string): Promise<CanonicalEvent | null> {
    return this.base.getEvent(eventId);
  }
  async listMarkets(eventId: string): Promise<CanonicalMarket[]> {
    const markets = await this.base.listMarkets(eventId);
    return markets.map((m) => {
      let state = m.state;
      if (this.suspendedMarkets.has(m.id)) state = MarketState.SUSPENDED;
      const outcomes = m.outcomes.map((o) => {
        let oState = o.state;
        if (this.suspendedOutcomes.has(o.id)) oState = MarketState.SUSPENDED;
        if (this.suspendedMarkets.has(m.id)) oState = MarketState.SUSPENDED;
        return { ...o, state: oState };
      });
      return { ...m, state, outcomes };
    });
  }
  async getPrices(outcomeId: string): Promise<CanonicalPrice[]> {
    const prices = await this.base.getPrices(outcomeId);
    if (!this.priceBumpOutcomes.has(outcomeId)) return prices;
    const latest = [...prices].sort((a, b) => b.version - a.version)[0];
    const bumped: CanonicalPrice = {
      ...latest,
      id: `${latest.id}_bumped`,
      version: latest.version + 1,
      decimalOdds: latest.decimalOdds === "1.38" ? "1.50" : "1.38",
      validFrom: new Date().toISOString(),
      validTo: null,
    };
    return [...prices, bumped].sort((a, b) => a.version - b.version);
  }
}

const testProvider = new TestProvider();

beforeEach(async () => {
  await prisma.$transaction([
    prisma.betLeg.deleteMany({}),
    prisma.bet.deleteMany({}),
    prisma.ledgerEntry.deleteMany({}),
    prisma.ledgerTransaction.deleteMany({}),
    prisma.walletAccount.deleteMany({
      where: {
        userId: {
          notIn: ["system_play_mint", "system_stake_pool"],
        },
      },
    }),
  ]);
  await ledger.ensureSystemAccounts();
  testProvider.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupUserWithBalance(amountStr: string): Promise<{ userId: string; accountId: string }> {
  const userId = uniqueUserId();
  const acc = await ledger.createAccount(userId, "REAL", "NGN");
  await funding.grantPlayMoney({
    userId,
    amount: toMinorUnits(amountStr),
    idempotencyKey: uniqueKey(),
  });
  return { userId, accountId: acc.id };
}

async function getFirstOpenLeg(): Promise<{ eventId: string; marketId: string; outcomeId: string; price: CanonicalPrice; market: CanonicalMarket }> {
  const events = await testProvider.listEvents();
  const ev = events[0];
  const markets = await testProvider.listMarkets(ev.id);
  const market = markets.find((m) => m.state === MarketState.OPEN);
  if (!market) throw new Error("No open market");
  const outcome = market.outcomes.find((o) => o.state === MarketState.OPEN);
  if (!outcome) throw new Error("No open outcome");
  const prices = await testProvider.getPrices(outcome.id);
  const latest = [...prices].sort((a, b) => b.version - a.version)[0];
  return { eventId: ev.id, marketId: market.id, outcomeId: outcome.id, price: latest, market };
}

describe("betting placement", () => {
  it("successful placement with immutable snapshots", async () => {
    const { userId } = await setupUserWithBalance("100.00");
    const legInfo = await getFirstOpenLeg();
    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });

    const stake = toMinorUnits("10.00");
    const bet = await betting.placeBet({
      userId,
      idempotencyKey: uniqueKey(),
      stakeMinor: stake,
      legs: [
        {
          eventId: legInfo.eventId,
          marketId: legInfo.marketId,
          outcomeId: legInfo.outcomeId,
          expectedPriceVersion: legInfo.price.version,
          expectedDecimalOdds: legInfo.price.decimalOdds,
        },
      ],
    });

    expect(bet.stakeMinor).toBe(1000);
    expect(bet.legs).toHaveLength(1);
    expect(bet.legs[0].priceVersion).toBe(legInfo.price.version);
    expect(bet.legs[0].decimalOdds).toBe(legInfo.price.decimalOdds);
    expect(bet.legs[0].marketVersion).toBe(legInfo.market.version);
    expect(bet.totalOdds).toBe(legInfo.price.decimalOdds);
    expect(bet.potentialWinMinor).toBeGreaterThan(0);

    const walletAcc = await prisma.walletAccount.findFirst({ where: { userId } });
    if (!walletAcc) throw new Error("wallet not found");
    const balance = await ledger.getBalance(walletAcc.id);
    expect(balance).toBe(9000);

    const stored = await prisma.bet.findUnique({ where: { id: bet.id }, include: { legs: true } });
    expect(stored).not.toBeNull();
    expect(stored!.legs[0].decimalOdds).toBe(legInfo.price.decimalOdds);
  });

  it("idempotent replay returns same bet without double debit", async () => {
    const { userId } = await setupUserWithBalance("50.00");
    const legInfo = await getFirstOpenLeg();
    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });
    const idemKey = uniqueKey();
    const stake = toMinorUnits("10.00");

    const bet1 = await betting.placeBet({
      userId,
      idempotencyKey: idemKey,
      stakeMinor: stake,
      legs: [
        {
          eventId: legInfo.eventId,
          marketId: legInfo.marketId,
          outcomeId: legInfo.outcomeId,
          expectedPriceVersion: legInfo.price.version,
          expectedDecimalOdds: legInfo.price.decimalOdds,
        },
      ],
    });

    const bet2 = await betting.placeBet({
      userId,
      idempotencyKey: idemKey,
      stakeMinor: stake,
      legs: [
        {
          eventId: legInfo.eventId,
          marketId: legInfo.marketId,
          outcomeId: legInfo.outcomeId,
          expectedPriceVersion: legInfo.price.version,
          expectedDecimalOdds: legInfo.price.decimalOdds,
        },
      ],
    });

    expect(bet2.id).toBe(bet1.id);
    expect(bet2.betRef).toBe(bet1.betRef);

    const walletAcc = await prisma.walletAccount.findFirst({ where: { userId } });
    if (!walletAcc) throw new Error("wallet not found");
    const balance = await ledger.getBalance(walletAcc.id);
    expect(balance).toBe(4000);

    const betCount = await prisma.bet.count({ where: { idempotencyKey: idemKey } });
    expect(betCount).toBe(1);
    const ledgerCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `bet_${idemKey}` } });
    expect(ledgerCount).toBe(1);
  });

  it("insufficient funds is rejected", async () => {
    const { userId } = await setupUserWithBalance("5.00");
    const legInfo = await getFirstOpenLeg();
    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });

    await expect(
      betting.placeBet({
        userId,
        idempotencyKey: uniqueKey(),
        stakeMinor: toMinorUnits("10.00"),
        legs: [
          {
            eventId: legInfo.eventId,
            marketId: legInfo.marketId,
            outcomeId: legInfo.outcomeId,
            expectedPriceVersion: legInfo.price.version,
            expectedDecimalOdds: legInfo.price.decimalOdds,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });

    const betCount = await prisma.bet.count();
    expect(betCount).toBe(0);
    const walletAcc = await prisma.walletAccount.findFirst({ where: { userId } });
    if (!walletAcc) throw new Error("wallet not found");
    const balance = await ledger.getBalance(walletAcc.id);
    expect(balance).toBe(500);
  });

  it("suspended market is rejected", async () => {
    const { userId } = await setupUserWithBalance("100.00");
    const legInfo = await getFirstOpenLeg();
    testProvider.suspendMarket(legInfo.marketId);

    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });

    await expect(
      betting.placeBet({
        userId,
        idempotencyKey: uniqueKey(),
        stakeMinor: toMinorUnits("10.00"),
        legs: [
          {
            eventId: legInfo.eventId,
            marketId: legInfo.marketId,
            outcomeId: legInfo.outcomeId,
            expectedPriceVersion: legInfo.price.version,
            expectedDecimalOdds: legInfo.price.decimalOdds,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "SUSPENDED" });

    const betCount = await prisma.bet.count();
    expect(betCount).toBe(0);
  });

  it("suspended outcome is rejected", async () => {
    const { userId } = await setupUserWithBalance("100.00");
    const legInfo = await getFirstOpenLeg();
    testProvider.suspendOutcome(legInfo.outcomeId);

    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });

    await expect(
      betting.placeBet({
        userId,
        idempotencyKey: uniqueKey(),
        stakeMinor: toMinorUnits("10.00"),
        legs: [
          {
            eventId: legInfo.eventId,
            marketId: legInfo.marketId,
            outcomeId: legInfo.outcomeId,
            expectedPriceVersion: legInfo.price.version,
            expectedDecimalOdds: legInfo.price.decimalOdds,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "SUSPENDED" });
  });

  it("stale/changed price is rejected", async () => {
    const { userId } = await setupUserWithBalance("100.00");
    const legInfo = await getFirstOpenLeg();
    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });

    const staleVersion = legInfo.price.version - 1 > 0 ? legInfo.price.version - 1 : legInfo.price.version;
    const staleOdds = legInfo.price.decimalOdds === "1.38" ? "2.00" : "1.38";

    if (legInfo.price.version === 1) {
      testProvider.bumpPrice(legInfo.outcomeId);
    }

    await expect(
      betting.placeBet({
        userId,
        idempotencyKey: uniqueKey(),
        stakeMinor: toMinorUnits("10.00"),
        legs: [
          {
            eventId: legInfo.eventId,
            marketId: legInfo.marketId,
            outcomeId: legInfo.outcomeId,
            expectedPriceVersion: staleVersion === legInfo.price.version ? staleVersion - 1 : staleVersion,
            expectedDecimalOdds: staleOdds,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "STALE_PRICE" });
  });

  it("concurrent placements with funds for only one - one succeeds, one fails", async () => {
    const { userId } = await setupUserWithBalance("10.00");
    const legInfo = await getFirstOpenLeg();
    const betting = new BettingService({ prisma, ledger, funding, provider: testProvider });

    const stake = toMinorUnits("10.00");
    const key1 = uniqueKey();
    const key2 = uniqueKey();

    const p1 = betting.placeBet({
      userId,
      idempotencyKey: key1,
      stakeMinor: stake,
      legs: [
        {
          eventId: legInfo.eventId,
          marketId: legInfo.marketId,
          outcomeId: legInfo.outcomeId,
          expectedPriceVersion: legInfo.price.version,
          expectedDecimalOdds: legInfo.price.decimalOdds,
        },
      ],
    });

    const p2 = betting.placeBet({
      userId,
      idempotencyKey: key2,
      stakeMinor: stake,
      legs: [
        {
          eventId: legInfo.eventId,
          marketId: legInfo.marketId,
          outcomeId: legInfo.outcomeId,
          expectedPriceVersion: legInfo.price.version,
          expectedDecimalOdds: legInfo.price.decimalOdds,
        },
      ],
    });

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<AcceptedBet>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = rejected[0].reason as { code?: string };
    expect(reason.code).toBe("INSUFFICIENT_FUNDS");

    const walletAcc = await prisma.walletAccount.findFirst({ where: { userId } });
    if (!walletAcc) throw new Error("wallet not found");
    const balance = await ledger.getBalance(walletAcc.id);
    expect(balance).toBe(0);

    const betCount = await prisma.bet.count({ where: { userId } });
    expect(betCount).toBe(1);
  });

  it("preserves wallet and sports semantics", async () => {
    const { userId } = await setupUserWithBalance("20.00");
    const acc = await prisma.walletAccount.findFirst({ where: { userId } });
    if (!acc) throw new Error("wallet not found");
    const bal = await ledger.getBalance(acc.id);
    expect(bal).toBe(2000);

    const events = await testProvider.listEvents();
    expect(events.length).toBeGreaterThanOrEqual(6);
    const live = events.filter((e) => e.status === "LIVE");
    expect(live.length).toBeGreaterThanOrEqual(1);
  });
});
