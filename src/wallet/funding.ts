import { PrismaClient } from "@prisma/client";
import { validateMinorUnits, type MinorUnits } from "./money.js";
import { LedgerService } from "./ledger.js";
import type { LedgerTransaction, WalletAccountKind } from "./types.js";
import { WalletError } from "./types.js";

const DEFAULT_CURRENCY = "NGN";
const SYSTEM_PLAY_MINT_ID = "system_play_mint";
const SYSTEM_STAKE_POOL_ID = "system_stake_pool";

export class FundingService {
  private readonly ledger: LedgerService;
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient, ledger?: LedgerService) {
    this.prisma = prisma ?? new PrismaClient();
    this.ledger = ledger ?? new LedgerService(this.prisma);
  }

  private async ensureSystemAccount(id: string): Promise<void> {
    const existing = await this.prisma.walletAccount.findUnique({ where: { id } });
    if (existing) return;
    try {
      await this.prisma.walletAccount.create({
        data: {
          id,
          // distinct userId per system account: (userId,kind,currency) is unique
          userId: id,
          kind: "REAL",
          currency: DEFAULT_CURRENCY,
          frozen: false,
        },
      });
    } catch {
      // ignore race — unique constraint means another caller won
    }
  }

  private async ensureUserAccount(
    userId: string,
    kind: WalletAccountKind = "REAL",
    currency = DEFAULT_CURRENCY,
  ): Promise<string> {
    const existing = await this.prisma.walletAccount.findFirst({
      where: { userId, kind, currency },
    });
    if (existing) return existing.id;
    try {
      const acc = await this.ledger.createAccount(userId, kind, currency);
      return acc.id;
    } catch (e) {
      if (e instanceof WalletError && e.code === "DUPLICATE_ACCOUNT") {
        const again = await this.prisma.walletAccount.findFirst({
          where: { userId, kind, currency },
        });
        if (again) return again.id;
      }
      throw e;
    }
  }

  async grantPlayMoney(params: {
    userId: string;
    amount: MinorUnits;
    idempotencyKey: string;
    currency?: string;
  }): Promise<LedgerTransaction> {
    const currency = params.currency ?? DEFAULT_CURRENCY;
    const amount = validateMinorUnits(params.amount);
    if (amount <= 0) throw new WalletError("INVALID_AMOUNT", "grant amount must be >0");
    if (!params.userId) throw new WalletError("INVALID_ENTRY", "userId required");
    if (!params.idempotencyKey) throw new WalletError("INVALID_ENTRY", "idempotencyKey required");

    await this.ensureSystemAccount(SYSTEM_PLAY_MINT_ID);
    const userAccountId = await this.ensureUserAccount(params.userId, "REAL", currency);

    return this.ledger.post({
      kind: "PLAY_GRANT",
      idempotencyKey: params.idempotencyKey,
      currency,
      refType: "PLAY_GRANT",
      refId: `${params.userId}:${params.idempotencyKey}`,
      entries: [
        { accountId: SYSTEM_PLAY_MINT_ID, debitMinor: amount },
        { accountId: userAccountId, creditMinor: amount },
      ],
    });
  }

  async debitStake(params: {
    userId: string;
    amount: MinorUnits;
    betRef: string;
    idempotencyKey: string;
    currency?: string;
  }): Promise<LedgerTransaction> {
    const currency = params.currency ?? DEFAULT_CURRENCY;
    const amount = validateMinorUnits(params.amount);
    if (amount <= 0) throw new WalletError("INVALID_AMOUNT", "stake amount must be >0");
    if (!params.betRef) throw new WalletError("INVALID_ENTRY", "betRef required");

    await this.ensureSystemAccount(SYSTEM_STAKE_POOL_ID);
    const userAccountId = await this.ensureUserAccount(params.userId, "REAL", currency);

    return this.ledger.post({
      kind: "STAKE_RESERVE",
      idempotencyKey: params.idempotencyKey,
      currency,
      refType: "BET",
      refId: params.betRef,
      entries: [
        { accountId: userAccountId, debitMinor: amount },
        { accountId: SYSTEM_STAKE_POOL_ID, creditMinor: amount },
      ],
    });
  }

  async creditWinnings(params: {
    userId: string;
    amount: MinorUnits;
    betRef: string;
    idempotencyKey: string;
    currency?: string;
  }): Promise<LedgerTransaction> {
    const currency = params.currency ?? DEFAULT_CURRENCY;
    const amount = validateMinorUnits(params.amount);
    if (amount <= 0) throw new WalletError("INVALID_AMOUNT", "winnings amount must be >0");

    await this.ensureSystemAccount(SYSTEM_PLAY_MINT_ID);
    const userAccountId = await this.ensureUserAccount(params.userId, "REAL", currency);

    return this.ledger.post({
      kind: "WIN_CREDIT",
      idempotencyKey: params.idempotencyKey,
      currency,
      refType: "BET",
      refId: params.betRef,
      entries: [
        { accountId: SYSTEM_PLAY_MINT_ID, debitMinor: amount },
        { accountId: userAccountId, creditMinor: amount },
      ],
    });
  }

  async refundStake(params: {
    userId: string;
    amount: MinorUnits;
    betRef: string;
    idempotencyKey: string;
    currency?: string;
  }): Promise<LedgerTransaction> {
    const currency = params.currency ?? DEFAULT_CURRENCY;
    const amount = validateMinorUnits(params.amount);
    if (amount <= 0) throw new WalletError("INVALID_AMOUNT", "refund amount must be >0");

    await this.ensureSystemAccount(SYSTEM_STAKE_POOL_ID);
    const userAccountId = await this.ensureUserAccount(params.userId, "REAL", currency);

    return this.ledger.post({
      kind: "STAKE_REFUND",
      idempotencyKey: params.idempotencyKey,
      currency,
      refType: "BET",
      refId: params.betRef,
      entries: [
        { accountId: SYSTEM_STAKE_POOL_ID, debitMinor: amount },
        { accountId: userAccountId, creditMinor: amount },
      ],
    });
  }

  getLedger(): LedgerService {
    return this.ledger;
  }

  getPrisma(): PrismaClient {
    return this.prisma;
  }
}
