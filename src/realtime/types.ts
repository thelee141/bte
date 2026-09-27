import type { EventStatus, MarketState } from "../sports/types.js";

export type RealtimeKind = "PRICE" | "MARKET_STATE" | "EVENT_STATE" | "SCORE" | "CLOCK" | "STATS";

export interface PriceTick {
  readonly outcomeId: string;
  readonly priceId: string;
  readonly version: number;
  readonly decimalOdds: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface MarketStateTick {
  readonly marketId: string;
  readonly eventId: string;
  readonly version: number;
  readonly state: MarketState;
}

export interface EventStateTick {
  readonly eventId: string;
  readonly version: number;
  readonly status: EventStatus;
}

export interface ScoreTick {
  readonly eventId: string;
  readonly version: number;
  readonly scope: string;
  readonly home: number;
  readonly away: number;
  readonly updatedAt: string;
}

export interface ClockTick {
  readonly eventId: string;
  readonly version: number;
  readonly clock: string | null;
  readonly period: string | null;
}

export interface MatchStatsTick {
  readonly eventId: string;
  readonly version: number;
  readonly homeCards: number;
  readonly awayCards: number;
  readonly homeCorners: number;
  readonly awayCorners: number;
}

export type RealtimePayload =
  | PriceTick
  | MarketStateTick
  | EventStateTick
  | ScoreTick
  | ClockTick
  | MatchStatsTick;

interface RealtimeEventBase<K extends RealtimeKind, P extends RealtimePayload> {
  readonly sequence: number;
  readonly id: string;
  readonly kind: K;
  readonly entityKey: string;
  readonly entityVersion: number;
  readonly publishedAt: string;
  readonly payload: P;
}

export type RealtimeEvent =
  | RealtimeEventBase<"PRICE", PriceTick>
  | RealtimeEventBase<"MARKET_STATE", MarketStateTick>
  | RealtimeEventBase<"EVENT_STATE", EventStateTick>
  | RealtimeEventBase<"SCORE", ScoreTick>
  | RealtimeEventBase<"CLOCK", ClockTick>
  | RealtimeEventBase<"STATS", MatchStatsTick>;

export interface RealtimeSnapshot {
  readonly sequence: number;
  readonly prices: ReadonlyArray<PriceTick>;
  readonly markets: ReadonlyArray<MarketStateTick>;
  readonly events: ReadonlyArray<EventStateTick>;
  readonly scores: ReadonlyArray<ScoreTick>;
  readonly clocks: ReadonlyArray<ClockTick>;
  readonly stats: ReadonlyArray<MatchStatsTick>;
}

export type RealtimeBootstrap =
  | {
      readonly mode: "REPLAY";
      readonly afterSequence: number;
      readonly events: ReadonlyArray<RealtimeEvent>;
    }
  | {
      readonly mode: "SNAPSHOT";
      readonly afterSequence: number | null;
      readonly snapshot: RealtimeSnapshot;
      readonly reason: "NEW_CLIENT" | "REPLAY_GAP" | "CLIENT_AHEAD";
    };

export interface PublishResult {
  readonly accepted: boolean;
  readonly event?: RealtimeEvent;
  readonly reason?: "STALE_OR_DUPLICATE";
}

export type RealtimeApplyResult =
  | "APPLIED"
  | "IGNORED_SEQUENCE"
  | "IGNORED_ENTITY_STALE"
  | "GAP";

export interface RealtimeClientView {
  readonly lastSequence: number;
  readonly prices: ReadonlyMap<string, PriceTick>;
  readonly markets: ReadonlyMap<string, MarketStateTick>;
  readonly events: ReadonlyMap<string, EventStateTick>;
  readonly scores: ReadonlyMap<string, ScoreTick>;
  readonly clocks: ReadonlyMap<string, ClockTick>;
  readonly stats: ReadonlyMap<string, MatchStatsTick>;
}
