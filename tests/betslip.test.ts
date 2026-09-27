import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { BetslipService } from "../src/betslip/service.js";
import { BettingService } from "../src/betting/service.js";
import { FixtureSportsProvider } from "../src/sports/provider.js";
import {
  MarketState,
  type CanonicalEvent,
  type CanonicalMarket,
  type CanonicalPrice,
  type CanonicalSport,
  type EventFilter,
  type SportsProvider,
} from "../src/sports/types.js";
import { FundingService } from "../src/wallet/funding.js";
import { LedgerService } from "../src/wallet/ledger.js";
import { toMinorUnits } from "../src/wallet/money.js";
import { cleanDatabase } from "./helpers/db.js";

const prisma = new PrismaClient();
const ledger = new LedgerService(prisma);
const funding = new FundingService(prisma, ledger);

class MutableProvider implements SportsProvider {
  public readonly providerId = "betslip-test";
  private readonly base = new FixtureSportsProvider("betslip-test-seed");
  private readonly priceBumps = new Set<string>();
  private readonly suspendedMarkets = new Set<string>();
  private readonly removedOutcomes = new Set<string>();

  clear(): void {
    this.priceBumps.clear();
    this.suspendedMarkets.clear();
    this.removedOutcomes.clear();
  }

  bumpPrice(outcomeId: string): void {
    this.priceBumps.add(outcomeId);
  }

  suspendMarket(marketId: string): void {
    this.suspendedMarkets.add(marketId);
  }

  removeOutcome(outcomeId: string): void {
    this.removedOutcomes.add(outcomeId);
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
    return markets.map((market) => ({
      ...market,
      state: this.suspendedMarkets.has(market.id) ? MarketState.SUSPENDED : market.state,
      outcomes: market.outcomes
        .filter((outcome) => !this.removedOutcomes.has(outcome.id))
        .map((outcome) => ({
          ...outcome,
          state: this.suspendedMarkets.has(market.id) ? MarketState.SUSPENDED : outcome.state,
        })),
    }));
  }

  async getPrices(outcomeId: string): Promise<CanonicalPrice[]> {
    const prices = await this.base.getPrices(outcomeId);
    if (!this.priceBumps.has(outcomeId) || prices.length === 0) return prices;

    const latest = [...prices].sort((a, b) => b.version - a.version)[0];
    const bumped: CanonicalPrice = {
      ...latest,
      id: `${latest.id}_bump`,
      version: latest.version + 1,
      decimalOdds: latest.decimalOdds === "9.99" ? "8.88" : "9.99",
      validFrom: "2026-09-27T12:00:00.000Z",
      validTo: null,
    };
    return [...prices, bumped];
  }
}

const provider = new MutableProvider();
let now = new Date("2026-09-27T12:00:00.000Z");

function service(): BetslipService {
  return new BetslipService({
    prisma,
    provider,
    clock: () => new Date(now),
  });
}

beforeEach(async () => {
  await cleanDatabase(prisma);
  await ledger.ensureSystemAccounts();
  provider.clear();
  now = new Date("2026-09-27T12:00:00.000Z");
});

afterAll(async () => {
  await prisma.$disconnect();
});

function userId(): string {
  return `user_${randomUUID()}`;
}

async function firstOpenMarket(): Promise<{
  eventId: string;
  market: CanonicalMarket;
  prices: CanonicalPrice[];
}> {
  const events = await provider.listEvents();
  for (const event of events) {
    const markets = await provider.listMarkets(event.id);
    const market = markets.find(
      (candidate) =>
        candidate.state === MarketState.OPEN &&
        candidate.outcomes.filter((outcome) => outcome.state === MarketState.OPEN).length >= 2,
    );
    if (!market) continue;
    const prices = await provider.getPrices(market.outcomes[0].id);
    return { eventId: event.id, market, prices };
  }
  throw new Error("No open test market found");
}

async function addFirstSelection(
  bets: BetslipService,
  user: string,
  slipId: string,
): Promise<{
  eventId: string;
  market: CanonicalMarket;
  outcomeId: string;
  price: CanonicalPrice;
}> {
  const { eventId, market } = await firstOpenMarket();
  const outcome = market.outcomes[0];
  const prices = await provider.getPrices(outcome.id);
  const price = [...prices].sort((a, b) => b.version - a.version)[0];

  await bets.toggleSelection({
    userId: user,
    slipId,
    eventId,
    marketId: market.id,
    outcomeId: outcome.id,
  });

  return { eventId, market, outcomeId: outcome.id, price };
}

describe("persisted betslip + booking codes", () => {
  it("creates an owned persisted slip and rejects cross-user access", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner, mode: "REAL" });

    expect(slip.userId).toBe(owner);
    expect(slip.state).toBe("DRAFT");
    expect(slip.selections).toHaveLength(0);

    const reloaded = await bets.getSlip(owner, slip.id);
    expect(reloaded.id).toBe(slip.id);

    await expect(bets.getSlip(userId(), slip.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("adds, replaces same-market outcome, then toggles identical outcome off", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    const { eventId, market } = await firstOpenMarket();
    const first = market.outcomes[0];
    const second = market.outcomes[1];

    const added = await bets.toggleSelection({
      userId: owner,
      slipId: slip.id,
      eventId,
      marketId: market.id,
      outcomeId: first.id,
    });
    expect(added.action).toBe("ADDED");
    expect(added.slip.selections).toHaveLength(1);
    expect(added.slip.selections[0].outcomeId).toBe(first.id);

    const replaced = await bets.toggleSelection({
      userId: owner,
      slipId: slip.id,
      eventId,
      marketId: market.id,
      outcomeId: second.id,
    });
    expect(replaced.action).toBe("REPLACED");
    expect(replaced.slip.selections).toHaveLength(1);
    expect(replaced.slip.selections[0].outcomeId).toBe(second.id);

    const removed = await bets.toggleSelection({
      userId: owner,
      slipId: slip.id,
      eventId,
      marketId: market.id,
      outcomeId: second.id,
    });
    expect(removed.action).toBe("REMOVED");
    expect(removed.slip.selections).toHaveLength(0);
  });

  it("persists stake and prepares a current slip for authoritative Slice 03 placement", async () => {
    const bets = service();
    const owner = userId();
    await ledger.createAccount(owner, "REAL", "NGN");
    await funding.grantPlayMoney({
      userId: owner,
      amount: toMinorUnits("100.00"),
      idempotencyKey: `grant_${randomUUID()}`,
    });

    const slip = await bets.createSlip({ userId: owner, mode: "REAL" });
    await addFirstSelection(bets, owner, slip.id);
    await bets.setStake(owner, slip.id, toMinorUnits("10.00"));

    const prepared = await bets.prepareForPlacement(owner, slip.id);
    expect(prepared.stakeMinor).toBe(1000);
    expect(prepared.legs).toHaveLength(1);

    const betting = new BettingService({ prisma, ledger, funding, provider });
    const accepted = await betting.placeBet({
      userId: prepared.userId,
      currency: prepared.currency,
      stakeMinor: prepared.stakeMinor,
      idempotencyKey: `from_slip_${randomUUID()}`,
      legs: prepared.legs,
    });

    expect(accepted.legs[0].priceVersion).toBe(prepared.legs[0].expectedPriceVersion);
    const wallet = await prisma.walletAccount.findFirst({
      where: { userId: owner, kind: "REAL", currency: "NGN" },
    });
    expect(wallet).not.toBeNull();
    expect(await ledger.getBalance(wallet!.id)).toBe(9000);
  });

  it("detects a changed price, blocks preparation, and requires explicit acceptance", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    const selected = await addFirstSelection(bets, owner, slip.id);
    await bets.setStake(owner, slip.id, toMinorUnits("10.00"));

    provider.bumpPrice(selected.outcomeId);

    const before = await bets.reconcileSlip(owner, slip.id);
    expect(before.blocked).toBe(true);
    expect(before.selections[0].status).toBe("PRICE_CHANGED");
    expect(before.selections[0].current?.priceVersion).toBe(selected.price.version + 1);

    await expect(bets.prepareForPlacement(owner, slip.id)).rejects.toMatchObject({
      code: "PRICE_CHANGED",
    });

    const accepted = await bets.acceptPriceChanges(owner, slip.id);
    expect(accepted.selections[0].priceVersion).toBe(selected.price.version + 1);
    expect(accepted.selections[0].decimalOdds).toBe("9.99");

    const after = await bets.reconcileSlip(owner, slip.id);
    expect(after.blocked).toBe(false);
    expect(after.selections[0].status).toBe("CURRENT");
  });

  it("surfaces suspension and refuses to prepare a blocked slip", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    const selected = await addFirstSelection(bets, owner, slip.id);
    await bets.setStake(owner, slip.id, toMinorUnits("10.00"));

    provider.suspendMarket(selected.market.id);

    const reconciled = await bets.reconcileSlip(owner, slip.id);
    expect(reconciled.selections[0].status).toBe("SUSPENDED");
    await expect(bets.prepareForPlacement(owner, slip.id)).rejects.toMatchObject({
      code: "SUSPENDED",
    });
  });

  it("creates an expiring usage-limited booking snapshot with a human-safe code", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    await addFirstSelection(bets, owner, slip.id);
    await bets.setStake(owner, slip.id, toMinorUnits("12.34"));

    const booked = await bets.bookSlip({
      userId: owner,
      slipId: slip.id,
      ttlSeconds: 600,
      maxUses: 3,
    });

    expect(booked.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
    expect(booked.maxUses).toBe(3);
    expect(booked.useCount).toBe(0);
    expect(booked.expiresAt.toISOString()).toBe("2026-09-27T12:10:00.000Z");

    const stored = await prisma.bookingCode.findUnique({ where: { code: booked.code } });
    expect(stored?.sourceSlipId).toBe(slip.id);
    expect(stored?.priceBasis).toBe("SNAPSHOT_AT_BOOKING");
  });

  it("loads at current prices rather than reserving the booked price and does not create a bet", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    const selected = await addFirstSelection(bets, owner, slip.id);
    const booked = await bets.bookSlip({ userId: owner, slipId: slip.id, maxUses: 2 });

    provider.bumpPrice(selected.outcomeId);

    const loaded = await bets.loadBooking(booked.code.toLowerCase());
    expect(loaded.selections).toHaveLength(1);
    expect(loaded.selections[0].status).toBe("PRICE_CHANGED");
    expect(loaded.selections[0].booked.priceVersion).toBe(selected.price.version);
    expect(loaded.selections[0].current?.priceVersion).toBe(selected.price.version + 1);
    expect(loaded.useCount).toBe(1);
    expect(await prisma.bet.count()).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { refType: "BET" } })).toBe(0);
  });

  it("imports a booking into a persisted slip using current prices and flags unavailable legs", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    const selected = await addFirstSelection(bets, owner, slip.id);
    const booked = await bets.bookSlip({ userId: owner, slipId: slip.id, maxUses: 3 });

    provider.bumpPrice(selected.outcomeId);
    const imported = await bets.importBooking({
      userId: userId(),
      code: booked.code,
    });

    expect(imported.importedCount).toBe(1);
    expect(imported.unavailableCount).toBe(0);
    expect(imported.slip.selections[0].priceVersion).toBe(selected.price.version + 1);
    expect(imported.slip.selections[0].decimalOdds).toBe("9.99");

    const secondSlip = await bets.createSlip({ userId: owner });
    const secondSelected = await addFirstSelection(bets, owner, secondSlip.id);
    const secondCode = await bets.bookSlip({ userId: owner, slipId: secondSlip.id });
    provider.removeOutcome(secondSelected.outcomeId);

    const missing = await bets.importBooking({
      userId: userId(),
      code: secondCode.code,
    });
    expect(missing.importedCount).toBe(0);
    expect(missing.unavailableCount).toBe(1);
    expect(missing.slip.selections).toHaveLength(0);
  });

  it("rejects a foreign target slip before consuming a booking-code use", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    await addFirstSelection(bets, owner, slip.id);
    const booked = await bets.bookSlip({ userId: owner, slipId: slip.id, maxUses: 2 });

    const foreignOwner = userId();
    const foreignSlip = await bets.createSlip({ userId: foreignOwner });

    await expect(
      bets.importBooking({
        userId: owner,
        code: booked.code,
        targetSlipId: foreignSlip.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stored = await prisma.bookingCode.findUnique({ where: { code: booked.code } });
    expect(stored?.useCount).toBe(0);
  });

  it("rejects expired booking codes without consuming a use", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    await addFirstSelection(bets, owner, slip.id);
    const booked = await bets.bookSlip({
      userId: owner,
      slipId: slip.id,
      ttlSeconds: 60,
      maxUses: 2,
    });

    now = new Date("2026-09-27T12:01:01.000Z");

    await expect(bets.loadBooking(booked.code)).rejects.toMatchObject({ code: "BOOKING_EXPIRED" });
    const stored = await prisma.bookingCode.findUnique({ where: { code: booked.code } });
    expect(stored?.useCount).toBe(0);
  });

  it("enforces maxUses atomically under concurrent booking loads", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    await addFirstSelection(bets, owner, slip.id);
    const booked = await bets.bookSlip({
      userId: owner,
      slipId: slip.id,
      maxUses: 1,
    });

    const results = await Promise.allSettled([
      bets.loadBooking(booked.code),
      bets.loadBooking(booked.code),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { code?: string }).code).toBe("BOOKING_EXHAUSTED");

    const stored = await prisma.bookingCode.findUnique({ where: { code: booked.code } });
    expect(stored?.useCount).toBe(1);
  });

  it("prevents editing an archived slip", async () => {
    const bets = service();
    const owner = userId();
    const slip = await bets.createSlip({ userId: owner });
    await bets.archiveSlip(owner, slip.id);

    await expect(bets.setStake(owner, slip.id, toMinorUnits("10.00"))).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    const { eventId, market } = await firstOpenMarket();
    await expect(
      bets.toggleSelection({
        userId: owner,
        slipId: slip.id,
        eventId,
        marketId: market.id,
        outcomeId: market.outcomes[0].id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
