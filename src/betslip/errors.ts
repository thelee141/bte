export type BetslipErrorCode =
  | "SLIP_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_MODE"
  | "INVALID_STATE"
  | "INVALID_STAKE"
  | "INVALID_SELECTION"
  | "SUSPENDED"
  | "PRICE_CHANGED"
  | "UNAVAILABLE_SELECTION"
  | "EMPTY_SLIP"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_EXPIRED"
  | "BOOKING_EXHAUSTED"
  | "BOOKING_INVALID"
  | "CODE_GENERATION_FAILED";

export class BetslipError extends Error {
  public readonly code: BetslipErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: BetslipErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BetslipError";
    this.code = code;
    this.details = details;
  }
}
