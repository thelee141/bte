import {
  type CanonicalEvent,
  type CanonicalMarket,
  type CanonicalOutcome,
  type CanonicalPrice,
  type CanonicalParticipant,
  type CanonicalScore,
  DECIMAL_ODDS_REGEX,
  EventStatus,
  MarketState,
  MarketType,
  isEventStatus,
  isMarketState,
  isMarketType,
} from "./types.js";

const FORBIDDEN_KEYS = ["providerId", "nativeId", "provider_id", "native_id", "nativeProviderId", "providerNativeId"];

const FORBIDDEN_VALUE_PREFIXES = ["sr:"];

export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

export function assertNoProviderLeakage(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    for (const pref of FORBIDDEN_VALUE_PREFIXES) {
      if (value.startsWith(pref)) {
        throw new NormalizationError(`Provider leakage at ${path}: forbidden prefix "${pref}" in value "${value}"`);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoProviderLeakage(v, `${path}[${i}]`));
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        throw new NormalizationError(`Provider leakage at ${path}: forbidden key "${key}"`);
      }
      assertNoProviderLeakage(obj[key], `${path}.${key}`);
    }
  }
}

export function assertValidDecimalOddsString(odds: string): void {
  if (typeof odds !== "string") {
    throw new NormalizationError(`Odds must be string, got ${typeof odds}`);
  }
  if (!DECIMAL_ODDS_REGEX.test(odds)) {
    throw new NormalizationError(`Odds "${odds}" must match ${DECIMAL_ODDS_REGEX}`);
  }
  const [whole, frac] = odds.split(".");
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(frac)) {
    throw new NormalizationError(`Odds "${odds}" invalid decimal format`);
  }
  const hundredths = Number(whole) * 100 + Number(frac);
  if (!Number.isInteger(hundredths) || hundredths < 100) {
    throw new NormalizationError(`Odds "${odds}" invalid hundredths`);
  }
}

export function assertPriceVersionsMonotonic(prices: CanonicalPrice[]): void {
  if (prices.length <= 1) return;
  const byOutcome = new Map<string, CanonicalPrice[]>();
  for (const p of prices) {
    const arr = byOutcome.get(p.outcomeId) ?? [];
    arr.push(p);
    byOutcome.set(p.outcomeId, arr);
  }
  for (const [outcomeId, arr] of byOutcome) {
    const sorted = [...arr].sort((a, b) => a.version - b.version);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].version <= sorted[i - 1].version) {
        throw new NormalizationError(
          `Price versions not strictly increasing for outcome ${outcomeId}: ${sorted[i - 1].version} -> ${sorted[i].version}`,
        );
      }
    }
  }
}

export function toCanonicalParticipant(raw: unknown): CanonicalParticipant {
  assertNoProviderLeakage(raw, "participant");
  if (typeof raw !== "object" || raw === null) throw new NormalizationError("Participant must be object");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) throw new NormalizationError("Participant.id required string");
  if (typeof r.slug !== "string" || !r.slug) throw new NormalizationError("Participant.slug required");
  if (typeof r.name !== "string" || !r.name) throw new NormalizationError("Participant.name required");
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: typeof r.shortName === "string" ? r.shortName : undefined,
    country: typeof r.country === "string" ? r.country : undefined,
  };
}

export function toCanonicalScore(raw: unknown): CanonicalScore {
  assertNoProviderLeakage(raw, "score");
  if (typeof raw !== "object" || raw === null) throw new NormalizationError("Score must be object");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") throw new NormalizationError("Score.id required");
  if (typeof r.eventId !== "string") throw new NormalizationError("Score.eventId required");
  if (typeof r.scope !== "string") throw new NormalizationError("Score.scope required");
  if (typeof r.home !== "number" || !Number.isInteger(r.home)) throw new NormalizationError("Score.home integer");
  if (typeof r.away !== "number" || !Number.isInteger(r.away)) throw new NormalizationError("Score.away integer");
  if (typeof r.updatedAt !== "string") throw new NormalizationError("Score.updatedAt required ISO string");
  return {
    id: r.id,
    eventId: r.eventId,
    scope: r.scope,
    home: r.home,
    away: r.away,
    updatedAt: r.updatedAt,
  };
}

export function toCanonicalEvent(raw: unknown): CanonicalEvent {
  assertNoProviderLeakage(raw, "event");
  if (typeof raw !== "object" || raw === null) throw new NormalizationError("Event must be object");
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "string" || !r.id) throw new NormalizationError("Event.id required");
  if (typeof r.slug !== "string" || !r.slug) throw new NormalizationError("Event.slug required");
  if (typeof r.sportId !== "string" || !r.sportId) throw new NormalizationError("Event.sportId required");
  if (typeof r.categoryId !== "string" || !r.categoryId) throw new NormalizationError("Event.categoryId required");
  if (typeof r.competitionId !== "string" || !r.competitionId)
    throw new NormalizationError("Event.competitionId required");
  if (typeof r.homeParticipantId !== "string" || !r.homeParticipantId)
    throw new NormalizationError("Event.homeParticipantId required");
  if (typeof r.awayParticipantId !== "string" || !r.awayParticipantId)
    throw new NormalizationError("Event.awayParticipantId required");
  if (typeof r.startsAt !== "string" || !r.startsAt) throw new NormalizationError("Event.startsAt required ISO string");
  if (!isEventStatus(r.status)) throw new NormalizationError(`Event.status invalid: ${r.status}`);

  if (typeof r.homeParticipant !== "object" || r.homeParticipant === null)
    throw new NormalizationError("Event.homeParticipant required");
  if (typeof r.awayParticipant !== "object" || r.awayParticipant === null)
    throw new NormalizationError("Event.awayParticipant required");

  const homeParticipant = toCanonicalParticipant(r.homeParticipant);
  const awayParticipant = toCanonicalParticipant(r.awayParticipant);

  const liveClock = r.liveClock === null || r.liveClock === undefined ? null : (r.liveClock as string);
  const period = r.period === null || r.period === undefined ? null : (r.period as string);
  if (liveClock !== null && typeof liveClock !== "string")
    throw new NormalizationError("Event.liveClock must be string or null");
  if (period !== null && typeof period !== "string") throw new NormalizationError("Event.period must be string or null");

  let score: CanonicalScore | null = null;
  if (r.score !== null && r.score !== undefined) {
    score = toCanonicalScore(r.score);
  }

  let scores: CanonicalScore[] | undefined;
  if (Array.isArray(r.scores)) {
    scores = r.scores.map((s) => toCanonicalScore(s));
  }

  const seasonId =
    r.seasonId === null || r.seasonId === undefined ? null : typeof r.seasonId === "string" ? r.seasonId : null;

  const event: CanonicalEvent = {
    id: r.id,
    slug: r.slug,
    sportId: r.sportId,
    categoryId: r.categoryId,
    competitionId: r.competitionId,
    seasonId,
    homeParticipantId: r.homeParticipantId,
    awayParticipantId: r.awayParticipantId,
    homeParticipant,
    awayParticipant,
    startsAt: r.startsAt,
    status: r.status as EventStatus,
    liveClock,
    period,
    score,
    scores,
  };

  return event;
}

export function toCanonicalOutcome(raw: unknown): CanonicalOutcome {
  assertNoProviderLeakage(raw, "outcome");
  if (typeof raw !== "object" || raw === null) throw new NormalizationError("Outcome must be object");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) throw new NormalizationError("Outcome.id required");
  if (typeof r.marketId !== "string" || !r.marketId) throw new NormalizationError("Outcome.marketId required");
  if (typeof r.label !== "string" || !r.label) throw new NormalizationError("Outcome.label required");
  if (!isMarketState(r.state)) throw new NormalizationError(`Outcome.state invalid: ${r.state}`);
  return {
    id: r.id,
    marketId: r.marketId,
    label: r.label,
    state: r.state as MarketState,
    participantId:
      r.participantId === null || r.participantId === undefined
        ? null
        : typeof r.participantId === "string"
          ? r.participantId
          : null,
  };
}

export function toCanonicalMarket(raw: unknown): CanonicalMarket {
  assertNoProviderLeakage(raw, "market");
  if (typeof raw !== "object" || raw === null) throw new NormalizationError("Market must be object");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) throw new NormalizationError("Market.id required");
  if (typeof r.eventId !== "string" || !r.eventId) throw new NormalizationError("Market.eventId required");
  if (!isMarketType(r.type)) throw new NormalizationError(`Market.type invalid: ${r.type}`);
  if (!isMarketState(r.state)) throw new NormalizationError(`Market.state invalid: ${r.state}`);
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1)
    throw new NormalizationError("Market.version must be integer >=1");

  const line = r.line === null || r.line === undefined ? null : typeof r.line === "string" ? r.line : null;

  if (!Array.isArray(r.outcomes)) throw new NormalizationError("Market.outcomes must be array");
  const outcomes = r.outcomes.map((o) => toCanonicalOutcome(o));

  const seen = new Set<string>();
  for (const o of outcomes) {
    if (seen.has(o.label)) throw new NormalizationError(`Duplicate outcome label "${o.label}" in market ${r.id}`);
    seen.add(o.label);
  }

  return {
    id: r.id,
    eventId: r.eventId,
    type: r.type as MarketType,
    line,
    state: r.state as MarketState,
    version: r.version,
    outcomes,
  };
}

export function toCanonicalPrice(raw: unknown): CanonicalPrice {
  assertNoProviderLeakage(raw, "price");
  if (typeof raw !== "object" || raw === null) throw new NormalizationError("Price must be object");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) throw new NormalizationError("Price.id required");
  if (typeof r.outcomeId !== "string" || !r.outcomeId) throw new NormalizationError("Price.outcomeId required");
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1)
    throw new NormalizationError("Price.version must be integer >=1");
  if (typeof r.decimalOdds !== "string") throw new NormalizationError("Price.decimalOdds must be string");
  assertValidDecimalOddsString(r.decimalOdds);
  if (typeof r.validFrom !== "string" || !r.validFrom) throw new NormalizationError("Price.validFrom required");
  const validTo = r.validTo === null || r.validTo === undefined ? null : typeof r.validTo === "string" ? r.validTo : null;

  return {
    id: r.id,
    outcomeId: r.outcomeId,
    version: r.version,
    decimalOdds: r.decimalOdds,
    validFrom: r.validFrom,
    validTo,
  };
}

export function applyPriceUpdate(
  existing: CanonicalPrice[],
  incoming: CanonicalPrice,
): { accepted: boolean; prices: CanonicalPrice[] } {
  assertNoProviderLeakage(incoming, "incomingPrice");
  toCanonicalPrice(incoming);

  const sameOutcome = existing.filter((p) => p.outcomeId === incoming.outcomeId);
  if (sameOutcome.length === 0) {
    return { accepted: true, prices: [...existing, incoming] };
  }
  const maxVersion = Math.max(...sameOutcome.map((p) => p.version));
  if (incoming.version <= maxVersion) {
    return { accepted: false, prices: existing };
  }
  const updated = [...existing, incoming];
  assertPriceVersionsMonotonic(updated);
  return { accepted: true, prices: updated };
}
