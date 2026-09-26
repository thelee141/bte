import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { LedgerService } from "../wallet/ledger.js";
import { calculatePotentialWin, parseOddsHundredths, validateMinorUnits, type MinorUnits } from "../wallet/money.js";
import { WalletError } from "../wallet/types.js";
import { SettlementError } from "./errors.js";
import type {
  BetHistoryItem,
  BetSettlementOutcome,
  LegSettlementDecision,
  LegSettlementOutcome,
  SettleBetInput,
  SettledBet,
} from "./types.js";

const SYSTEM_PLAY_MINT_ID = "system_play_mint";
const SYSTEM_STAKE_POOL_ID = "system_stake_pool";
const MAX_SERIALIZATION_RETRIES = 3;

type SettlementWithRelations = {
  id: string;
  betId: string;
  resultVersion: number;
  source: string;
  outcome: string;
  creditMinor: number;
  decisionHash: string;
  ledgerTxnId: string | null;
  createdAt: Date;
  bet: {
    betRef: string;
  };
  legs: Array<{
    betLegId: string;
    outcome: string;
  }>;
};

function isPrismaSerializationError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;

  const sqlState = error.meta?.code;
  return sqlState === "40001" || sqlState === "40P01";
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function assertLegOutcome(value: string): asserts value is LegSettlementOutcome {
  if (value !== "WON" && value !== "LOST" && value !== "VOID") {
    throw new SettlementError("INVALID_LEG_RESULT", `Unsupported leg result ${value}`);
  }
}

function normalizeDecisions(legs: ReadonlyArray<LegSettlementDecision>): LegSettlementDecision[] {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new SettlementError("INCOMPLETE_RESULT", "At least one leg result is required");
  }

  const seen = new Set<string>();
  const normalized = legs.map((leg) => {
    if (!leg.betLegId || typeof leg.betLegId !== "string") {
      throw new SettlementError("INVALID_LEG_RESULT", "betLegId is required");
    }
    assertLegOutcome(leg.outcome);
    if (seen.has(leg.betLegId)) {
      throw new SettlementError("INVALID_LEG_RESULT", `Duplicate result for bet leg ${leg.betLegId}`);
    }
    seen.add(leg.betLegId);
    return { betLegId: leg.betLegId, outcome: leg.outcome };
  });

  return normalized.sort((a, b) => a.betLegId.localeCompare(b.betLegId));
}

function hashDecision(input: { source: string; legs: ReadonlyArray<LegSettlementDecision> }): string {
  return createHash("sha256")
    .update(JSON.stringify({ source: input.source, legs: input.legs }))
    .digest("hex");
}

function classifyOutcome(decisions: ReadonlyArray<LegSettlementDecision>): BetSettlementOutcome {
  if (decisions.every((leg) => leg.outcome === "VOID")) return "VOID";
  if (decisions.some((leg) => leg.outcome === "LOST")) return "LOST";
  if (decisions.some((leg) => leg.outcome === "VOID")) return "PARTIAL_VOID";
  return "WON";
}

function formatOddsHundredths(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function productOddsHundredths(odds: ReadonlyArray<string>): number {
  if (odds.length === 0) return 100;

  let total = BigInt(parseOddsHundredths(odds[0]));
  for (let index = 1; index < odds.length; index++) {
    total = (total * BigInt(parseOddsHundredths(odds[index])) + 50n) / 100n;
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SettlementError("INVALID_LEG_RESULT", "Settlement odds overflow");
    }
  }
  return Number(total);
}

function mapSettlement(row: SettlementWithRelations): SettledBet {
  return {
    settlementId: row.id,
    betId: row.betId,
    betRef: row.bet.betRef,
    resultVersion: row.resultVersion,
    source: row.source,
    outcome: row.outcome as BetSettlementOutcome,
    creditMinor: row.creditMinor,
    ledgerTxnId: row.ledgerTxnId,
    createdAt: row.createdAt,
    legs: row.legs
      .map((leg) => ({
        betLegId: leg.betLegId,
        outcome: leg.outcome as LegSettlementOutcome,
      }))
      .sort((a, b) => a.betLegId.localeCompare(b.betLegId)),
  };
}

export class SettlementService {
  private readonly prisma: PrismaClient;
  private readonly ledger: LedgerService;

  constructor(opts?: { prisma?: PrismaClient; ledger?: LedgerService }) {
    this.prisma = opts?.prisma ?? new PrismaClient();
    this.ledger = opts?.ledger ?? new LedgerService(this.prisma);
  }

  async settleBet(input: SettleBetInput): Promise<SettledBet> {
    if (!input?.betId) throw new SettlementError("BET_NOT_FOUND", "betId is required");
    if (!Number.isInteger(input.resultVersion) || input.resultVersion < 1) {
      throw new SettlementError("INVALID_RESULT_VERSION", "resultVersion must be an integer >= 1");
    }
    if (!input.source || typeof input.source !== "string") {
      throw new SettlementError("INVALID_SOURCE", "source is required");
    }

    const decisions = normalizeDecisions(input.legs);
    const decisionHash = hashDecision({ source: input.source, legs: decisions });

    const existingOutside = await this.prisma.settlement.findUnique({
      where: {
        betId_resultVersion: {
          betId: input.betId,
          resultVersion: input.resultVersion,
        },
      },
      include: { bet: { select: { betRef: true } }, legs: true },
    });
    if (existingOutside) {
      this.assertReplayMatches(existingOutside.decisionHash, decisionHash, input);
      return mapSettlement(existingOutside as SettlementWithRelations);
    }

    for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt++) {
      try {
        const settled = await this.prisma.$transaction(
          async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>
              `SELECT id FROM "bets" WHERE id = ${input.betId} FOR UPDATE`;
            if (locked.length === 0) {
              throw new SettlementError("BET_NOT_FOUND", `Bet ${input.betId} not found`);
            }

            const existingInside = await tx.settlement.findUnique({
              where: {
                betId_resultVersion: {
                  betId: input.betId,
                  resultVersion: input.resultVersion,
                },
              },
              include: { bet: { select: { betRef: true } }, legs: true },
            });
            if (existingInside) {
              this.assertReplayMatches(existingInside.decisionHash, decisionHash, input);
              return existingInside as SettlementWithRelations;
            }

            const bet = await tx.bet.findUnique({
              where: { id: input.betId },
              include: {
                legs: true,
                settlements: {
                  orderBy: { resultVersion: "desc" },
                  take: 1,
                },
              },
            });
            if (!bet) {
              throw new SettlementError("BET_NOT_FOUND", `Bet ${input.betId} not found`);
            }

            const latest = bet.settlements[0];
            if (latest) {
              throw new SettlementError(
                "RESETTLEMENT_REQUIRED",
                `Bet ${bet.betRef} is already settled at result version ${latest.resultVersion}`,
                {
                  latestResultVersion: latest.resultVersion,
                  requestedResultVersion: input.resultVersion,
                },
              );
            }

            const decisionMap = new Map(decisions.map((decision) => [decision.betLegId, decision.outcome]));

            for (const decision of decisions) {
              if (!bet.legs.some((leg) => leg.id === decision.betLegId)) {
                throw new SettlementError(
                  "INVALID_LEG_RESULT",
                  `Bet leg ${decision.betLegId} does not belong to bet ${bet.betRef}`,
                );
              }
            }

            if (decisionMap.size !== bet.legs.length) {
              throw new SettlementError(
                "INCOMPLETE_RESULT",
                `Expected ${bet.legs.length} leg results, received ${decisionMap.size}`,
              );
            }

            for (const leg of bet.legs) {
              if (!decisionMap.has(leg.id)) {
                throw new SettlementError("INCOMPLETE_RESULT", `Missing result for bet leg ${leg.id}`);
              }
            }

            const outcome = classifyOutcome(decisions);
            let creditMinor = 0;

            if (outcome === "VOID") {
              creditMinor = bet.stakeMinor;
            } else if (outcome === "WON") {
              creditMinor = bet.potentialWinMinor;
            } else if (outcome === "PARTIAL_VOID") {
              const survivingOdds = bet.legs
                .filter((leg) => decisionMap.get(leg.id) === "WON")
                .map((leg) => leg.decimalOdds);
              const adjustedOdds = formatOddsHundredths(productOddsHundredths(survivingOdds));
              creditMinor = calculatePotentialWin(
                validateMinorUnits(bet.stakeMinor) as MinorUnits,
                adjustedOdds,
              ) as number;
            }

            let ledgerTxnId: string | null = null;
            if (creditMinor > 0) {
              const sourceAccountId = outcome === "VOID" ? SYSTEM_STAKE_POOL_ID : SYSTEM_PLAY_MINT_ID;
              await tx.walletAccount.upsert({
                where: { id: sourceAccountId },
                update: {},
                create: {
                  id: sourceAccountId,
                  userId: sourceAccountId,
                  kind: "REAL",
                  currency: bet.currency,
                  frozen: false,
                },
              });

              const ledgerTxn = await this.ledger.post(
                {
                  kind: outcome === "VOID" ? "STAKE_REFUND" : "WIN_CREDIT",
                  idempotencyKey: `settlement_${bet.id}_${input.resultVersion}`,
                  currency: bet.currency,
                  refType: "BET_SETTLEMENT",
                  refId: bet.betRef,
                  entries: [
                    {
                      accountId: sourceAccountId,
                      debitMinor: validateMinorUnits(creditMinor),
                    },
                    {
                      accountId: bet.walletAccountId,
                      creditMinor: validateMinorUnits(creditMinor),
                    },
                  ],
                },
                { tx },
              );
              ledgerTxnId = ledgerTxn.id;
            }

            const settlement = await tx.settlement.create({
              data: {
                id: randomUUID(),
                betId: bet.id,
                resultVersion: input.resultVersion,
                source: input.source,
                outcome,
                creditMinor,
                decisionHash,
                ledgerTxnId,
              },
            });

            await tx.settlementLeg.createMany({
              data: decisions.map((decision) => ({
                id: randomUUID(),
                settlementId: settlement.id,
                betLegId: decision.betLegId,
                outcome: decision.outcome,
              })),
            });

            for (const decision of decisions) {
              await tx.betLeg.update({
                where: { id: decision.betLegId },
                data: { status: decision.outcome },
              });
            }

            await tx.bet.update({
              where: { id: bet.id },
              data: {
                status: "SETTLED",
                settledAt: new Date(),
              },
            });

            const complete = await tx.settlement.findUnique({
              where: { id: settlement.id },
              include: { bet: { select: { betRef: true } }, legs: true },
            });
            if (!complete) {
              throw new SettlementError("SETTLEMENT_CONFLICT", "Settlement write could not be reloaded");
            }
            return complete as SettlementWithRelations;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return mapSettlement(settled);
      } catch (error) {
        if (error instanceof SettlementError) throw error;
        if (error instanceof WalletError) {
          throw new SettlementError("ACCOUNT_ERROR", error.message, { walletCode: error.code });
        }
        if (isPrismaUniqueViolation(error)) {
          const winner = await this.prisma.settlement.findUnique({
            where: {
              betId_resultVersion: {
                betId: input.betId,
                resultVersion: input.resultVersion,
              },
            },
            include: { bet: { select: { betRef: true } }, legs: true },
          });
          if (winner) {
            this.assertReplayMatches(winner.decisionHash, decisionHash, input);
            return mapSettlement(winner as SettlementWithRelations);
          }
          throw new SettlementError("SETTLEMENT_CONFLICT", "Concurrent settlement conflict");
        }
        if (isPrismaSerializationError(error)) {
          if (attempt < MAX_SERIALIZATION_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 20));
            continue;
          }

          const winner = await this.prisma.settlement.findUnique({
            where: {
              betId_resultVersion: {
                betId: input.betId,
                resultVersion: input.resultVersion,
              },
            },
            include: { bet: { select: { betRef: true } }, legs: true },
          });
          if (winner) {
            this.assertReplayMatches(winner.decisionHash, decisionHash, input);
            return mapSettlement(winner as SettlementWithRelations);
          }
          throw new SettlementError(
            "SETTLEMENT_CONFLICT",
            "Settlement could not complete after bounded serialization retries",
          );
        }
        throw error;
      }
    }

    throw new SettlementError("SETTLEMENT_CONFLICT", "Settlement retry loop exhausted");
  }

  async listBetHistory(
    userId: string,
    opts?: { state?: "OPEN" | "SETTLED"; limit?: number },
  ): Promise<BetHistoryItem[]> {
    if (!userId) return [];

    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const settledAt =
      opts?.state === "OPEN" ? null : opts?.state === "SETTLED" ? { not: null } : undefined;

    const bets = await this.prisma.bet.findMany({
      where: {
        userId,
        ...(settledAt === undefined ? {} : { settledAt }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        settlements: {
          orderBy: { resultVersion: "desc" },
          take: 1,
        },
      },
    });

    return bets.map((bet) => {
      const settlement = bet.settlements[0] ?? null;
      return {
        betId: bet.id,
        betRef: bet.betRef,
        userId: bet.userId,
        stakeMinor: bet.stakeMinor,
        totalOdds: bet.totalOdds,
        potentialWinMinor: bet.potentialWinMinor,
        currency: bet.currency,
        status: bet.status,
        createdAt: bet.createdAt,
        settledAt: bet.settledAt,
        settlement: settlement
          ? {
              resultVersion: settlement.resultVersion,
              outcome: settlement.outcome as BetSettlementOutcome,
              creditMinor: settlement.creditMinor,
              createdAt: settlement.createdAt,
            }
          : null,
      };
    });
  }

  private assertReplayMatches(
    existingHash: string,
    requestedHash: string,
    input: SettleBetInput,
  ): void {
    if (existingHash !== requestedHash) {
      throw new SettlementError(
        "RESULT_CONFLICT",
        `Result version ${input.resultVersion} for bet ${input.betId} already exists with different decisions`,
      );
    }
  }
}
