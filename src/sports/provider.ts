import {
  type CanonicalSport,
  type CanonicalCategory,
  type CanonicalCompetition,
  type CanonicalSeason,
  type CanonicalParticipant,
  type CanonicalEvent,
  type CanonicalScore,
  type CanonicalMarket,
  type CanonicalOutcome,
  type CanonicalPrice,
  type EventFilter,
  type SportsProvider,
  type ProviderNativeMapping,
  EventStatus,
  MarketState,
  MarketType,
} from "./types.js";
import { toCanonicalEvent, toCanonicalMarket, toCanonicalPrice } from "./normalize.js";

/**
 * Deterministic seeded PRNG (Mulberry32) — no external deps, no Math.random.
 */
function hashStringToUint32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SeededRng {
  private next: () => number;
  constructor(seedStr: string) {
    const seed = hashStringToUint32(seedStr);
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    const r = this.float();
    return Math.floor(r * (max - min + 1)) + min;
  }
}

function formatOddsHundredths(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

// Fixed base time for determinism — never use Date.now()
const BASE_TIME = new Date("2026-03-15T15:00:00.000Z");
const BASE_MS = BASE_TIME.getTime();

function isoFromOffsetDays(days: number, hours = 0, minutes = 0): string {
  return new Date(BASE_MS + days * 86400000 + hours * 3600000 + minutes * 60000).toISOString();
}

function isoFromOffsetMs(offsetMs: number): string {
  return new Date(BASE_MS + offsetMs).toISOString();
}

type BuiltCatalogue = {
  sports: CanonicalSport[];
  categories: CanonicalCategory[];
  competitions: CanonicalCompetition[];
  seasons: CanonicalSeason[];
  participants: CanonicalParticipant[];
  events: CanonicalEvent[];
  scores: CanonicalScore[];
  markets: CanonicalMarket[];
  outcomeToMarket: Map<string, string>;
  pricesByOutcome: Map<string, CanonicalPrice[]>;
  mappings: ProviderNativeMapping[];
};

function buildCatalogue(seed: string): BuiltCatalogue {
  const rng = new SeededRng(seed);

  const sports: CanonicalSport[] = [
    { id: "sport_football", slug: "football", name: "Football", active: true },
    { id: "sport_basketball", slug: "basketball", name: "Basketball", active: true },
  ];

  const categories: CanonicalCategory[] = [
    { id: "cat_football_eng", sportId: "sport_football", slug: "england", name: "England", region: "ENG" },
    { id: "cat_football_esp", sportId: "sport_football", slug: "spain", name: "Spain", region: "ESP" },
    { id: "cat_basketball_usa", sportId: "sport_basketball", slug: "usa", name: "USA", region: "USA" },
  ];

  const competitions: CanonicalCompetition[] = [
    {
      id: "comp_premier_mock",
      sportId: "sport_football",
      categoryId: "cat_football_eng",
      slug: "premier-mock-league",
      name: "Premier Mock League",
    },
    {
      id: "comp_la_mock",
      sportId: "sport_football",
      categoryId: "cat_football_esp",
      slug: "la-mock-cup",
      name: "La Mock Cup",
    },
    {
      id: "comp_mba",
      sportId: "sport_basketball",
      categoryId: "cat_basketball_usa",
      slug: "mock-basketball-assoc",
      name: "Mock Basketball Association",
    },
  ];

  const seasons: CanonicalSeason[] = [
    {
      id: "season_premier_2025_26",
      competitionId: "comp_premier_mock",
      slug: "2025-26",
      name: "2025/26 Season",
      startsAt: isoFromOffsetDays(-90),
      endsAt: isoFromOffsetDays(180),
    },
    {
      id: "season_la_2025_26",
      competitionId: "comp_la_mock",
      slug: "2025-26",
      name: "2025/26 Season",
      startsAt: isoFromOffsetDays(-90),
      endsAt: isoFromOffsetDays(180),
    },
    {
      id: "season_mba_2025_26",
      competitionId: "comp_mba",
      slug: "2025-26",
      name: "2025/26 Season",
      startsAt: isoFromOffsetDays(-60),
      endsAt: isoFromOffsetDays(150),
    },
  ];

  const participants: CanonicalParticipant[] = [
    { id: "part_northport", slug: "northport-united", name: "Northport United", shortName: "NTH", country: "ENG" },
    { id: "part_eastford", slug: "eastford-city", name: "Eastford City", shortName: "EFD", country: "ENG" },
    { id: "part_westhaven", slug: "westhaven-rovers", name: "Westhaven Rovers", shortName: "WST", country: "ENG" },
    { id: "part_southfield", slug: "southfield-athletic", name: "Southfield Athletic", shortName: "STH", country: "ENG" },
    { id: "part_lakeside", slug: "lakeside-fc", name: "Lakeside FC", shortName: "LAK", country: "ENG" },
    { id: "part_hillcrest", slug: "hillcrest-wanderers", name: "Hillcrest Wanderers", shortName: "HIL", country: "ENG" },
    { id: "part_costa_brava", slug: "costa-brava-cf", name: "Costa Brava CF", shortName: "CBC", country: "ESP" },
    { id: "part_valle_alto", slug: "valle-alto", name: "Valle Alto", shortName: "VAL", country: "ESP" },
    { id: "part_metro_titans", slug: "metro-titans", name: "Metro Titans", shortName: "MET", country: "USA" },
    { id: "part_coastal_sharks", slug: "coastal-sharks", name: "Coastal Sharks", shortName: "COA", country: "USA" },
    { id: "part_highland_bulls", slug: "highland-bulls", name: "Highland Bulls", shortName: "HIG", country: "USA" },
    { id: "part_desert_foxes", slug: "desert-foxes", name: "Desert Foxes", shortName: "DES", country: "USA" },
  ];

  const participantById = new Map(participants.map((p) => [p.id, p]));

  type RawEventDef = {
    id: string;
    slug: string;
    sportId: string;
    categoryId: string;
    competitionId: string;
    seasonId: string;
    homeId: string;
    awayId: string;
    startsAtOffsetDays: number;
    startsAtOffsetHours?: number;
    status: EventStatus;
    liveClock?: string | null;
    period?: string | null;
    score?: { home: number; away: number; scope: "FULL" | "HT" | "Q3" | "Q1" } | null;
  };

  const rawEvents: RawEventDef[] = [
    {
      id: "evt_football_001",
      slug: "northport-vs-eastford-001",
      sportId: "sport_football",
      categoryId: "cat_football_eng",
      competitionId: "comp_premier_mock",
      seasonId: "season_premier_2025_26",
      homeId: "part_northport",
      awayId: "part_eastford",
      startsAtOffsetDays: 1,
      status: EventStatus.SCHEDULED,
    },
    {
      id: "evt_football_002",
      slug: "westhaven-vs-southfield-002",
      sportId: "sport_football",
      categoryId: "cat_football_eng",
      competitionId: "comp_premier_mock",
      seasonId: "season_premier_2025_26",
      homeId: "part_westhaven",
      awayId: "part_southfield",
      startsAtOffsetDays: 0,
      startsAtOffsetHours: -1,
      status: EventStatus.LIVE,
      liveClock: "66:22",
      period: "H2",
      score: { home: 1, away: 0, scope: "FULL" },
    },
    {
      id: "evt_football_003",
      slug: "lakeside-vs-hillcrest-003",
      sportId: "sport_football",
      categoryId: "cat_football_esp",
      competitionId: "comp_la_mock",
      seasonId: "season_la_2025_26",
      homeId: "part_lakeside",
      awayId: "part_hillcrest",
      startsAtOffsetDays: 2,
      status: EventStatus.SCHEDULED,
    },
    {
      id: "evt_football_004",
      slug: "costa-brava-vs-valle-alto-004",
      sportId: "sport_football",
      categoryId: "cat_football_esp",
      competitionId: "comp_la_mock",
      seasonId: "season_la_2025_26",
      homeId: "part_costa_brava",
      awayId: "part_valle_alto",
      startsAtOffsetDays: 0,
      startsAtOffsetHours: -0.5,
      status: EventStatus.LIVE,
      liveClock: "23:45",
      period: "H1",
      score: { home: 0, away: 0, scope: "FULL" },
    },
    {
      id: "evt_basket_001",
      slug: "metro-vs-coastal-001",
      sportId: "sport_basketball",
      categoryId: "cat_basketball_usa",
      competitionId: "comp_mba",
      seasonId: "season_mba_2025_26",
      homeId: "part_metro_titans",
      awayId: "part_coastal_sharks",
      startsAtOffsetDays: 0,
      startsAtOffsetHours: -0.75,
      status: EventStatus.LIVE,
      liveClock: "08:32",
      period: "Q3",
      score: { home: 68, away: 72, scope: "FULL" },
    },
    {
      id: "evt_basket_002",
      slug: "highland-vs-desert-002",
      sportId: "sport_basketball",
      categoryId: "cat_basketball_usa",
      competitionId: "comp_mba",
      seasonId: "season_mba_2025_26",
      homeId: "part_highland_bulls",
      awayId: "part_desert_foxes",
      startsAtOffsetDays: 1,
      startsAtOffsetHours: 2,
      status: EventStatus.SCHEDULED,
    },
    {
      id: "evt_basket_003",
      slug: "metro-vs-highland-003",
      sportId: "sport_basketball",
      categoryId: "cat_basketball_usa",
      competitionId: "comp_mba",
      seasonId: "season_mba_2025_26",
      homeId: "part_metro_titans",
      awayId: "part_highland_bulls",
      startsAtOffsetDays: 3,
      status: EventStatus.SCHEDULED,
    },
  ];

  const scores: CanonicalScore[] = [];
  const events: CanonicalEvent[] = rawEvents.map((re) => {
    const startsAt = isoFromOffsetDays(re.startsAtOffsetDays, re.startsAtOffsetHours ?? 0);
    let scoreObj: CanonicalScore | null = null;
    if (re.score) {
      const s: CanonicalScore = {
        id: `score_${re.id}_full`,
        eventId: re.id,
        scope: re.score.scope,
        home: re.score.home,
        away: re.score.away,
        updatedAt: isoFromOffsetMs(-10 * 60 * 1000),
      };
      scores.push(s);
      scoreObj = s;
    }
    const homeP = participantById.get(re.homeId);
    const awayP = participantById.get(re.awayId);
    if (!homeP || !awayP) throw new Error(`unknown participant in fixture ${re.id}`);
    const ev: CanonicalEvent = {
      id: re.id,
      slug: re.slug,
      sportId: re.sportId,
      categoryId: re.categoryId,
      competitionId: re.competitionId,
      seasonId: re.seasonId,
      homeParticipantId: re.homeId,
      awayParticipantId: re.awayId,
      homeParticipant: homeP,
      awayParticipant: awayP,
      startsAt,
      status: re.status,
      liveClock: re.liveClock ?? null,
      period: re.period ?? null,
      score: scoreObj,
      scores: scoreObj ? [scoreObj] : [],
    };
    return ev;
  });

  const markets: CanonicalMarket[] = [];
  const pricesByOutcome = new Map<string, CanonicalPrice[]>();
  const outcomeToMarket = new Map<string, string>();
  const mappings: ProviderNativeMapping[] = [];

  function rangeForOutcome(marketType: MarketType, label: string, sportId: string): { min: number; max: number } {
    if (marketType === MarketType.OVER_UNDER) {
      return { min: 175, max: 215 };
    }
    if (marketType === MarketType.ONE_X_TWO) {
      if (sportId === "sport_basketball") {
        return { min: 140, max: 280 };
      }
      if (label === "1" || label === "Home") return { min: 150, max: 320 };
      if (label === "X" || label === "Draw") return { min: 280, max: 450 };
      if (label === "2" || label === "Away") return { min: 180, max: 400 };
    }
    return { min: 150, max: 350 };
  }

  const sortedEvents = [...events].sort((a, b) => a.id.localeCompare(b.id));

  for (const ev of sortedEvents) {
    const isFootball = ev.sportId === "sport_football";

    const m1Id = `mkt_${ev.id}_1x2`;
    const m1OutcomesDefs: { id: string; label: string }[] = isFootball
      ? [
          { id: `out_${ev.id}_1x2_1`, label: "1" },
          { id: `out_${ev.id}_1x2_x`, label: "X" },
          { id: `out_${ev.id}_1x2_2`, label: "2" },
        ]
      : [
          { id: `out_${ev.id}_1x2_1`, label: "1" },
          { id: `out_${ev.id}_1x2_2`, label: "2" },
        ];

    const m1Outcomes: CanonicalOutcome[] = m1OutcomesDefs.map((od) => ({
      id: od.id,
      marketId: m1Id,
      label: od.label,
      state: MarketState.OPEN,
    }));

    const m1Market: CanonicalMarket = {
      id: m1Id,
      eventId: ev.id,
      type: MarketType.ONE_X_TWO,
      line: null,
      state: MarketState.OPEN,
      version: 3,
      outcomes: m1Outcomes,
    };

    const ouLine = isFootball ? "2.5" : "162.5";
    const m2Id = `mkt_${ev.id}_ou_${ouLine.replace(".", "_")}`;
    const m2OutcomesDefs = [
      { id: `out_${ev.id}_ou_over`, label: "Over" },
      { id: `out_${ev.id}_ou_under`, label: "Under" },
    ];
    const m2State = ev.id === "evt_football_001" ? MarketState.SUSPENDED : MarketState.OPEN;
    const m2Outcomes: CanonicalOutcome[] = m2OutcomesDefs.map((od) => ({
      id: od.id,
      marketId: m2Id,
      label: od.label,
      state: MarketState.OPEN,
    }));

    const m2Market: CanonicalMarket = {
      id: m2Id,
      eventId: ev.id,
      type: MarketType.OVER_UNDER,
      line: ouLine,
      state: m2State,
      version: 3,
      outcomes: m2Outcomes,
    };

    markets.push(m1Market, m2Market);

    mappings.push(
      { canonicalId: ev.id, providerId: "fixture", nativeId: `fixture_native_${ev.id}` },
      { canonicalId: m1Id, providerId: "fixture", nativeId: `fixture_native_${m1Id}` },
      { canonicalId: m2Id, providerId: "fixture", nativeId: `fixture_native_${m2Id}` },
    );
    for (const o of [...m1Outcomes, ...m2Outcomes]) {
      mappings.push({ canonicalId: o.id, providerId: "fixture", nativeId: `fixture_native_${o.id}` });
      outcomeToMarket.set(o.id, o.marketId);
    }

    for (const outcome of [...m1Outcomes, ...m2Outcomes]) {
      const range = rangeForOutcome(
        outcome.marketId === m1Id ? MarketType.ONE_X_TWO : MarketType.OVER_UNDER,
        outcome.label,
        ev.sportId,
      );
      const history: CanonicalPrice[] = [];
      let lastOdds = 0;
      for (let v = 1; v <= 3; v++) {
        let hundredths: number;
        if (v === 1) {
          hundredths = rng.int(range.min, range.max);
          lastOdds = hundredths;
        } else {
          const drift = rng.int(-15, 15);
          hundredths = Math.min(range.max, Math.max(range.min, lastOdds + drift));
          if (hundredths === lastOdds) hundredths = Math.min(range.max, hundredths + 1);
          lastOdds = hundredths;
        }
        const validFrom = isoFromOffsetMs(-24 * 3600000 + (v - 1) * 6 * 3600000 + rng.int(0, 1000));
        const validTo = v < 3 ? isoFromOffsetMs(-24 * 3600000 + v * 6 * 3600000) : null;
        const price: CanonicalPrice = {
          id: `price_${outcome.id}_v${v}`,
          outcomeId: outcome.id,
          version: v,
          decimalOdds: formatOddsHundredths(hundredths),
          validFrom,
          validTo,
        };
        history.push(price);
      }
      pricesByOutcome.set(outcome.id, history);
    }
  }

  markets.sort((a, b) => a.id.localeCompare(b.id));

  return {
    sports,
    categories,
    competitions,
    seasons,
    participants,
    events,
    scores,
    markets,
    outcomeToMarket,
    pricesByOutcome,
    mappings,
  };
}

export class FixtureSportsProvider implements SportsProvider {
  public readonly providerId = "fixture";
  private readonly seed: string;
  private readonly catalogue: BuiltCatalogue;

  constructor(seed = "fixture-seed-001") {
    this.seed = seed;
    this.catalogue = buildCatalogue(seed);
  }

  getProviderMappings(): ProviderNativeMapping[] {
    return [...this.catalogue.mappings];
  }

  async listSports(): Promise<CanonicalSport[]> {
    return this.catalogue.sports.map((s) => ({ ...s }));
  }

  async listEvents(filter?: EventFilter): Promise<CanonicalEvent[]> {
    let evs = this.catalogue.events;

    if (filter) {
      if (filter.sportId) evs = evs.filter((e) => e.sportId === filter.sportId);
      if (filter.categoryId) evs = evs.filter((e) => e.categoryId === filter.categoryId);
      if (filter.competitionId) evs = evs.filter((e) => e.competitionId === filter.competitionId);
      if (filter.eventIds && filter.eventIds.length > 0) {
        const set = new Set(filter.eventIds);
        evs = evs.filter((e) => set.has(e.id));
      }
      if (filter.status) evs = evs.filter((e) => e.status === filter.status);
      if (filter.statuses && filter.statuses.length > 0) {
        const set = new Set(filter.statuses);
        evs = evs.filter((e) => set.has(e.status));
      }
      if (filter.liveOnly) evs = evs.filter((e) => e.status === EventStatus.LIVE);
      if (filter.from) {
        const fromMs = new Date(filter.from).getTime();
        evs = evs.filter((e) => new Date(e.startsAt).getTime() >= fromMs);
      }
      if (filter.to) {
        const toMs = new Date(filter.to).getTime();
        evs = evs.filter((e) => new Date(e.startsAt).getTime() <= toMs);
      }
    }

    const copy = structuredClone(evs);
    return copy.map((e) => toCanonicalEvent(e));
  }

  async getEvent(eventId: string): Promise<CanonicalEvent | null> {
    const found = this.catalogue.events.find((e) => e.id === eventId);
    if (!found) return null;
    return toCanonicalEvent(structuredClone(found));
  }

  async listMarkets(eventId: string): Promise<CanonicalMarket[]> {
    const ms = this.catalogue.markets.filter((m) => m.eventId === eventId);
    if (ms.length === 0) {
      const exists = this.catalogue.events.some((e) => e.id === eventId);
      if (!exists) return [];
    }
    const copy = structuredClone(ms);
    return copy.map((m) => toCanonicalMarket(m));
  }

  async getPrices(outcomeId: string): Promise<CanonicalPrice[]> {
    const prices = this.catalogue.pricesByOutcome.get(outcomeId);
    if (!prices) return [];
    const copy = structuredClone(prices).sort((a, b) => a.version - b.version);
    return copy.map((p) => toCanonicalPrice(p));
  }
}
