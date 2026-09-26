export type SettlementErrorCode =
  | "BET_NOT_FOUND"
  | "INVALID_RESULT_VERSION"
  | "INVALID_SOURCE"
  | "INVALID_LEG_RESULT"
  | "INCOMPLETE_RESULT"
  | "RESULT_CONFLICT"
  | "RESETTLEMENT_REQUIRED"
  | "ACCOUNT_ERROR"
  | "SETTLEMENT_CONFLICT";

export class SettlementError extends Error {
  public readonly code: SettlementErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: SettlementErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
    this.details = details;
  }
}
