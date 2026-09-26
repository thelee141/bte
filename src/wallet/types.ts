import type { Prisma } from "@prisma/client";
import type { MinorUnits, SignedMinorUnits } from "./money.js";

export type LedgerTx = Prisma.TransactionClient;

export type WalletAccountKind = "REAL" | "BONUS";

export type LedgerKind = "PLAY_GRANT" | "STAKE_RESERVE" | "WIN_CREDIT" | "STAKE_REFUND" | "ADJUSTMENT";

export type WalletErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "ACCOUNT_FROZEN"
  | "ACCOUNT_NOT_FOUND"
  | "DUPLICATE_ACCOUNT"
  | "INVALID_AMOUNT"
  | "CURRENCY_MISMATCH"
  | "UNBALANCED_TRANSACTION"
  | "IDEMPOTENT_REPLAY"
  | "INVALID_CURRENCY"
  | "INVALID_ENTRY"
  | "SYSTEM_ACCOUNT_ERROR";

export class WalletError extends Error {
  public readonly code: WalletErrorCode;
  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

export interface WalletAccount {
  readonly id: string;
  readonly userId: string;
  readonly kind: WalletAccountKind;
  readonly currency: string;
  readonly frozen: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LedgerTransaction {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: LedgerKind;
  readonly refType: string;
  readonly refId: string;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly entries?: LedgerEntry[];
}

export interface LedgerEntry {
  readonly id: string;
  readonly txnId: string;
  readonly accountId: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
  readonly createdAt: Date;
}

export interface PostInput {
  readonly kind: LedgerKind;
  readonly idempotencyKey: string;
  readonly currency: string;
  readonly refType: string;
  readonly refId: string;
  readonly entries: ReadonlyArray<{
    readonly accountId: string;
    readonly debitMinor?: MinorUnits;
    readonly creditMinor?: MinorUnits;
  }>;
}

export interface LedgerServiceShape {
  createAccount(userId: string, kind: WalletAccountKind, currency?: string): Promise<WalletAccount>;
  getBalance(accountId: string, opts?: { tx?: LedgerTx }): Promise<SignedMinorUnits>;
  post(input: PostInput, opts?: { tx?: LedgerTx }): Promise<LedgerTransaction>;
  listTransactions(accountId: string, opts?: { limit?: number }): Promise<LedgerTransaction[]>;
}
