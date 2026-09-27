import { assertNoProviderLeakage, assertValidDecimalOddsString } from "../sports/normalize.js";
import { EventStatus, MarketState } from "../sports/types.js";
import type {
  ClockTick,
  EventStateTick,
  MarketStateTick,
  MatchStatsTick,
  PriceTick,
  PublishResult,
  RealtimeBootstrap,
  RealtimeEvent,
  RealtimeKind,
  RealtimePayload,
  RealtimeSnapshot,
  ScoreTick,
} from "./types.js";

type Subscriber = (event: RealtimeEvent) => void;

export class RealtimeHub {
  private sequence = 0;
  private readonly historyLimit: number;
  private readonly history: RealtimeEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private readonly versions = new Map<string, number>();
  private readonly prices = new Map<string, PriceTick>();
  private readonly markets = new Map<string, MarketStateTick>();
  private readonly events = new Map<string, EventStateTick>();
  private readonly scores = new Map<string, ScoreTick>();
  private readonly clocks = new Map<string, ClockTick>();
  private readonly stats = new Map<string, MatchStatsTick>();
  private readonly clock: () => Date;

  constructor(opts?: { historyLimit?: number; clock?: () => Date }) {
    const historyLimit = opts?.historyLimit ?? 1000;
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error("historyLimit must be an integer >= 1");
    }
    this.historyLimit = historyLimit;
    this.clock = opts?.clock ?? (() => new Date());
  }

  currentSequence(): number {
    return this.sequence;
  }

  publishPrice(payload: PriceTick): PublishResult {
    assertValidDecimalOddsString(payload.decimalOdds);
    return this.publish("PRICE", `price:${payload.outcomeId}`, payload.version, payload);
  }

  publishMarketState(payload: MarketStateTick): PublishResult {
    if (!(Object.values(MarketState) as string[]).includes(payload.state)) {
      throw new Error(`Invalid market state ${payload.state}`);
    }
    return this.publish("MARKET_STATE", `market:${payload.marketId}`, payload.version, payload);
  }

  publishEventState(payload: EventStateTick): PublishResult {
    if (!(Object.values(EventStatus) as string[]).includes(payload.status)) {
      throw new Error(`Invalid event status ${payload.status}`);
    }
    return this.publish("EVENT_STATE", `event:${payload.eventId}`, payload.version, payload);
  }

  publishScore(payload: ScoreTick): PublishResult {
    if (
      !Number.isInteger(payload.home) ||
      payload.home < 0 ||
      !Number.isInteger(payload.away) ||
      payload.away < 0
    ) {
      throw new Error("Score values must be non-negative integers");
    }
    return this.publish(
      "SCORE",
      `score:${payload.eventId}:${payload.scope}`,
      payload.version,
      payload,
    );
  }

  publishClock(payload: ClockTick): PublishResult {
    return this.publish("CLOCK", `clock:${payload.eventId}`, payload.version, payload);
  }

  publishStats(payload: MatchStatsTick): PublishResult {
    const values = [payload.homeCards, payload.awayCards, payload.homeCorners, payload.awayCorners];
    if (values.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error("Match stats values must be non-negative integers");
    }
    return this.publish("STATS", `stats:${payload.eventId}`, payload.version, payload);
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  snapshot(): RealtimeSnapshot {
    return {
      sequence: this.sequence,
      prices: [...this.prices.values()].sort((a, b) => a.outcomeId.localeCompare(b.outcomeId)),
      markets: [...this.markets.values()].sort((a, b) => a.marketId.localeCompare(b.marketId)),
      events: [...this.events.values()].sort((a, b) => a.eventId.localeCompare(b.eventId)),
      scores: [...this.scores.values()].sort(
        (a, b) => a.eventId.localeCompare(b.eventId) || a.scope.localeCompare(b.scope),
      ),
      clocks: [...this.clocks.values()].sort((a, b) => a.eventId.localeCompare(b.eventId)),
      stats: [...this.stats.values()].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    };
  }

  bootstrap(afterSequence?: number | null): RealtimeBootstrap {
    if (afterSequence === undefined || afterSequence === null) {
      return {
        mode: "SNAPSHOT",
        afterSequence: null,
        snapshot: this.snapshot(),
        reason: "NEW_CLIENT",
      };
    }
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative integer");
    }
    if (afterSequence > this.sequence) {
      return {
        mode: "SNAPSHOT",
        afterSequence,
        snapshot: this.snapshot(),
        reason: "CLIENT_AHEAD",
      };
    }
    if (afterSequence === this.sequence) {
      return { mode: "REPLAY", afterSequence, events: [] };
    }

    const oldest = this.history[0]?.sequence;
    if (oldest === undefined || afterSequence < oldest - 1) {
      return {
        mode: "SNAPSHOT",
        afterSequence,
        snapshot: this.snapshot(),
        reason: "REPLAY_GAP",
      };
    }

    return {
      mode: "REPLAY",
      afterSequence,
      events: this.history.filter((event) => event.sequence > afterSequence),
    };
  }

  private publish<K extends RealtimeKind, P extends RealtimePayload>(
    kind: K,
    entityKey: string,
    entityVersion: number,
    payload: P,
  ): PublishResult {
    if (!Number.isInteger(entityVersion) || entityVersion < 1) {
      throw new Error("entityVersion must be an integer >= 1");
    }
    assertNoProviderLeakage(payload, `realtime.${kind}`);

    const currentVersion = this.versions.get(entityKey) ?? 0;
    if (entityVersion <= currentVersion) {
      return { accepted: false, reason: "STALE_OR_DUPLICATE" };
    }

    this.sequence += 1;
    const event = {
      sequence: this.sequence,
      id: String(this.sequence),
      kind,
      entityKey,
      entityVersion,
      publishedAt: this.clock().toISOString(),
      payload,
    } as RealtimeEvent;

    this.versions.set(entityKey, entityVersion);
    this.store(event);
    this.history.push(event);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // A broken client must not break feed ingestion or other subscribers.
      }
    }

    return { accepted: true, event };
  }

  private store(event: RealtimeEvent): void {
    switch (event.kind) {
      case "PRICE":
        this.prices.set(event.payload.outcomeId, event.payload);
        return;
      case "MARKET_STATE":
        this.markets.set(event.payload.marketId, event.payload);
        return;
      case "EVENT_STATE":
        this.events.set(event.payload.eventId, event.payload);
        return;
      case "SCORE":
        this.scores.set(`${event.payload.eventId}:${event.payload.scope}`, event.payload);
        return;
      case "CLOCK":
        this.clocks.set(event.payload.eventId, event.payload);
        return;
      case "STATS":
        this.stats.set(event.payload.eventId, event.payload);
        return;
    }
  }
}
