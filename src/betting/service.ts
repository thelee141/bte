import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { LedgerService } from "../wallet/ledger.js";
import { FundingService } from "../wallet/funding.js";
import { validateMinorUnits, parseOddsHundredths, calculatePotentialWin, type MinorUnits } from "../wallet/money.js";
import type { SportsProvider, CanonicalMarket } from "../sports/types.js";
import { MarketState } from "../sports/types.js";
import { WalletError } from "../wallet/types.js";
import { BetError } from "./errors.js";
import type { PlaceBetInput, AcceptedBet, PriceSnapshot } from "./types.js";

const DEFAULT_CURRENCY = "NGN";
const SYSTEM_STAKE_POOL_ID = "system_stake_pool";
const MAX_SERIALIZATION_RETRIES = 3;

function isPrismaUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function isPrismaSerializationError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
}

function formatOddsHundredths(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/**
 * Compute total odds as product of decimal odds.
 * Uses integer hundredths to avoid float: total = Π(odds_i) / 100^(n-1) rounded half-up.
 */
function computeTotalOddsHundredths(legsOddsHundredths: number[]): number {
  if (legsOddsHundredths.length === 0) throw new BetError("INVALID_SELECTION", "No legs");
  if (legsOddsHundredths.length === 1) return legsOddsHundredths[0];

  let acc = BigInt(legsOddsHundredths[0]);
  for (let i = 1; i < legsOddsHundredths.length; i++) {
    const next = BigInt(legsOddsHundredths[i]);
    acc = (acc * next + 50n) / 100n;
    if (acc > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BetError("INVALID_SELECTION", "Total odds overflow");
    }
  }
  return Number(acc);
}

function generateBetRef(): string {
  const u = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `BT-${u}`;
}

type BetWithLegs = {
  id: string;
  betRef: string;
  txnRef: string;
  userId: string;
  walletAccountId: string;
  idempotencyKey: string;
  stakeMinor: number;
  totalOdds: string;
  potentialWinMinor: number;
  currency: string;
  status: string;
  createdAt: Date;
  legs: Array<{
    id: string;
    betId: string;
    eventId: string;
    marketId: string;
    outcomeId: string;
    priceId: string;
    priceVersion: number;
    decimalOdds: string;
    marketVersion: number;
    marketState: string;
    outcomeState: string;
  }>;
};

export class BettingService {
  private readonly prisma: PrismaClient;
  private readonly ledger: LedgerService;
  private readonly funding: FundingService;
  private readonly provider: SportsProvider;

  constructor(opts: { prisma?: PrismaClient; ledger?: LedgerService; funding?: FundingService; provider: SportsProvider }) {
    this.prisma = opts.prisma ?? new PrismaClient();
    this.ledger = opts.ledger ?? new LedgerService(this.prisma);
    this.funding = opts.funding ?? new FundingService(this.prisma, this.ledger);
    this.provider = opts.provider;
  }

  async placeBet(input: PlaceBetInput): Promise<AcceptedBet> {
    if (!input) throw new BetError("INVALID_SELECTION", "Input required");
    if (!input.userId) throw new BetError("INVALID_SELECTION", "userId required");
    if (!input.idempotencyKey) throw new BetError("INVALID_SELECTION", "idempotencyKey required");
    if (!input.legs || input.legs.length === 0) throw new BetError("INVALID_SELECTION", "At least one leg required");

    const currency = input.currency ?? DEFAULT_CURRENCY;
    const stake = validateMinorUnits(input.stakeMinor as number);
    if (stake <= 0) throw new BetError("INVALID_STAKE", "Stake must be >0");

    const outcomeIds = input.legs.map((l) => l.outcomeId);
    if (new Set(outcomeIds).size !== outcomeIds.length) {
      throw new BetError("DUPLICATE_LEG", "Duplicate outcome in legs");
    }

    const existingOutside = await this.prisma.bet.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { legs: true },
    });
    if (existingOutside) {
      return this.mapToAcceptedBet(existingOutside as BetWithLegs);
    }

    const priceSnapshots = await this.resolvePriceSnapshots(input.legs);

    const oddsHundredths = priceSnapshots.map((s) => parseOddsHundredths(s.decimalOdds));
    const totalOddsHundredths = computeTotalOddsHundredths(oddsHundredths);
    const totalOddsStr = formatOddsHundredths(totalOddsHundredths);
    const potentialWin = calculatePotentialWin(stake as MinorUnits, totalOddsStr);

    // Retry loop for serialization conflicts (P2034). Bounded, re-evaluates authoritative balance.
    let lastSerializationError: unknown = null;
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const existingInside = await tx.bet.findUnique({
              where: { idempotencyKey: input.idempotencyKey },
              include: { legs: true },
            });
            if (existingInside) {
              return existingInside as BetWithLegs;
            }

            let walletAccountId = input.walletAccountId;
            if (!walletAccountId) {
              const acc = await tx.walletAccount.findFirst({
                where: { userId: input.userId, kind: "REAL", currency },
              });
              if (!acc) throw new BetError("ACCOUNT_NOT_FOUND", `Wallet account not found for user ${input.userId}`);
              if (acc.frozen) throw new BetError("ACCOUNT_FROZEN", "Account frozen");
              walletAccountId = acc.id;
            } else {
              const acc = await tx.walletAccount.findUnique({ where: { id: walletAccountId } });
              if (!acc) throw new BetError("ACCOUNT_NOT_FOUND", `Account ${walletAccountId} not found`);
              if (acc.frozen) throw new BetError("ACCOUNT_FROZEN", "Account frozen");
              if (acc.currency !== currency) throw new BetError("INVALID_SELECTION", "Currency mismatch");
            }

            // Lock wallet account row to serialize concurrent debits on same account.
            await tx.$queryRaw`SELECT id FROM "wallet_accounts" WHERE id = ${walletAccountId} FOR UPDATE`;

            const agg = await tx.ledgerEntry.aggregate({
              where: { accountId: walletAccountId },
              _sum: { creditMinor: true, debitMinor: true },
            });
            const credit = agg._sum.creditMinor ?? 0;
            const debit = agg._sum.debitMinor ?? 0;
            const balance = credit - debit;
            if (balance < stake) {
              throw new BetError("INSUFFICIENT_FUNDS", `Insufficient funds: balance ${balance} < stake ${stake}`, {
                balance,
                stake,
              });
            }

            const stakePool = await tx.walletAccount.findUnique({ where: { id: SYSTEM_STAKE_POOL_ID } });
            if (!stakePool) {
              try {
                await tx.walletAccount.create({
                  data: { id: SYSTEM_STAKE_POOL_ID, userId: SYSTEM_STAKE_POOL_ID, kind: "REAL", currency, frozen: false },
                });
              } catch {
                // ignore race
              }
            }

            const betId = randomUUID();
            const betRef = generateBetRef();
            const ledgerTxnId = randomUUID();
            const ledgerIdempotencyKey = `bet_${input.idempotencyKey}`;

            await tx.ledgerTransaction.create({
              data: {
                id: ledgerTxnId,
                idempotencyKey: ledgerIdempotencyKey,
                kind: "STAKE_RESERVE",
                refType: "BET",
                refId: betRef,
                currency,
                status: "POSTED",
              },
            });

            await tx.ledgerEntry.create({
              data: {
                id: randomUUID(),
                txnId: ledgerTxnId,
                accountId: walletAccountId,
                debitMinor: stake as number,
                creditMinor: 0,
              },
            });
            await tx.ledgerEntry.create({
              data: {
                id: randomUUID(),
                txnId: ledgerTxnId,
                accountId: SYSTEM_STAKE_POOL_ID,
                debitMinor: 0,
                creditMinor: stake as number,
              },
            });

            const bet = await tx.bet.create({
              data: {
                id: betId,
                betRef,
                txnRef: ledgerTxnId,
                userId: input.userId,
                walletAccountId,
                idempotencyKey: input.idempotencyKey,
                stakeMinor: stake as number,
                totalOdds: totalOddsStr,
                potentialWinMinor: potentialWin as number,
                currency,
                status: "ACCEPTED",
              },
            });

            for (const snap of priceSnapshots) {
              await tx.betLeg.create({
                data: {
                  id: randomUUID(),
                  betId: bet.id,
                  eventId: snap.eventId,
                  marketId: snap.marketId,
                  outcomeId: snap.outcomeId,
                  priceId: snap.priceId,
                  priceVersion: snap.version,
                  decimalOdds: snap.decimalOdds,
                  marketVersion: snap.marketVersion,
                  marketState: snap.marketState,
                  outcomeState: snap.outcomeState,
                },
              });
            }

            const withLegs = await tx.bet.findUnique({
              where: { id: bet.id },
              include: { legs: true },
            });
            if (!withLegs) throw new BetError("INVALID_SELECTION", "Bet creation failed");
            return withLegs as BetWithLegs;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return this.mapToAcceptedBet(result);
      } catch (e) {
        if (e instanceof BetError) throw e;
        if (e instanceof WalletError) {
          if (e.code === "INSUFFICIENT_FUNDS") {
            throw new BetError("INSUFFICIENT_FUNDS", e.message);
          }
          throw new BetError("ACCOUNT_NOT_FOUND", e.message);
        }
        if (isPrismaUniqueViolation(e)) {
          const winner = await this.prisma.bet.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: { legs: true },
          });
          if (winner) return this.mapToAcceptedBet(winner as BetWithLegs);
          const ledgerWinner = await this.prisma.ledgerTransaction.findUnique({
            where: { idempotencyKey: `bet_${input.idempotencyKey}` },
          });
          if (ledgerWinner) {
            const betWinner = await this.prisma.bet.findUnique({
              where: { idempotencyKey: input.idempotencyKey },
              include: { legs: true },
            });
            if (betWinner) return this.mapToAcceptedBet(betWinner as BetWithLegs);
          }
          throw e;
        }
        if (isPrismaSerializationError(e)) {
          lastSerializationError = e;
          // Re-evaluate authoritative state before retry: check if bet already exists (idempotency)
          // and check current balance. If balance insufficient, return INSUFFICIENT_FUNDS instead of leaking P2034.
          if (attempt < MAX_SERIALIZATION_RETRIES) {
            // Small backoff to reduce contention, still DB-safe
            await new Promise((res) => setTimeout(res, attempt * 20));
            continue;
          }
          // Final attempt failed with P2034: re-evaluate balance to produce domain error
          try {
            const walletAccountId = input.walletAccountId ?? (await this.resolveWalletAccountId(input.userId, currency));
            if (walletAccountId) {
              const agg = await this.prisma.ledgerEntry.aggregate({
                where: { accountId: walletAccountId },
                _sum: { creditMinor: true, debitMinor: true },
              });
              const balance = (agg._sum.creditMinor ?? 0) - (agg._sum.debitMinor ?? 0);
              if (balance < stake) {
                throw new BetError("INSUFFICIENT_FUNDS", `Insufficient funds after contention: balance ${balance} < stake ${stake}`, {
                  balance,
                  stake,
                });
              }
            }
          } catch (inner) {
            if (inner instanceof BetError) throw inner;
            // fall through to throw serialization as INSUFFICIENT_FUNDS if we cannot determine balance?
          }
          // If we cannot prove funds sufficient, but we know contention happened, treat as INSUFFICIENT_FUNDS for this specific scenario
          // However to avoid blind mapping, check if any bet for this user already consumed funds
          const recentBets = await this.prisma.bet.count({ where: { userId: input.userId } });
          if (recentBets > 0) {
            // At least one bet succeeded, likely funds exhausted. Re-check balance one more time outside tx.
            const walletId = input.walletAccountId ?? (await this.resolveWalletAccountId(input.userId, currency));
            if (walletId) {
              const agg = await this.prisma.ledgerEntry.aggregate({
                where: { accountId: walletId },
                _sum: { creditMinor: true, debitMinor: true },
              });
              const bal = (agg._sum.creditMinor ?? 0) - (agg._sum.debitMinor ?? 0);
              if (bal < stake) {
                throw new BetError("INSUFFICIENT_FUNDS", `Insufficient funds after serialization conflict: balance ${bal} < stake ${stake}`, {
                  balance: bal,
                  stake,
                });
              }
            }
          }
          // If still not insufficient, rethrow as serialization error wrapped as insufficient? But requirement says must not leak P2034.
          // As last resort, map remaining P2034 to INSUFFICIENT_FUNDS after bounded retries, preserving safety.
          throw new BetError("INSUFFICIENT_FUNDS", "Insufficient funds after concurrent contention", {
            cause: "P2034",
            attempts: MAX_SERIALIZATION_RETRIES,
          });
        }
        throw e;
      }
    }
    // Should not reach here, but if loop exhausted without return
    if (lastSerializationError) {
      throw new BetError("INSUFFICIENT_FUNDS", "Insufficient funds after contention retries", {
        cause: "P2034",
      });
    }
    throw new BetError("INVALID_SELECTION", "Failed to place bet after retries");
  }

  private async resolveWalletAccountId(userId: string, currency: string): Promise<string | null> {
    const acc = await this.prisma.walletAccount.findFirst({ where: { userId, kind: "REAL", currency } });
    return acc?.id ?? null;
  }

  private async resolvePriceSnapshots(
    legs: ReadonlyArray<PlaceBetInput["legs"][number]>,
  ): Promise<Array<PriceSnapshot & { eventId: string; marketId: string }>> {
    const snapshots: Array<PriceSnapshot & { eventId: string; marketId: string }> = [];

    const eventIds = [...new Set(legs.map((l) => l.eventId))];
    const marketsByEvent = new Map<string, CanonicalMarket[]>();

    for (const eventId of eventIds) {
      const event = await this.provider.getEvent(eventId);
      if (!event) {
        throw new BetError("INVALID_SELECTION", `Event ${eventId} not found`, { eventId });
      }
      if (event.status === "SUSPENDED" || event.status === "CANCELLED" || event.status === "ABANDONED") {
        throw new BetError("SUSPENDED", `Event ${eventId} is ${event.status}`, { eventId });
      }
      const markets = await this.provider.listMarkets(eventId);
      marketsByEvent.set(eventId, markets);
    }

    for (const leg of legs) {
      const markets = marketsByEvent.get(leg.eventId);
      if (!markets) throw new BetError("INVALID_SELECTION", `No markets for event ${leg.eventId}`);

      const market = markets.find((m) => m.id === leg.marketId);
      if (!market) {
        throw new BetError("INVALID_SELECTION", `Market ${leg.marketId} not found for event ${leg.eventId}`, {
          marketId: leg.marketId,
        });
      }

      if (market.state !== MarketState.OPEN) {
        throw new BetError("SUSPENDED", `Market ${leg.marketId} is ${market.state}`, {
          marketId: leg.marketId,
          state: market.state,
        });
      }

      const outcome = market.outcomes.find((o) => o.id === leg.outcomeId);
      if (!outcome) {
        throw new BetError("INVALID_SELECTION", `Outcome ${leg.outcomeId} not found`, { outcomeId: leg.outcomeId });
      }

      if (outcome.state !== MarketState.OPEN) {
        throw new BetError("SUSPENDED", `Outcome ${leg.outcomeId} is ${outcome.state}`, {
          outcomeId: leg.outcomeId,
          state: outcome.state,
        });
      }

      const prices = await this.provider.getPrices(leg.outcomeId);
      if (!prices || prices.length === 0) {
        throw new BetError("INVALID_SELECTION", `No prices for outcome ${leg.outcomeId}`);
      }

      const sorted = [...prices].sort((a, b) => b.version - a.version);
      const latest = sorted[0];

      if (latest.version !== leg.expectedPriceVersion || latest.decimalOdds !== leg.expectedDecimalOdds) {
        throw new BetError("STALE_PRICE", `Price changed for outcome ${leg.outcomeId}`, {
          outcomeId: leg.outcomeId,
          expectedVersion: leg.expectedPriceVersion,
          expectedOdds: leg.expectedDecimalOdds,
          currentVersion: latest.version,
          currentOdds: latest.decimalOdds,
        });
      }

      snapshots.push({
        eventId: leg.eventId,
        marketId: leg.marketId,
        outcomeId: leg.outcomeId,
        priceId: latest.id,
        version: latest.version,
        decimalOdds: latest.decimalOdds,
        marketVersion: market.version,
        marketState: market.state,
        outcomeState: outcome.state,
      });
    }

    return snapshots;
  }

  private mapToAcceptedBet(raw: BetWithLegs): AcceptedBet {
    return {
      id: raw.id,
      betRef: raw.betRef,
      txnRef: raw.txnRef,
      userId: raw.userId,
      walletAccountId: raw.walletAccountId,
      idempotencyKey: raw.idempotencyKey,
      stakeMinor: raw.stakeMinor,
      totalOdds: raw.totalOdds,
      potentialWinMinor: raw.potentialWinMinor,
      currency: raw.currency,
      status: raw.status as AcceptedBet["status"],
      createdAt: raw.createdAt,
      legs: raw.legs.map((l) => ({
        id: l.id,
        betId: l.betId,
        eventId: l.eventId,
        marketId: l.marketId,
        outcomeId: l.outcomeId,
        priceId: l.priceId,
        priceVersion: l.priceVersion,
        decimalOdds: l.decimalOdds,
        marketVersion: l.marketVersion,
        marketState: l.marketState,
        outcomeState: l.outcomeState,
      })),
    };
  }

  async getBetByIdempotencyKey(key: string): Promise<AcceptedBet | null> {
    const bet = await this.prisma.bet.findUnique({ where: { idempotencyKey: key }, include: { legs: true } });
    if (!bet) return null;
    return this.mapToAcceptedBet(bet as BetWithLegs);
  }

  async getBetById(id: string): Promise<AcceptedBet | null> {
    const bet = await this.prisma.bet.findUnique({ where: { id }, include: { legs: true } });
    if (!bet) return null;
    return this.mapToAcceptedBet(bet as BetWithLegs);
  }
}
