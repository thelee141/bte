import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { get as httpGet, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { BettingService } from "../src/betting/service.js";
import { BetslipService } from "../src/betslip/service.js";
import { RealtimeClientState } from "../src/realtime/client.js";
import { DeterministicRealtimeFixture } from "../src/realtime/fixture.js";
import { RealtimeHub } from "../src/realtime/hub.js";
import { RealtimeOverlayProvider } from "../src/realtime/provider.js";
import { RealtimeSseGateway } from "../src/realtime/sse.js";
import type { RealtimeEvent } from "../src/realtime/types.js";
import { FixtureSportsProvider } from "../src/sports/provider.js";
import { MarketState } from "../src/sports/types.js";
import { FundingService } from "../src/wallet/funding.js";
import { LedgerService } from "../src/wallet/ledger.js";
import { toMinorUnits } from "../src/wallet/money.js";
import { cleanDatabase } from "./helpers/db.js";

const prisma = new PrismaClient();
const ledger = new LedgerService(prisma);
const funding = new FundingService(prisma, ledger);

beforeEach(async () => {
  await cleanDatabase(prisma);
  await ledger.ensureSystemAccounts();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function priceTick(version: number, odds = "2.00") {
  return {
    outcomeId: "outcome_1",
    priceId: `price_${version}`,
    version,
    decimalOdds: odds,
    validFrom: `2026-09-27T12:00:0${Math.min(version, 9)}.000Z`,
    validTo: null,
  };
}

function eventWithSequence(sequence: number, version: number): RealtimeEvent {
  return {
    sequence,
    id: String(sequence),
    kind: "PRICE",
    entityKey: "price:outcome_1",
    entityVersion: version,
    publishedAt: "2026-09-27T12:00:00.000Z",
    payload: priceTick(version),
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readSseUntil(input: {
  port: number;
  path?: string;
  headers?: Record<string, string>;
  marker: string;
  onOpen?: () => void;
}): Promise<{ body: string; contentType?: string; cacheControl?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      request.destroy();
      reject(new Error(`Timed out waiting for SSE marker ${input.marker}`));
    }, 3000);

    let body = "";
    const request = httpGet(
      {
        host: "127.0.0.1",
        port: input.port,
        path: input.path ?? "/stream",
        headers: input.headers,
      },
      (response) => {
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          request.destroy();
          reject(new Error(`Unexpected SSE status ${response.statusCode}`));
          return;
        }

        input.onOpen?.();
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (body.includes(input.marker)) {
            clearTimeout(timeout);
            response.destroy();
            request.destroy();
            resolve({
              body,
              contentType: response.headers["content-type"],
              cacheControl: response.headers["cache-control"],
            });
          }
        });
      },
    );

    request.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET" && body.includes(input.marker)) return;
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe("realtime hub + SSE", () => {
  it("rejects stale/duplicate entity versions without advancing the stream sequence", () => {
    const hub = new RealtimeHub();

    const first = hub.publishPrice(priceTick(3, "2.10"));
    const duplicate = hub.publishPrice(priceTick(3, "2.20"));
    const stale = hub.publishPrice(priceTick(2, "2.30"));

    expect(first.accepted).toBe(true);
    expect(first.event?.sequence).toBe(1);
    expect(duplicate).toMatchObject({ accepted: false, reason: "STALE_OR_DUPLICATE" });
    expect(stale).toMatchObject({ accepted: false, reason: "STALE_OR_DUPLICATE" });
    expect(hub.currentSequence()).toBe(1);
    expect(hub.snapshot().prices[0].decimalOdds).toBe("2.10");
  });

  it("isolates subscriber failures so one broken client cannot break ingestion", () => {
    const hub = new RealtimeHub();
    let healthyCalls = 0;

    hub.subscribe(() => {
      throw new Error("broken subscriber");
    });
    hub.subscribe(() => {
      healthyCalls += 1;
    });

    expect(hub.publishPrice(priceTick(1)).accepted).toBe(true);
    expect(healthyCalls).toBe(1);
    expect(hub.currentSequence()).toBe(1);
  });

  it("replays retained events after a reconnect cursor", () => {
    const hub = new RealtimeHub({ historyLimit: 10 });
    hub.publishPrice(priceTick(1));
    hub.publishMarketState({
      marketId: "market_1",
      eventId: "event_1",
      version: 1,
      state: MarketState.OPEN,
    });
    hub.publishClock({ eventId: "event_1", version: 1, clock: "10:00", period: "H1" });

    const bootstrap = hub.bootstrap(1);
    expect(bootstrap.mode).toBe("REPLAY");
    if (bootstrap.mode !== "REPLAY") throw new Error("Expected replay");
    expect(bootstrap.events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("forces a snapshot when reconnect history has fallen out of the bounded journal", () => {
    const hub = new RealtimeHub({ historyLimit: 2 });
    hub.publishPrice(priceTick(1));
    hub.publishMarketState({
      marketId: "market_1",
      eventId: "event_1",
      version: 1,
      state: MarketState.OPEN,
    });
    hub.publishClock({ eventId: "event_1", version: 1, clock: "10:00", period: "H1" });
    hub.publishStats({
      eventId: "event_1",
      version: 1,
      homeCards: 1,
      awayCards: 0,
      homeCorners: 2,
      awayCorners: 1,
    });

    const bootstrap = hub.bootstrap(1);
    expect(bootstrap.mode).toBe("SNAPSHOT");
    if (bootstrap.mode !== "SNAPSHOT") throw new Error("Expected snapshot");
    expect(bootstrap.reason).toBe("REPLAY_GAP");
    expect(bootstrap.snapshot.sequence).toBe(4);
    expect(bootstrap.snapshot.stats[0].homeCards).toBe(1);
  });

  it("client state detects sequence gaps and refuses stale entity versions", () => {
    const client = new RealtimeClientState();

    expect(client.apply(eventWithSequence(2, 1))).toBe("GAP");
    expect(client.lastSequence()).toBe(0);

    client.applySnapshot({
      sequence: 1,
      prices: [priceTick(2, "2.22")],
      markets: [],
      events: [],
      scores: [],
      clocks: [],
      stats: [],
    });

    expect(client.apply(eventWithSequence(2, 1))).toBe("IGNORED_ENTITY_STALE");
    expect(client.lastSequence()).toBe(2);
    expect(client.view().prices.get("outcome_1")?.version).toBe(2);
  });

  it("deterministic fixture emits price, suspend, clock, score, stats, and reopen ticks", async () => {
    const provider = new FixtureSportsProvider("realtime-feed-test");
    const hub = new RealtimeHub();
    const feed = new DeterministicRealtimeFixture(provider, hub);

    const seeded = await feed.seed();
    expect(seeded.map((event) => event.kind)).toEqual([
      "EVENT_STATE",
      "CLOCK",
      "SCORE",
      "STATS",
      "MARKET_STATE",
      "PRICE",
    ]);

    const ticks: RealtimeEvent[] = [];
    for (let index = 0; index < 6; index++) ticks.push(await feed.nextTick());

    expect(ticks.map((event) => event.kind)).toEqual([
      "PRICE",
      "MARKET_STATE",
      "CLOCK",
      "SCORE",
      "STATS",
      "MARKET_STATE",
    ]);
    expect(ticks[1].kind).toBe("MARKET_STATE");
    if (ticks[1].kind !== "MARKET_STATE" || ticks[5].kind !== "MARKET_STATE") {
      throw new Error("Expected market state ticks");
    }
    expect(ticks[1].payload.state).toBe(MarketState.SUSPENDED);
    expect(ticks[5].payload.state).toBe(MarketState.OPEN);
  });

  it("delivers a suspension to a connected client in the same published tick", async () => {
    const provider = new FixtureSportsProvider("realtime-suspend-test");
    const hub = new RealtimeHub();
    const feed = new DeterministicRealtimeFixture(provider, hub);
    const client = new RealtimeClientState();

    await feed.seed();
    client.applySnapshot(hub.snapshot());

    const unsubscribe = hub.subscribe((event) => {
      expect(client.apply(event)).not.toBe("GAP");
    });

    try {
      await feed.nextTick(); // price
      const suspend = await feed.nextTick();
      if (suspend.kind !== "MARKET_STATE") throw new Error("Expected suspension");

      expect(client.lastSequence()).toBe(hub.currentSequence());
      expect(client.view().markets.get(suspend.payload.marketId)?.state).toBe(MarketState.SUSPENDED);
    } finally {
      unsubscribe();
    }
  });

  it("replays missed ticks on reconnect without regressing price or market state", async () => {
    const provider = new FixtureSportsProvider("realtime-reconnect-test");
    const hub = new RealtimeHub({ historyLimit: 20 });
    const feed = new DeterministicRealtimeFixture(provider, hub);
    const client = new RealtimeClientState();

    await feed.seed();
    client.applySnapshot(hub.snapshot());
    const disconnectedAt = client.lastSequence();

    const price = await feed.nextTick();
    const suspend = await feed.nextTick();
    await feed.nextTick(); // clock while disconnected

    const reconnect = hub.bootstrap(disconnectedAt);
    expect(reconnect.mode).toBe("REPLAY");
    const results = client.applyBootstrap(reconnect);
    expect(results).not.toContain("GAP");
    expect(client.lastSequence()).toBe(hub.currentSequence());

    if (price.kind !== "PRICE" || suspend.kind !== "MARKET_STATE") {
      throw new Error("Unexpected deterministic tick kinds");
    }
    expect(client.view().prices.get(price.payload.outcomeId)?.version).toBe(price.payload.version);
    expect(client.view().markets.get(suspend.payload.marketId)?.state).toBe(MarketState.SUSPENDED);
  });

  it("realtime price state is authoritative to placement and rejects the pre-tick quote", async () => {
    const base = new FixtureSportsProvider("realtime-placement-test");
    const hub = new RealtimeHub();
    const feed = new DeterministicRealtimeFixture(base, hub);
    const provider = new RealtimeOverlayProvider(base, hub);

    const liveEvents = await base.listEvents({ sportId: "sport_football", liveOnly: true });
    const event = liveEvents[0];
    const market = (await base.listMarkets(event.id)).find((candidate) => candidate.state === MarketState.OPEN);
    if (!market) throw new Error("No open market");
    const outcome = market.outcomes[0];
    const oldPrice = [...(await base.getPrices(outcome.id))].sort((a, b) => b.version - a.version)[0];

    await feed.seed();
    const priceMove = await feed.nextTick();
    expect(priceMove.kind).toBe("PRICE");

    const overlayLatest = [...(await provider.getPrices(outcome.id))].sort((a, b) => b.version - a.version)[0];
    expect(overlayLatest.version).toBe(oldPrice.version + 1);

    const owner = `user_${randomUUID()}`;
    await ledger.createAccount(owner, "REAL", "NGN");
    await funding.grantPlayMoney({
      userId: owner,
      amount: toMinorUnits("100.00"),
      idempotencyKey: `grant_${randomUUID()}`,
    });

    const betting = new BettingService({ prisma, ledger, funding, provider });
    await expect(
      betting.placeBet({
        userId: owner,
        idempotencyKey: `bet_${randomUUID()}`,
        stakeMinor: toMinorUnits("10.00"),
        legs: [
          {
            eventId: event.id,
            marketId: market.id,
            outcomeId: outcome.id,
            expectedPriceVersion: oldPrice.version,
            expectedDecimalOdds: oldPrice.decimalOdds,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "STALE_PRICE" });
  });

  it("market suspension reaches persisted betslip reconciliation immediately", async () => {
    const base = new FixtureSportsProvider("realtime-betslip-test");
    const hub = new RealtimeHub();
    const feed = new DeterministicRealtimeFixture(base, hub);
    const provider = new RealtimeOverlayProvider(base, hub);
    const slips = new BetslipService({ prisma, provider });

    const liveEvents = await base.listEvents({ sportId: "sport_football", liveOnly: true });
    const event = liveEvents[0];
    const market = (await base.listMarkets(event.id)).find((candidate) => candidate.state === MarketState.OPEN);
    if (!market) throw new Error("No open market");
    const outcome = market.outcomes[0];

    await feed.seed();

    const owner = `user_${randomUUID()}`;
    const slip = await slips.createSlip({ userId: owner });
    await slips.toggleSelection({
      userId: owner,
      slipId: slip.id,
      eventId: event.id,
      marketId: market.id,
      outcomeId: outcome.id,
    });

    await feed.nextTick(); // price move
    await slips.acceptPriceChanges(owner, slip.id);
    const suspend = await feed.nextTick();
    expect(suspend.kind).toBe("MARKET_STATE");

    const reconciled = await slips.reconcileSlip(owner, slip.id);
    expect(reconciled.selections[0].status).toBe("SUSPENDED");
  });

  it("SSE sends a snapshot to a new client using proper event-stream framing", async () => {
    const hub = new RealtimeHub();
    hub.publishPrice(priceTick(1));
    const gateway = new RealtimeSseGateway(hub, { heartbeatMs: 5000 });
    const server = gateway.createServer();
    const port = await listen(server);

    try {
      const { body, contentType, cacheControl } = await readSseUntil({
        port,
        marker: "event: snapshot",
      });
      expect(contentType).toBe("text/event-stream; charset=utf-8");
      expect(cacheControl).toBe("no-cache, no-transform");
      expect(body).toContain("retry: 2000");
      expect(body).toContain("id: 1");
      expect(body).toContain('"reason":"NEW_CLIENT"');
      expect(body).toContain('"decimalOdds":"2.00"');
    } finally {
      await close(server);
    }
  });

  it("SSE honors Last-Event-ID and replays only events after the cursor", async () => {
    const hub = new RealtimeHub();
    hub.publishPrice(priceTick(1));
    hub.publishMarketState({
      marketId: "market_1",
      eventId: "event_1",
      version: 1,
      state: MarketState.OPEN,
    });

    const gateway = new RealtimeSseGateway(hub, { heartbeatMs: 5000 });
    const server = gateway.createServer();
    const port = await listen(server);

    try {
      const { body } = await readSseUntil({
        port,
        headers: { "Last-Event-ID": "1" },
        marker: "event: market_state",
      });
      expect(body).toContain("id: 2");
      expect(body).toContain("event: market_state");
      expect(body).not.toContain("event: snapshot");
      expect(body).not.toContain("id: 1\nevent: price");
    } finally {
      await close(server);
    }
  });

  it("SSE forwards live events published after bootstrap without a sequence gap", async () => {
    const hub = new RealtimeHub();
    hub.publishPrice(priceTick(1));
    const gateway = new RealtimeSseGateway(hub, { heartbeatMs: 5000 });
    const server = gateway.createServer();
    const port = await listen(server);

    try {
      const { body } = await readSseUntil({
        port,
        marker: "event: market_state",
        onOpen: () => {
          setTimeout(() => {
            hub.publishMarketState({
              marketId: "market_live",
              eventId: "event_live",
              version: 1,
              state: MarketState.SUSPENDED,
            });
          }, 25);
        },
      });

      expect(body).toContain("event: snapshot");
      expect(body).toContain("id: 2");
      expect(body).toContain("event: market_state");
    } finally {
      await close(server);
    }
  });

  it("rejects provider-specific identifiers from realtime payloads", () => {
    const hub = new RealtimeHub();
    const contaminated = {
      ...priceTick(1),
      providerId: "should-not-leak",
    };

    expect(() => hub.publishPrice(contaminated)).toThrow(/Provider leakage/);
  });
});
