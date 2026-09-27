import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { BetError } from "../betting/errors.js";
import { BetslipError } from "../betslip/errors.js";
import { SettlementError } from "../settlement/errors.js";
import { WalletError } from "../wallet/types.js";
import { toMinorUnits } from "../wallet/money.js";
import {
  DEMO_CURRENCY,
  DEMO_USER_ID,
  demoBalanceMinor,
  ensureDemoDraftSlip,
  type AppContext,
} from "./context.js";
import type {
  ApiBetHistory,
  ApiBootstrap,
  ApiErrorBody,
  ApiEvent,
  ApiReceipt,
  ApiSlip,
} from "./contracts.js";

const MAX_JSON_BODY_BYTES = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function noContent(res: ServerResponse): void {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON_OBJECT");
  }
  return parsed as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`INVALID_FIELD:${field}`);
  }
  return value;
}

function integerField(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`INVALID_FIELD:${field}`);
  }
  return value;
}

function serializeHistory(item: Awaited<ReturnType<AppContext["settlement"]["listBetHistory"]>>[number]): ApiBetHistory {
  return {
    betId: item.betId,
    betRef: item.betRef,
    stakeMinor: item.stakeMinor,
    totalOdds: item.totalOdds,
    potentialWinMinor: item.potentialWinMinor,
    currency: item.currency,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    settledAt: item.settledAt?.toISOString() ?? null,
    settlement: item.settlement
      ? {
          resultVersion: item.settlement.resultVersion,
          outcome: item.settlement.outcome,
          creditMinor: item.settlement.creditMinor,
          createdAt: item.settlement.createdAt.toISOString(),
        }
      : null,
  };
}

async function projectSlip(context: AppContext, slipId: string): Promise<ApiSlip> {
  const reconciled = await context.betslip.reconcileSlip(DEMO_USER_ID, slipId);
  const freshness = new Map(
    reconciled.selections.map((selection) => [selection.selectionId, selection]),
  );

  return {
    id: reconciled.slip.id,
    mode: reconciled.slip.mode,
    currency: reconciled.slip.currency,
    stakeMinor: reconciled.slip.stakeMinor,
    blocked: reconciled.blocked,
    selections: reconciled.slip.selections.map((selection) => {
      const state = freshness.get(selection.id);
      return {
        id: selection.id,
        eventId: selection.eventId,
        marketId: selection.marketId,
        outcomeId: selection.outcomeId,
        priceId: selection.priceId,
        priceVersion: selection.priceVersion,
        decimalOdds: selection.decimalOdds,
        marketVersion: selection.marketVersion,
        marketState: selection.marketState,
        outcomeState: selection.outcomeState,
        freshness: state?.status ?? "UNAVAILABLE",
        currentDecimalOdds: state?.current?.decimalOdds ?? null,
        currentPriceVersion: state?.current?.priceVersion ?? null,
      };
    }),
  };
}

async function projectEvents(context: AppContext): Promise<ApiEvent[]> {
  const events = await context.realtimeProvider.listEvents();

  return Promise.all(
    events.map(async (event): Promise<ApiEvent> => {
      const markets = await context.realtimeProvider.listMarkets(event.id);
      const projectedMarkets = await Promise.all(
        markets.map(async (market) => ({
          id: market.id,
          eventId: market.eventId,
          type: market.type,
          line: market.line ?? null,
          state: market.state,
          version: market.version,
          outcomes: await Promise.all(
            market.outcomes.map(async (outcome) => {
              const prices = await context.realtimeProvider.getPrices(outcome.id);
              const price = [...prices].sort((a, b) => b.version - a.version)[0] ?? null;
              return {
                id: outcome.id,
                marketId: outcome.marketId,
                label: outcome.label,
                state: outcome.state,
                price: price
                  ? {
                      id: price.id,
                      outcomeId: price.outcomeId,
                      version: price.version,
                      decimalOdds: price.decimalOdds,
                    }
                  : null,
              };
            }),
          ),
        })),
      );

      return {
        id: event.id,
        sportId: event.sportId,
        categoryId: event.categoryId,
        competitionId: event.competitionId,
        startsAt: event.startsAt,
        status: event.status,
        liveClock: event.liveClock ?? null,
        period: event.period ?? null,
        score: event.score
          ? {
              home: event.score.home,
              away: event.score.away,
            }
          : null,
        home: {
          id: event.homeParticipant.id,
          name: event.homeParticipant.name,
          shortName: event.homeParticipant.shortName,
        },
        away: {
          id: event.awayParticipant.id,
          name: event.awayParticipant.name,
          shortName: event.awayParticipant.shortName,
        },
        markets: projectedMarkets,
      };
    }),
  );
}

export async function buildBootstrap(context: AppContext): Promise<ApiBootstrap> {
  const slipId = await ensureDemoDraftSlip(context);
  const [sports, categories, competitions, events, slip, openBets, settledBets, balanceMinor] =
    await Promise.all([
      context.baseProvider.listSports(),
      context.baseProvider.listCategories(),
      context.baseProvider.listCompetitions(),
      projectEvents(context),
      projectSlip(context, slipId),
      context.settlement.listBetHistory(DEMO_USER_ID, { state: "OPEN", limit: 25 }),
      context.settlement.listBetHistory(DEMO_USER_ID, { state: "SETTLED", limit: 25 }),
      demoBalanceMinor(context),
    ]);

  return {
    demo: {
      userId: DEMO_USER_ID,
      balanceMinor,
      currency: DEMO_CURRENCY,
      playMoney: true,
    },
    sports: sports.map(({ id, slug, name }) => ({ id, slug, name })),
    categories,
    competitions,
    events,
    slip,
    openBets: openBets.map(serializeHistory),
    settledBets: settledBets.map(serializeHistory),
  };
}

function toReceipt(bet: Awaited<ReturnType<AppContext["betting"]["placeBet"]>>): ApiReceipt {
  return {
    id: bet.id,
    betRef: bet.betRef,
    txnRef: bet.txnRef,
    stakeMinor: bet.stakeMinor,
    totalOdds: bet.totalOdds,
    potentialWinMinor: bet.potentialWinMinor,
    currency: bet.currency,
    createdAt: bet.createdAt.toISOString(),
    legCount: bet.legs.length,
  };
}

function errorStatus(error: unknown): number {
  if (error instanceof BetslipError) {
    if (error.code === "FORBIDDEN") return 403;
    if (error.code === "SLIP_NOT_FOUND" || error.code === "BOOKING_NOT_FOUND") return 404;
    if (error.code === "BOOKING_EXPIRED" || error.code === "BOOKING_EXHAUSTED") return 410;
    return 409;
  }
  if (error instanceof BetError) {
    if (error.code === "ACCOUNT_NOT_FOUND") return 404;
    return 409;
  }
  if (error instanceof SettlementError) {
    if (error.code === "BET_NOT_FOUND") return 404;
    return 409;
  }
  if (error instanceof WalletError) return 409;
  return 400;
}

function errorBody(error: unknown): ApiErrorBody {
  if (
    error instanceof BetslipError ||
    error instanceof BetError ||
    error instanceof SettlementError ||
    error instanceof WalletError
  ) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...("details" in error && error.details ? { details: error.details } : {}),
      },
    };
  }

  if (error instanceof SyntaxError) {
    return { error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } };
  }

  const message = error instanceof Error ? error.message : "Invalid request";
  return { error: { code: "INVALID_REQUEST", message } };
}

export async function handleApiRequest(
  context: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) return false;

  if (url.pathname === "/api/stream") return false;

  try {
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      json(res, 200, await buildBootstrap(context));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/slip/selection") {
      const body = await readJson(req);
      const slipId = await ensureDemoDraftSlip(context);
      await context.betslip.toggleSelection({
        userId: DEMO_USER_ID,
        slipId,
        eventId: stringField(body, "eventId"),
        marketId: stringField(body, "marketId"),
        outcomeId: stringField(body, "outcomeId"),
      });
      json(res, 200, { slip: await projectSlip(context, slipId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/slip/stake") {
      const body = await readJson(req);
      const slipId = await ensureDemoDraftSlip(context);
      await context.betslip.setStake(DEMO_USER_ID, slipId, integerField(body, "stakeMinor"));
      json(res, 200, { slip: await projectSlip(context, slipId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/slip/accept-prices") {
      const slipId = await ensureDemoDraftSlip(context);
      await context.betslip.acceptPriceChanges(DEMO_USER_ID, slipId);
      json(res, 200, { slip: await projectSlip(context, slipId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/slip/clear") {
      const slipId = await ensureDemoDraftSlip(context);
      await context.betslip.clearSlip(DEMO_USER_ID, slipId);
      json(res, 200, { slip: await projectSlip(context, slipId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/slip/book") {
      const slipId = await ensureDemoDraftSlip(context);
      const booking = await context.betslip.bookSlip({
        userId: DEMO_USER_ID,
        slipId,
      });
      json(res, 201, {
        booking: {
          code: booking.code,
          expiresAt: booking.expiresAt.toISOString(),
          maxUses: booking.maxUses,
          useCount: booking.useCount,
        },
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/slip/load") {
      const body = await readJson(req);
      const slipId = await ensureDemoDraftSlip(context);
      await context.betslip.importBooking({
        userId: DEMO_USER_ID,
        code: stringField(body, "code"),
        targetSlipId: slipId,
      });
      json(res, 200, { slip: await projectSlip(context, slipId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/bets/place") {
      const body = await readJson(req);
      const slipId = await ensureDemoDraftSlip(context);
      const prepared = await context.betslip.prepareForPlacement(DEMO_USER_ID, slipId);
      const idempotencyKey =
        typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : `web_${randomUUID()}`;

      const accepted = await context.betting.placeBet({
        userId: DEMO_USER_ID,
        idempotencyKey,
        currency: prepared.currency,
        stakeMinor: prepared.stakeMinor,
        legs: prepared.legs,
      });

      await context.betslip.archiveSlip(DEMO_USER_ID, slipId);
      const nextSlip = await context.betslip.createSlip({
        userId: DEMO_USER_ID,
        mode: "REAL",
        currency: DEMO_CURRENCY,
      });

      json(res, 201, {
        receipt: toReceipt(accepted),
        slip: await projectSlip(context, nextSlip.id),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/bets") {
      const state = url.searchParams.get("state");
      const normalizedState = state === "OPEN" || state === "SETTLED" ? state : undefined;
      const history = await context.settlement.listBetHistory(DEMO_USER_ID, {
        state: normalizedState,
        limit: 50,
      });
      json(res, 200, { bets: history.map(serializeHistory) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/demo/settle") {
      const body = await readJson(req);
      const betId = stringField(body, "betId");
      const outcome = stringField(body, "outcome");
      if (outcome !== "WON" && outcome !== "LOST" && outcome !== "VOID") {
        throw new Error("INVALID_FIELD:outcome");
      }
      const bet = await context.betting.getBetById(betId);
      if (!bet || bet.userId !== DEMO_USER_ID) {
        throw new SettlementError("BET_NOT_FOUND", `Demo bet ${betId} not found`);
      }
      const settled = await context.settlement.settleBet({
        betId,
        resultVersion: 1,
        source: "play-money-demo",
        legs: bet.legs.map((leg) => ({
          betLegId: leg.id,
          outcome,
        })),
      });
      json(res, 200, { settlement: settled });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/demo/top-up") {
      await context.funding.grantPlayMoney({
        userId: DEMO_USER_ID,
        amount: toMinorUnits("1000.00"),
        idempotencyKey: `demo_topup_${randomUUID()}`,
      });
      json(res, 200, { balanceMinor: await demoBalanceMinor(context) });
      return true;
    }

    if (req.method === "OPTIONS") {
      noContent(res);
      return true;
    }

    json(res, 404, { error: { code: "NOT_FOUND", message: "API route not found" } });
    return true;
  } catch (error) {
    json(res, errorStatus(error), errorBody(error));
    return true;
  }
}
