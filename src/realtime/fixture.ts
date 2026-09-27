import { EventStatus, MarketState, type CanonicalEvent, type CanonicalMarket, type CanonicalPrice, type SportsProvider } from "../sports/types.js";
import type { RealtimeHub } from "./hub.js";
import type { RealtimeEvent } from "./types.js";

function formatOdds(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function oddsHundredths(odds: string): number {
  const [whole, fraction] = odds.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
}

function advanceClock(clock: string | null, seconds: number): string {
  if (!clock || !/^\d+:\d{2}$/.test(clock)) return "00:15";
  const [minutesText, secondsText] = clock.split(":");
  const total = Number.parseInt(minutesText, 10) * 60 + Number.parseInt(secondsText, 10) + seconds;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export class DeterministicRealtimeFixture {
  private readonly provider: SportsProvider;
  private readonly hub: RealtimeHub;
  private readonly baseTime: Date;
  private initialized = false;
  private tick = 0;

  private event!: CanonicalEvent;
  private market!: CanonicalMarket;
  private price!: CanonicalPrice;
  private outcomeId = "";
  private eventVersion = 1;
  private marketVersion = 1;
  private priceVersion = 1;
  private scoreVersion = 1;
  private clockVersion = 1;
  private statsVersion = 1;
  private currentClock: string | null = null;
  private currentHome = 0;
  private currentAway = 0;
  private homeCards = 0;
  private awayCards = 0;
  private homeCorners = 0;
  private awayCorners = 0;

  constructor(
    provider: SportsProvider,
    hub: RealtimeHub,
    opts?: { baseTime?: Date },
  ) {
    this.provider = provider;
    this.hub = hub;
    this.baseTime = opts?.baseTime ?? new Date("2026-09-27T12:00:00.000Z");
  }

  async seed(): Promise<RealtimeEvent[]> {
    if (this.initialized) return [];

    const liveEvents = await this.provider.listEvents({
      sportId: "sport_football",
      liveOnly: true,
    });
    const event = liveEvents[0];
    if (!event) throw new Error("Fixture provider has no live football event");

    const markets = await this.provider.listMarkets(event.id);
    const market = markets.find((candidate) => candidate.state === MarketState.OPEN);
    if (!market) throw new Error(`Live event ${event.id} has no open market`);
    const outcome = market.outcomes.find((candidate) => candidate.state === MarketState.OPEN);
    if (!outcome) throw new Error(`Market ${market.id} has no open outcome`);
    const prices = await this.provider.getPrices(outcome.id);
    const price = [...prices].sort((a, b) => b.version - a.version)[0];
    if (!price) throw new Error(`Outcome ${outcome.id} has no price`);

    this.event = event;
    this.market = market;
    this.price = price;
    this.outcomeId = outcome.id;
    this.marketVersion = market.version;
    this.priceVersion = price.version;
    this.currentClock = event.liveClock ?? null;
    this.currentHome = event.score?.home ?? 0;
    this.currentAway = event.score?.away ?? 0;
    this.homeCards = 1;
    this.awayCards = 0;
    this.homeCorners = 3;
    this.awayCorners = 2;

    const accepted: RealtimeEvent[] = [];
    const push = (result: { accepted: boolean; event?: RealtimeEvent }) => {
      if (result.accepted && result.event) accepted.push(result.event);
    };

    push(
      this.hub.publishEventState({
        eventId: event.id,
        version: this.eventVersion,
        status: EventStatus.LIVE,
      }),
    );
    push(
      this.hub.publishClock({
        eventId: event.id,
        version: this.clockVersion,
        clock: this.currentClock,
        period: event.period ?? "H2",
      }),
    );
    push(
      this.hub.publishScore({
        eventId: event.id,
        version: this.scoreVersion,
        scope: event.score?.scope ?? "FULL",
        home: this.currentHome,
        away: this.currentAway,
        updatedAt: this.baseTime.toISOString(),
      }),
    );
    push(
      this.hub.publishStats({
        eventId: event.id,
        version: this.statsVersion,
        homeCards: this.homeCards,
        awayCards: this.awayCards,
        homeCorners: this.homeCorners,
        awayCorners: this.awayCorners,
      }),
    );
    push(
      this.hub.publishMarketState({
        marketId: market.id,
        eventId: event.id,
        version: this.marketVersion,
        state: market.state,
      }),
    );
    push(
      this.hub.publishPrice({
        outcomeId: outcome.id,
        priceId: price.id,
        version: price.version,
        decimalOdds: price.decimalOdds,
        validFrom: price.validFrom,
        validTo: price.validTo ?? null,
      }),
    );

    this.initialized = true;
    return accepted;
  }

  async nextTick(): Promise<RealtimeEvent> {
    if (!this.initialized) await this.seed();

    const phase = this.tick % 6;
    this.tick += 1;
    const at = new Date(this.baseTime.getTime() + this.tick * 15_000).toISOString();

    if (phase === 0) {
      this.priceVersion += 1;
      const nextOdds = formatOdds(oddsHundredths(this.price.decimalOdds) + this.tick);
      const result = this.hub.publishPrice({
        outcomeId: this.outcomeId,
        priceId: `rt_price_${this.outcomeId}_v${this.priceVersion}`,
        version: this.priceVersion,
        decimalOdds: nextOdds,
        validFrom: at,
        validTo: null,
      });
      if (!result.event) throw new Error("Price tick was rejected");
      return result.event;
    }

    if (phase === 1) {
      this.marketVersion += 1;
      const result = this.hub.publishMarketState({
        marketId: this.market.id,
        eventId: this.event.id,
        version: this.marketVersion,
        state: MarketState.SUSPENDED,
      });
      if (!result.event) throw new Error("Suspend tick was rejected");
      return result.event;
    }

    if (phase === 2) {
      this.clockVersion += 1;
      this.currentClock = advanceClock(this.currentClock, 15);
      const result = this.hub.publishClock({
        eventId: this.event.id,
        version: this.clockVersion,
        clock: this.currentClock,
        period: this.event.period ?? "H2",
      });
      if (!result.event) throw new Error("Clock tick was rejected");
      return result.event;
    }

    if (phase === 3) {
      this.scoreVersion += 1;
      this.currentHome += 1;
      const result = this.hub.publishScore({
        eventId: this.event.id,
        version: this.scoreVersion,
        scope: this.event.score?.scope ?? "FULL",
        home: this.currentHome,
        away: this.currentAway,
        updatedAt: at,
      });
      if (!result.event) throw new Error("Score tick was rejected");
      return result.event;
    }

    if (phase === 4) {
      this.statsVersion += 1;
      this.homeCorners += 1;
      const result = this.hub.publishStats({
        eventId: this.event.id,
        version: this.statsVersion,
        homeCards: this.homeCards,
        awayCards: this.awayCards,
        homeCorners: this.homeCorners,
        awayCorners: this.awayCorners,
      });
      if (!result.event) throw new Error("Stats tick was rejected");
      return result.event;
    }

    this.marketVersion += 1;
    const result = this.hub.publishMarketState({
      marketId: this.market.id,
      eventId: this.event.id,
      version: this.marketVersion,
      state: MarketState.OPEN,
    });
    if (!result.event) throw new Error("Reopen tick was rejected");
    return result.event;
  }
}
