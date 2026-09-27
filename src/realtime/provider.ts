import type {
  CanonicalEvent,
  CanonicalMarket,
  CanonicalPrice,
  EventFilter,
  SportsProvider,
} from "../sports/types.js";
import { EventStatus, MarketState } from "../sports/types.js";
import type { RealtimeHub } from "./hub.js";
import type { RealtimeSnapshot } from "./types.js";

function overlayEvent(event: CanonicalEvent, snapshot: RealtimeSnapshot): CanonicalEvent {
  const state = snapshot.events.find((candidate) => candidate.eventId === event.id);
  const clock = snapshot.clocks.find((candidate) => candidate.eventId === event.id);
  const scoreTicks = snapshot.scores.filter((candidate) => candidate.eventId === event.id);

  const scores =
    scoreTicks.length > 0
      ? scoreTicks.map((score) => ({
          id: `rt_score_${score.eventId}_${score.scope}_v${score.version}`,
          eventId: score.eventId,
          scope: score.scope,
          home: score.home,
          away: score.away,
          updatedAt: score.updatedAt,
        }))
      : event.scores;

  const primaryScore =
    scores?.find((score) => score.scope === "FULL") ??
    scores?.[0] ??
    event.score ??
    null;

  return {
    ...event,
    status: state?.status ?? event.status,
    liveClock: clock?.clock ?? event.liveClock ?? null,
    period: clock?.period ?? event.period ?? null,
    score: primaryScore,
    scores,
  };
}

function applyStatusFilter(events: CanonicalEvent[], filter?: EventFilter): CanonicalEvent[] {
  if (!filter) return events;
  let result = events;
  if (filter.status) result = result.filter((event) => event.status === filter.status);
  if (filter.statuses && filter.statuses.length > 0) {
    const statuses = new Set(filter.statuses);
    result = result.filter((event) => statuses.has(event.status));
  }
  if (filter.liveOnly) result = result.filter((event) => event.status === EventStatus.LIVE);
  return result;
}

export class RealtimeOverlayProvider implements SportsProvider {
  public readonly providerId: string;
  private readonly base: SportsProvider;
  private readonly hub: RealtimeHub;

  constructor(base: SportsProvider, hub: RealtimeHub) {
    this.base = base;
    this.hub = hub;
    this.providerId = `realtime:${base.providerId}`;
  }

  async listSports() {
    return this.base.listSports();
  }

  async listEvents(filter?: EventFilter): Promise<CanonicalEvent[]> {
    const baseFilter = filter
      ? {
          ...filter,
          status: undefined,
          statuses: undefined,
          liveOnly: undefined,
        }
      : undefined;

    const snapshot = this.hub.snapshot();
    const events = await this.base.listEvents(baseFilter);
    return applyStatusFilter(events.map((event) => overlayEvent(event, snapshot)), filter);
  }

  async getEvent(eventId: string): Promise<CanonicalEvent | null> {
    const event = await this.base.getEvent(eventId);
    if (!event) return null;
    return overlayEvent(event, this.hub.snapshot());
  }

  async listMarkets(eventId: string): Promise<CanonicalMarket[]> {
    const markets = await this.base.listMarkets(eventId);
    const snapshot = this.hub.snapshot();
    const stateByMarket = new Map(snapshot.markets.map((market) => [market.marketId, market]));

    return markets.map((market) => {
      const update = stateByMarket.get(market.id);
      if (!update) return market;
      return {
        ...market,
        state: update.state,
        version: update.version,
        outcomes: market.outcomes.map((outcome) => ({
          ...outcome,
          state: update.state === MarketState.OPEN ? outcome.state : update.state,
        })),
      };
    });
  }

  async getPrices(outcomeId: string): Promise<CanonicalPrice[]> {
    const prices = await this.base.getPrices(outcomeId);
    const tick = this.hub.snapshot().prices.find((candidate) => candidate.outcomeId === outcomeId);
    if (!tick) return prices;

    const maxBaseVersion = prices.reduce((max, price) => Math.max(max, price.version), 0);
    if (tick.version <= maxBaseVersion) return prices;

    return [
      ...prices,
      {
        id: tick.priceId,
        outcomeId: tick.outcomeId,
        version: tick.version,
        decimalOdds: tick.decimalOdds,
        validFrom: tick.validFrom,
        validTo: tick.validTo,
      },
    ].sort((a, b) => a.version - b.version);
  }
}
