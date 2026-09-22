import { describe, it, expect } from "vitest";
import { FixtureSportsProvider } from "../src/sports/provider.js";
import { DECIMAL_ODDS_REGEX, EventStatus, MarketState, MarketType } from "../src/sports/types.js";
import { applyPriceUpdate, assertNoProviderLeakage, toCanonicalPrice } from "../src/sports/normalize.js";
import type { CanonicalPrice } from "../src/sports/types.js";

function hasLeakageKeys(obj: unknown, seen = new Set<unknown>()): string[] {
  const leaks: string[] = [];
  if (obj === null || obj === undefined) return leaks;
  if (seen.has(obj)) return leaks;
  if (typeof obj === "object") seen.add(obj);

  if (typeof obj === "string") {
    if (obj.startsWith("sr:")) leaks.push(`value starts with sr:: ${obj}`);
    return leaks;
  }

  if (Array.isArray(obj)) {
    for (const v of obj) leaks.push(...hasLeakageKeys(v, seen));
    return leaks;
  }

  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (k === "providerId" || k === "nativeId" || k === "provider_id" || k === "native_id") {
        leaks.push(`forbidden key ${k}`);
      }
      if (typeof v === "string" && v.startsWith("sr:")) {
        leaks.push(`forbidden value prefix sr: at key ${k}`);
      }
      leaks.push(...hasLeakageKeys(v, seen));
    }
  }
  return leaks;
}

describe("FixtureSportsProvider determinism", () => {
  it("two provider instances with same seed produce deep-equal catalogues, prices, versions", async () => {
    const seed = "determinism-seed-123";
    const p1 = new FixtureSportsProvider(seed);
    const p2 = new FixtureSportsProvider(seed);

    const sports1 = await p1.listSports();
    const sports2 = await p2.listSports();
    expect(sports1).toEqual(sports2);

    const events1 = await p1.listEvents();
    const events2 = await p2.listEvents();
    expect(events1).toEqual(events2);

    for (const ev of events1) {
      const m1 = await p1.listMarkets(ev.id);
      const m2 = await p2.listMarkets(ev.id);
      expect(m1).toEqual(m2);

      for (const market of m1) {
        for (const outcome of market.outcomes) {
          const prices1 = await p1.getPrices(outcome.id);
          const prices2 = await p2.getPrices(outcome.id);
          expect(prices1).toEqual(prices2);
        }
      }
    }
  });

  it("different seeds produce prices with same shape (and same-seed recheck is stable)", async () => {
    const p1 = new FixtureSportsProvider("seed-A");
    const p2 = new FixtureSportsProvider("seed-B");
    const events1 = await p1.listEvents();
    const ev = events1[0];
    const m = await p1.listMarkets(ev.id);
    const outcomeId = m[0].outcomes[0].id;
    const pricesA = await p1.getPrices(outcomeId);
    const pricesB = await p2.getPrices(outcomeId);
    expect(pricesA.length).toBe(pricesB.length);
    expect(pricesA[0].decimalOdds).toMatch(DECIMAL_ODDS_REGEX);
    expect(pricesB[0].decimalOdds).toMatch(DECIMAL_ODDS_REGEX);
    const p1Again = new FixtureSportsProvider("seed-A");
    const pricesA2 = await p1Again.getPrices(outcomeId);
    expect(pricesA).toEqual(pricesA2);
  });
});

describe("Shape requirements", () => {
  it("≥2 sports, ≥3 competitions, ≥6 events with ≥1 LIVE event carrying clock + period + score", async () => {
    const provider = new FixtureSportsProvider("shape-test-seed");
    const sports = await provider.listSports();
    expect(sports.length).toBeGreaterThanOrEqual(2);
    const sportIds = sports.map((s) => s.id);
    expect(sportIds).toContain("sport_football");
    expect(sportIds).toContain("sport_basketball");

    const events = await provider.listEvents();
    expect(events.length).toBeGreaterThanOrEqual(6);

    const compIds = new Set(events.map((e) => e.competitionId));
    expect(compIds.size).toBeGreaterThanOrEqual(3);

    const liveEvents = events.filter((e) => e.status === EventStatus.LIVE);
    expect(liveEvents.length).toBeGreaterThanOrEqual(1);

    for (const le of liveEvents) {
      expect(le.liveClock).toBeTruthy();
      expect(le.period).toBeTruthy();
      expect(le.score).toBeTruthy();
      expect(le.score?.home).toBeDefined();
      expect(le.score?.away).toBeDefined();
    }

    for (const ev of events) {
      const markets = await provider.listMarkets(ev.id);
      const has1x2 = markets.filter((m) => m.type === MarketType.ONE_X_TWO);
      const hasOU = markets.filter((m) => m.type === MarketType.OVER_UNDER);
      expect(has1x2.length, `event ${ev.id} missing 1X2`).toBeGreaterThanOrEqual(1);
      expect(hasOU.length, `event ${ev.id} missing OU`).toBeGreaterThanOrEqual(1);

      for (const mk of [...has1x2, ...hasOU]) {
        expect(mk.outcomes.length).toBeGreaterThanOrEqual(2);
        for (const outcome of mk.outcomes) {
          const prices = await provider.getPrices(outcome.id);
          expect(prices.length).toBeGreaterThanOrEqual(1);
          expect(prices[0].version).toBeGreaterThanOrEqual(1);
          expect(prices[0].decimalOdds).toMatch(DECIMAL_ODDS_REGEX);
        }
      }
    }
  });
});

describe("Canonical purity", () => {
  it("no canonical object contains provider-native IDs", async () => {
    const provider = new FixtureSportsProvider("purity-seed");
    const sports = await provider.listSports();
    const events = await provider.listEvents();
    const allMarkets = [];
    const allPrices: CanonicalPrice[] = [];

    for (const ev of events) {
      const ms = await provider.listMarkets(ev.id);
      allMarkets.push(...ms);
      for (const mk of ms) {
        for (const o of mk.outcomes) {
          const ps = await provider.getPrices(o.id);
          allPrices.push(...ps);
        }
      }
    }

    const allObjects: unknown[] = [...sports, ...events, ...allMarkets, ...allPrices];
    for (const mk of allMarkets) {
      allObjects.push(...mk.outcomes);
    }

    for (const obj of allObjects) {
      const leaks = hasLeakageKeys(obj);
      expect(leaks, `Leakage found in ${JSON.stringify(obj).slice(0, 200)}: ${leaks.join(", ")}`).toEqual([]);
      expect(() => assertNoProviderLeakage(obj)).not.toThrow();
    }

    const mappings = provider.getProviderMappings();
    expect(mappings.length).toBeGreaterThan(0);
    const sampleEvent = events[0] as unknown as Record<string, unknown>;
    expect(sampleEvent["nativeId"]).toBeUndefined();
    expect(sampleEvent["providerId"]).toBeUndefined();
  });
});

describe("Version monotonicity", () => {
  it("prices per outcome strictly increasing versions", async () => {
    const provider = new FixtureSportsProvider("version-seed");
    const events = await provider.listEvents();
    for (const ev of events) {
      const markets = await provider.listMarkets(ev.id);
      for (const market of markets) {
        for (const outcome of market.outcomes) {
          const prices = await provider.getPrices(outcome.id);
          const versions = prices.map((p) => p.version);
          for (let i = 1; i < versions.length; i++) {
            expect(versions[i]).toBeGreaterThan(versions[i - 1]);
          }
          const sorted = [...versions].sort((a, b) => a - b);
          expect(versions).toEqual(sorted);
        }
      }
    }
  });
});

describe("Stale rejection", () => {
  it("normalizer drops a lower-version price update for an outcome it already holds", () => {
    const existing: CanonicalPrice[] = [
      {
        id: "price_out1_v1",
        outcomeId: "out_1",
        version: 1,
        decimalOdds: "1.80",
        validFrom: "2026-03-14T00:00:00.000Z",
        validTo: "2026-03-14T06:00:00.000Z",
      },
      {
        id: "price_out1_v2",
        outcomeId: "out_1",
        version: 2,
        decimalOdds: "1.85",
        validFrom: "2026-03-14T06:00:00.000Z",
        validTo: "2026-03-14T12:00:00.000Z",
      },
      {
        id: "price_out1_v3",
        outcomeId: "out_1",
        version: 3,
        decimalOdds: "1.90",
        validFrom: "2026-03-14T12:00:00.000Z",
        validTo: null,
      },
    ];

    const stale: CanonicalPrice = {
      id: "price_out1_v2_dup",
      outcomeId: "out_1",
      version: 2,
      decimalOdds: "1.86",
      validFrom: "2026-03-14T06:00:00.000Z",
      validTo: "2026-03-14T12:00:00.000Z",
    };

    const resultStale = applyPriceUpdate(existing, stale);
    expect(resultStale.accepted).toBe(false);
    expect(resultStale.prices).toEqual(existing);

    const lowerStale: CanonicalPrice = {
      id: "price_out1_v1_dup",
      outcomeId: "out_1",
      version: 1,
      decimalOdds: "1.81",
      validFrom: "2026-03-14T00:00:00.000Z",
      validTo: "2026-03-14T06:00:00.000Z",
    };
    const resultLower = applyPriceUpdate(existing, lowerStale);
    expect(resultLower.accepted).toBe(false);

    const fresh: CanonicalPrice = {
      id: "price_out1_v4",
      outcomeId: "out_1",
      version: 4,
      decimalOdds: "1.95",
      validFrom: "2026-03-14T18:00:00.000Z",
      validTo: null,
    };
    const resultFresh = applyPriceUpdate(existing, fresh);
    expect(resultFresh.accepted).toBe(true);
    expect(resultFresh.prices.length).toBe(4);
    expect(resultFresh.prices.map((p) => p.version)).toEqual([1, 2, 3, 4]);
  });

  it("applyPriceUpdate validates odds format", () => {
    const badOdds = {
      id: "price_bad",
      outcomeId: "out_2",
      version: 1,
      decimalOdds: "1.8",
      validFrom: "2026-03-14T00:00:00.000Z",
      validTo: null,
    } as CanonicalPrice;
    expect(() => toCanonicalPrice(badOdds)).toThrow();
  });
});

describe("Suspended representation", () => {
  it("at least one fixture market is SUSPENDED and consumers can distinguish it from OPEN", async () => {
    const provider = new FixtureSportsProvider("suspended-seed");
    const events = await provider.listEvents();
    const nested = await Promise.all(events.map((e) => provider.listMarkets(e.id)));
    const flattened = nested.flat();
    const suspended = flattened.filter((mk) => mk.state === MarketState.SUSPENDED);
    const open = flattened.filter((mk) => mk.state === MarketState.OPEN);
    expect(suspended.length).toBeGreaterThanOrEqual(1);
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(suspended[0].state).not.toBe(open[0].state);
    expect(suspended[0].outcomes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Odds format", () => {
  it("every price matches /^\\d+\\.\\d{2}$/ and parses without float arithmetic", async () => {
    const provider = new FixtureSportsProvider("odds-format-seed");
    const events = await provider.listEvents();
    for (const ev of events) {
      const markets = await provider.listMarkets(ev.id);
      for (const mk of markets) {
        for (const o of mk.outcomes) {
          const prices = await provider.getPrices(o.id);
          for (const price of prices) {
            expect(typeof price.decimalOdds).toBe("string");
            expect(price.decimalOdds).toMatch(DECIMAL_ODDS_REGEX);

            const parts = price.decimalOdds.split(".");
            expect(parts.length).toBe(2);
            const [wholeStr, fracStr] = parts;
            expect(wholeStr).toMatch(/^\d+$/);
            expect(fracStr).toMatch(/^\d{2}$/);

            const whole = Number.parseInt(wholeStr, 10);
            const frac = Number.parseInt(fracStr, 10);
            expect(Number.isInteger(whole)).toBe(true);
            expect(Number.isInteger(frac)).toBe(true);
            expect(frac).toBeGreaterThanOrEqual(0);
            expect(frac).toBeLessThan(100);

            const hundredths = whole * 100 + frac;
            expect(hundredths).toBeGreaterThanOrEqual(100);
            const reconstructed = `${whole}.${frac.toString().padStart(2, "0")}`;
            expect(reconstructed).toBe(price.decimalOdds);
          }
        }
      }
    }
  });
});

describe("Provider interface edge cases", () => {
  it("unknown eventId returns null, unknown outcomeId returns []", async () => {
    const provider = new FixtureSportsProvider("edge-seed");
    const missingEvent = await provider.getEvent("nonexistent_evt");
    expect(missingEvent).toBeNull();

    const missingMarkets = await provider.listMarkets("nonexistent_evt");
    expect(missingMarkets).toEqual([]);

    const missingPrices = await provider.getPrices("nonexistent_outcome");
    expect(missingPrices).toEqual([]);
  });

  it("EventFilter works", async () => {
    const provider = new FixtureSportsProvider("filter-seed");
    const footballEvents = await provider.listEvents({ sportId: "sport_football" });
    expect(footballEvents.length).toBeGreaterThan(0);
    expect(footballEvents.every((e) => e.sportId === "sport_football")).toBe(true);

    const liveOnly = await provider.listEvents({ liveOnly: true });
    expect(liveOnly.every((e) => e.status === EventStatus.LIVE)).toBe(true);

    const scheduled = await provider.listEvents({ status: EventStatus.SCHEDULED });
    expect(scheduled.every((e) => e.status === EventStatus.SCHEDULED)).toBe(true);
  });
});
