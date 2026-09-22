import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { validateSignedMinorUnits, type SignedMinorUnits } from "./money.js";
import {
  type WalletAccount,
  type WalletAccountKind,
  type LedgerTransaction,
  type PostInput,
  type LedgerServiceShape,
  WalletError,
} from "./types.js";

const DEFAULT_CURRENCY = "NGN";
const SYSTEM_PLAY_MINT_ID = "system_play_mint";
const SYSTEM_STAKE_POOL_ID = "system_stake_pool";

function isPrismaUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function isSystemMintId(accountId: string): boolean {
  return accountId === SYSTEM_PLAY_MINT_ID;
}

export class LedgerService implements LedgerServiceShape {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
  }

  /** Ensure the two play-money system accounts exist (idempotent, race-safe). */
  async ensureSystemAccounts(): Promise<void> {
    for (const id of [SYSTEM_PLAY_MINT_ID, SYSTEM_STAKE_POOL_ID]) {
      const existing = await this.prisma.walletAccount.findUnique({ where: { id } });
      if (existing) continue;
      try {
        await this.prisma.walletAccount.create({
          // distinct userId per system account: (userId,kind,currency) is unique
          data: { id, userId: id, kind: "REAL", currency: DEFAULT_CURRENCY, frozen: false },
        });
      } catch {
        // race: another caller won the insert
      }
    }
  }

  async createAccount(
    userId: string,
    kind: WalletAccountKind,
    currency: string = DEFAULT_CURRENCY,
  ): Promise<WalletAccount> {
    if (!userId || typeof userId !== "string") {
      throw new WalletError("INVALID_ENTRY", "userId required string");
    }
    if (kind !== "REAL" && kind !== "BONUS") {
      throw new WalletError("INVALID_ENTRY", `Invalid kind ${kind}`);
    }
    if (!currency || typeof currency !== "string") {
      throw new WalletError("INVALID_CURRENCY", "currency required");
    }

    const id = randomUUID();
    try {
      const acc = await this.prisma.walletAccount.create({
        data: {
          id,
          userId,
          kind,
          currency,
          frozen: false,
        },
      });
      return acc as WalletAccount;
    } catch (e) {
      if (isPrismaUniqueViolation(e)) {
        throw new WalletError(
          "DUPLICATE_ACCOUNT",
          `Duplicate account userId=${userId} kind=${kind} currency=${currency}`,
        );
      }
      throw e;
    }
  }

  async getBalance(accountId: string): Promise<SignedMinorUnits> {
    if (!accountId) throw new WalletError("INVALID_ENTRY", "accountId required");

    const acc = await this.prisma.walletAccount.findUnique({
      where: { id: accountId },
    });
    if (!acc) {
      throw new WalletError("ACCOUNT_NOT_FOUND", `Account ${accountId} not found`);
    }

    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { accountId },
      _sum: { creditMinor: true, debitMinor: true },
    });

    const credit = agg._sum.creditMinor ?? 0;
    const debit = agg._sum.debitMinor ?? 0;
    const bal = credit - debit;
    try {
      return validateSignedMinorUnits(bal);
    } catch {
      throw new WalletError("INVALID_AMOUNT", `Balance not safe integer ${bal}`);
    }
  }

  async post(input: PostInput): Promise<LedgerTransaction> {
    this.validatePostInput(input);

    const existingOutside = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: true },
    });
    if (existingOutside) {
      return existingOutside as unknown as LedgerTransaction;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingInside = await tx.ledgerTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { entries: true },
        });
        if (existingInside) {
          return existingInside;
        }

        const accountIds = [...new Set(input.entries.map((e) => e.accountId))];
        const accounts = await tx.walletAccount.findMany({
          where: { id: { in: accountIds } },
        });
        const accountMap = new Map(accounts.map((a) => [a.id, a]));

        for (const aid of accountIds) {
          const acc = accountMap.get(aid);
          if (!acc) {
            throw new WalletError("ACCOUNT_NOT_FOUND", `Account ${aid} not found`);
          }
          if (acc.frozen) {
            throw new WalletError("ACCOUNT_FROZEN", `Account ${aid} frozen`);
          }
          if (acc.currency !== input.currency) {
            throw new WalletError(
              "CURRENCY_MISMATCH",
              `Account ${aid} currency ${acc.currency} != txn currency ${input.currency}`,
            );
          }
        }

        const debitPerAccount = new Map<string, number>();
        for (const e of input.entries) {
          const debit = (e.debitMinor ?? 0) as number;
          if (debit > 0) {
            debitPerAccount.set(e.accountId, (debitPerAccount.get(e.accountId) ?? 0) + debit);
          }
        }

        for (const [accountId, totalDebit] of debitPerAccount) {
          // System mint is the play-money source: allowed to debit without prior balance.
          if (isSystemMintId(accountId)) continue;

          const agg = await tx.ledgerEntry.aggregate({
            where: { accountId },
            _sum: { creditMinor: true, debitMinor: true },
          });
          const credit = agg._sum.creditMinor ?? 0;
          const debit = agg._sum.debitMinor ?? 0;
          const balance = credit - debit;
          if (balance < totalDebit) {
            throw new WalletError(
              "INSUFFICIENT_FUNDS",
              `Insufficient funds for account ${accountId}: balance ${balance} < debit ${totalDebit}`,
            );
          }
        }

        const txnId = randomUUID();
        const createdTxn = await tx.ledgerTransaction.create({
          data: {
            id: txnId,
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
            refType: input.refType,
            refId: input.refId,
            currency: input.currency,
            status: "POSTED",
          },
        });

        for (const e of input.entries) {
          const debit = (e.debitMinor ?? 0) as number;
          const credit = (e.creditMinor ?? 0) as number;
          await tx.ledgerEntry.create({
            data: {
              id: randomUUID(),
              txnId: createdTxn.id,
              accountId: e.accountId,
              debitMinor: debit,
              creditMinor: credit,
            },
          });
        }

        const withEntries = await tx.ledgerTransaction.findUnique({
          where: { id: createdTxn.id },
          include: { entries: true },
        });
        if (!withEntries) throw new WalletError("INVALID_ENTRY", "Transaction write failed");
        return withEntries;
      });

      return result as unknown as LedgerTransaction;
    } catch (e) {
      if (e instanceof WalletError) throw e;
      if (isPrismaUniqueViolation(e)) {
        const winner = await this.prisma.ledgerTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { entries: true },
        });
        if (winner) {
          return winner as unknown as LedgerTransaction;
        }
      }
      throw e;
    }
  }

  async listTransactions(
    accountId: string,
    opts?: { limit?: number },
  ): Promise<LedgerTransaction[]> {
    if (!accountId) throw new WalletError("INVALID_ENTRY", "accountId required");
    const acc = await this.prisma.walletAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new WalletError("ACCOUNT_NOT_FOUND", `Account ${accountId} not found`);

    const limit = opts?.limit ?? 100;
    const txns = await this.prisma.ledgerTransaction.findMany({
      where: {
        entries: { some: { accountId } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { entries: true },
    });
    return txns as unknown as LedgerTransaction[];
  }

  private validatePostInput(input: PostInput): void {
    if (!input) throw new WalletError("INVALID_ENTRY", "PostInput required");
    if (!input.idempotencyKey || typeof input.idempotencyKey !== "string") {
      throw new WalletError("INVALID_ENTRY", "idempotencyKey required string");
    }
    if (!input.kind) throw new WalletError("INVALID_ENTRY", "kind required");
    if (!input.refType || !input.refId) {
      throw new WalletError("INVALID_ENTRY", "refType and refId required");
    }
    if (!input.currency) throw new WalletError("INVALID_CURRENCY", "currency required");
    if (!input.entries || input.entries.length < 2) {
      throw new WalletError("UNBALANCED_TRANSACTION", "At least 2 entries required for double-entry");
    }

    let sumDebit = 0;
    let sumCredit = 0;

    for (const e of input.entries) {
      if (!e.accountId) throw new WalletError("INVALID_ENTRY", "accountId required in entry");
      const debit = (e.debitMinor ?? 0) as number;
      const credit = (e.creditMinor ?? 0) as number;

      if (debit < 0 || credit < 0) {
        throw new WalletError("INVALID_AMOUNT", "debit/credit must be >=0");
      }
      if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
        throw new WalletError("INVALID_AMOUNT", "debit/credit must be integers");
      }
      if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) {
        throw new WalletError("INVALID_AMOUNT", "debit/credit not safe integer");
      }

      const hasDebit = debit > 0;
      const hasCredit = credit > 0;

      if (hasDebit && hasCredit) {
        throw new WalletError("INVALID_ENTRY", `Entry for account ${e.accountId} has both debit and credit >0`);
      }
      if (!hasDebit && !hasCredit) {
        throw new WalletError("INVALID_ENTRY", `Entry for account ${e.accountId} has neither debit nor credit`);
      }

      sumDebit += debit;
      sumCredit += credit;
    }

    if (sumDebit === 0 || sumCredit === 0) {
      throw new WalletError("UNBALANCED_TRANSACTION", "Sum must be >0");
    }
    if (sumDebit !== sumCredit) {
      throw new WalletError(
        "UNBALANCED_TRANSACTION",
        `Unbalanced transaction: debits ${sumDebit} != credits ${sumCredit}`,
      );
    }
  }

  getPrisma(): PrismaClient {
    return this.prisma;
  }
}
