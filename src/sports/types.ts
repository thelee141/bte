/**
 * Canonical sports domain model.
 * Server-authoritative: canonical objects must NEVER carry provider IDs.
 * Decimal odds are STRING (e.g. "1.38"), never float.
 */

export enum EventStatus {
  SCHEDULED = "SCHEDULED",
  LIVE = "LIVE",
  PAUSED = "PAUSED",
  SUSPENDED = "SUSPENDED",
  FINAL = "FINAL",
  ABANDONED = "ABANDONED",
  CANCELLED = "CANCELLED",
}

export enum MarketState {
  OPEN = "OPEN",
  SUSPENDED = "SUSPENDED",
  SETTLED = "SETTLED",
  VOIDED = "VOIDED",
}

export enum MarketType {
  ONE_X_TWO = "1X2",
  OVER_UNDER = "OU",
  BTTS = "BTTS",
  DOUBLE_CHANCE = "DC",
  DRAW_NO_BET = "DNB",
  HANDICAP = "HC",
  CORRECT_SCORE = "CS",
  OTHER = "OTHER",
}

export type ScoreScope = "FULL" | "HT" | "Q1" | "Q2" | "Q3" | "Q4" | "OT" | string;

export const DECIMAL_ODDS_REGEX = /^\d+\.\d{2}$/;

// --- Catalogue hierarchy ---

export interface CanonicalSport {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly active?: boolean;
}

export interface CanonicalCategory {
  readonly id: string;
  readonly sportId: string;
  readonly slug: string;
  readonly name: string;
  readonly region?: string;
}

export interface CanonicalCompetition {
  readonly id: string;
  readonly sportId: string;
  readonly categoryId: string;
  readonly slug: string;
  readonly name: string;
}

export interface CanonicalSeason {
  readonly id: string;
  readonly competitionId: string;
  readonly slug: string;
  readonly name: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export interface CanonicalParticipant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string;
  readonly country?: string;
}

export interface CanonicalScore {
  readonly id: string;
  readonly eventId: string;
  readonly scope: ScoreScope;
  readonly home: number;
  readonly away: number;
  readonly updatedAt: string;
}

export interface CanonicalEventState {
  readonly id: string;
  readonly eventId: string;
  readonly status: EventStatus;
  readonly previousStatus?: EventStatus | null;
  readonly changedAt: string;
  readonly reason?: string | null;
}

export interface CanonicalEvent {
  readonly id: string;
  readonly slug: string;
  readonly sportId: string;
  readonly categoryId: string;
  readonly competitionId: string;
  readonly seasonId?: string | null;
  readonly homeParticipantId: string;
  readonly awayParticipantId: string;
  readonly homeParticipant: CanonicalParticipant;
  readonly awayParticipant: CanonicalParticipant;
  readonly startsAt: string; // ISO8601
  readonly status: EventStatus;
  readonly liveClock?: string | null;
  readonly period?: string | null;
  readonly score?: CanonicalScore | null;
  readonly scores?: CanonicalScore[];
}

export interface CanonicalOutcome {
  readonly id: string;
  readonly marketId: string;
  readonly label: string;
  readonly state: MarketState;
  readonly participantId?: string | null;
}

export interface CanonicalMarket {
  readonly id: string;
  readonly eventId: string;
  readonly type: MarketType;
  readonly line?: string | null;
  readonly state: MarketState;
  readonly version: number;
  readonly outcomes: CanonicalOutcome[];
}

export interface CanonicalPrice {
  readonly id: string;
  readonly outcomeId: string;
  readonly version: number;
  readonly decimalOdds: string; // e.g. "1.38"
  readonly validFrom: string; // ISO8601
  readonly validTo?: string | null;
}

export interface CanonicalMarketState {
  readonly id: string;
  readonly marketId: string;
  readonly state: MarketState;
  readonly version: number;
  readonly changedAt: string;
}

// --- TradingLimit placeholder (structure only) ---

export interface CanonicalTradingLimit {
  readonly id: string;
  readonly marketId?: string | null;
  readonly outcomeId?: string | null;
  readonly minStake?: string | null;
  readonly maxStake?: string | null;
  readonly maxPayout?: string | null;
}

// --- Provider isolation ---

export interface ProviderNativeMapping {
  readonly canonicalId: string;
  readonly providerId: string;
  readonly nativeId: string;
}

export interface CanonicalProvider {
  readonly id: string;
  readonly name: string;
  readonly displayName?: string;
  readonly active: boolean;
}

// --- Provider adapter boundary ---

export interface EventFilter {
  readonly sportId?: string;
  readonly categoryId?: string;
  readonly competitionId?: string;
  readonly eventIds?: string[];
  readonly status?: EventStatus;
  readonly statuses?: EventStatus[];
  readonly from?: string;
  readonly to?: string;
  readonly liveOnly?: boolean;
}

export interface SportsProvider {
  readonly providerId: string;
  listSports(): Promise<CanonicalSport[]>;
  listEvents(filter?: EventFilter): Promise<CanonicalEvent[]>;
  getEvent(eventId: string): Promise<CanonicalEvent | null>;
  listMarkets(eventId: string): Promise<CanonicalMarket[]>;
  getPrices(outcomeId: string): Promise<CanonicalPrice[]>;
}

// --- Utility type guards ---

export function isEventStatus(v: unknown): v is EventStatus {
  return typeof v === "string" && (Object.values(EventStatus) as string[]).includes(v);
}

export function isMarketState(v: unknown): v is MarketState {
  return typeof v === "string" && (Object.values(MarketState) as string[]).includes(v);
}

export function isMarketType(v: unknown): v is MarketType {
  return typeof v === "string" && (Object.values(MarketType) as string[]).includes(v);
}
