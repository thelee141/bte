import type {
  ClockTick,
  EventStateTick,
  MarketStateTick,
  MatchStatsTick,
  PriceTick,
  RealtimeApplyResult,
  RealtimeBootstrap,
  RealtimeClientView,
  RealtimeEvent,
  RealtimeSnapshot,
  ScoreTick,
} from "./types.js";

export class RealtimeClientState {
  private lastSequenceValue = 0;
  private readonly prices = new Map<string, PriceTick>();
  private readonly markets = new Map<string, MarketStateTick>();
  private readonly events = new Map<string, EventStateTick>();
  private readonly scores = new Map<string, ScoreTick>();
  private readonly clocks = new Map<string, ClockTick>();
  private readonly stats = new Map<string, MatchStatsTick>();

  lastSequence(): number {
    return this.lastSequenceValue;
  }

  applyBootstrap(bootstrap: RealtimeBootstrap): RealtimeApplyResult[] {
    if (bootstrap.mode === "SNAPSHOT") {
      this.applySnapshot(bootstrap.snapshot);
      return [];
    }
    return bootstrap.events.map((event) => this.apply(event));
  }

  applySnapshot(snapshot: RealtimeSnapshot): void {
    this.prices.clear();
    this.markets.clear();
    this.events.clear();
    this.scores.clear();
    this.clocks.clear();
    this.stats.clear();

    for (const price of snapshot.prices) this.prices.set(price.outcomeId, price);
    for (const market of snapshot.markets) this.markets.set(market.marketId, market);
    for (const event of snapshot.events) this.events.set(event.eventId, event);
    for (const score of snapshot.scores) this.scores.set(`${score.eventId}:${score.scope}`, score);
    for (const clock of snapshot.clocks) this.clocks.set(clock.eventId, clock);
    for (const stats of snapshot.stats) this.stats.set(stats.eventId, stats);

    this.lastSequenceValue = snapshot.sequence;
  }

  apply(event: RealtimeEvent): RealtimeApplyResult {
    if (event.sequence <= this.lastSequenceValue) {
      return "IGNORED_SEQUENCE";
    }
    if (event.sequence !== this.lastSequenceValue + 1) {
      return "GAP";
    }

    const applied = this.applyEntity(event);
    this.lastSequenceValue = event.sequence;
    return applied ? "APPLIED" : "IGNORED_ENTITY_STALE";
  }

  view(): RealtimeClientView {
    return {
      lastSequence: this.lastSequenceValue,
      prices: new Map(this.prices),
      markets: new Map(this.markets),
      events: new Map(this.events),
      scores: new Map(this.scores),
      clocks: new Map(this.clocks),
      stats: new Map(this.stats),
    };
  }

  private applyEntity(event: RealtimeEvent): boolean {
    switch (event.kind) {
      case "PRICE": {
        const previous = this.prices.get(event.payload.outcomeId);
        if (previous && previous.version >= event.payload.version) return false;
        this.prices.set(event.payload.outcomeId, event.payload);
        return true;
      }
      case "MARKET_STATE": {
        const previous = this.markets.get(event.payload.marketId);
        if (previous && previous.version >= event.payload.version) return false;
        this.markets.set(event.payload.marketId, event.payload);
        return true;
      }
      case "EVENT_STATE": {
        const previous = this.events.get(event.payload.eventId);
        if (previous && previous.version >= event.payload.version) return false;
        this.events.set(event.payload.eventId, event.payload);
        return true;
      }
      case "SCORE": {
        const key = `${event.payload.eventId}:${event.payload.scope}`;
        const previous = this.scores.get(key);
        if (previous && previous.version >= event.payload.version) return false;
        this.scores.set(key, event.payload);
        return true;
      }
      case "CLOCK": {
        const previous = this.clocks.get(event.payload.eventId);
        if (previous && previous.version >= event.payload.version) return false;
        this.clocks.set(event.payload.eventId, event.payload);
        return true;
      }
      case "STATS": {
        const previous = this.stats.get(event.payload.eventId);
        if (previous && previous.version >= event.payload.version) return false;
        this.stats.set(event.payload.eventId, event.payload);
        return true;
      }
    }
  }
}
