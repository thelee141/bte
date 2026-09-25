export type BetErrorCode =
  | "INVALID_SELECTION"
  | "SUSPENDED"
  | "STALE_PRICE"
  | "INSUFFICIENT_FUNDS"
  | "INVALID_STAKE"
  | "DUPLICATE_LEG"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_FROZEN"
  | "IDEMPOTENCY_CONFLICT";

export class BetError extends Error {
  public readonly code: BetErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: BetErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BetError";
    this.code = code;
    this.details = details;
  }
}
