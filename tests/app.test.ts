import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AddressInfo } from "node:net";
import { createCustomerServer } from "../src/app/server.js";
import type { ApiBootstrap, ApiReceipt } from "../src/app/contracts.js";
import { cleanDatabase } from "./helpers/db.js";

let baseUrl = "";
let serverBundle: Awaited<ReturnType<typeof createCustomerServer>> | null = null;

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: (await response.json()) as T,
  };
}

beforeAll(async () => {
  const cleanupPrisma = new PrismaClient();
  await cleanDatabase(cleanupPrisma);
  await cleanupPrisma.$disconnect();

  serverBundle = await createCustomerServer();
  await new Promise<void>((resolve, reject) => {
    serverBundle!.server.once("error", reject);
    serverBundle!.server.listen(0, "127.0.0.1", () => {
      serverBundle!.server.off("error", reject);
      resolve();
    });
  });

  const address = serverBundle.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!serverBundle) return;
  await new Promise<void>((resolve) => serverBundle!.server.close(() => resolve()));
  await cleanDatabase(serverBundle.context.prisma);
  await serverBundle.context.prisma.$disconnect();
});

describe("customer HTTP surface", () => {
  it("boots catalogue -> persists slip -> places bet -> returns receipt and open history", async () => {
    const bootstrapResponse = await jsonRequest<ApiBootstrap>("/api/bootstrap");
    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.body.demo.playMoney).toBe(true);
    expect(bootstrapResponse.body.events.length).toBeGreaterThan(0);

    const candidate = bootstrapResponse.body.events
      .flatMap((event) =>
        event.markets.flatMap((market) =>
          market.outcomes.map((outcome) => ({ event, market, outcome })),
        ),
      )
      .find(
        ({ market, outcome }) =>
          market.state === "OPEN" &&
          outcome.state === "OPEN" &&
          outcome.price !== null,
      );

    if (!candidate) throw new Error("No authoritative open priced selection in bootstrap");

    const selectionResponse = await jsonRequest<{ slip: ApiBootstrap["slip"] }>(
      "/api/slip/selection",
      {
        method: "POST",
        body: JSON.stringify({
          eventId: candidate.event.id,
          marketId: candidate.market.id,
          outcomeId: candidate.outcome.id,
        }),
      },
    );
    expect(selectionResponse.status).toBe(200);
    expect(selectionResponse.body.slip.selections).toHaveLength(1);

    const stakeResponse = await jsonRequest<{ slip: ApiBootstrap["slip"] }>(
      "/api/slip/stake",
      {
        method: "POST",
        body: JSON.stringify({ stakeMinor: 1000 }),
      },
    );
    expect(stakeResponse.status).toBe(200);
    expect(stakeResponse.body.slip.stakeMinor).toBe(1000);

    const idempotencyKey = "http_surface_place_1";
    const placed = await jsonRequest<{ receipt: ApiReceipt; slip: ApiBootstrap["slip"] }>(
      "/api/bets/place",
      {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      },
    );

    expect(placed.status).toBe(201);
    expect(placed.body.receipt.betRef).toMatch(/^BT-/);
    expect(placed.body.receipt.txnRef).toMatch(/^[0-9a-f-]{36}$/);
    expect(placed.body.receipt.stakeMinor).toBe(1000);
    expect(placed.body.receipt.legCount).toBe(1);
    expect(placed.body.slip.selections).toHaveLength(0);

    const history = await jsonRequest<{
      bets: Array<{ betId: string; betRef: string; status: string }>;
    }>("/api/bets?state=OPEN");

    expect(history.status).toBe(200);
    expect(history.body.bets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          betRef: placed.body.receipt.betRef,
          status: "ACCEPTED",
        }),
      ]),
    );

    const stored = await serverBundle!.context.prisma.bet.findUnique({
      where: { idempotencyKey },
    });
    expect(stored?.txnRef).toBe(placed.body.receipt.txnRef);
  });
});
