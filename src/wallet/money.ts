/**
 * Money helpers — minor-units (kobo) only, NO floats.
 *
 * Rounding policy (documented):
 * All stake × odds calculations are performed in integer arithmetic:
 * odds string "x.yy" → oddsHundredths = x*100 + yy (integer)
 * potentialWinKobo = floor((stakeKobo * oddsHundredths + 50) / 100)
 * i.e. half-up rounding to the nearest kobo (0.5 → up).
 * Example: stake 333 (3.33 NGN) × "1.33" (133) → 333*133=44289 → +50=44339 → /100=443 kobo.
 * This is deterministic and avoids IEEE float.
 *
 * Amount parsing:
 * NGN amounts are strings "123.45" with exactly 2 decimal places, non-negative.
 * "1.8", "-5", "abc" are invalid and throw.
 */

import { DECIMAL_ODDS_REGEX } from "../sports/types.js";

export type MinorUnits = number & { readonly __brand: "MinorUnits" };

/**
 * A ledger balance may be negative (contra/system accounts such as the
 * play-money mint debit without a funding source). Amounts are always
 * non-negative `MinorUnits`; balances are signed `SignedMinorUnits`.
 */
export type SignedMinorUnits = number & { readonly __brand: "SignedMinorUnits" };

export function validateSignedMinorUnits(value: unknown): SignedMinorUnits {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new MoneyError(`Invalid SignedMinorUnits: ${String(value)}`);
  }
  return value as SignedMinorUnits;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const AMOUNT_REGEX = /^\d+\.\d{2}$/;

function assertSafeInteger(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError(`Amount not safe integer: ${n}`);
  }
}

export function validateMinorUnits(value: unknown): MinorUnits {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
    throw new MoneyError(`Invalid MinorUnits: ${String(value)}`);
  }
  return value as MinorUnits;
}

export function toMinorUnits(amountStr: string): MinorUnits {
  if (typeof amountStr !== "string") {
    throw new MoneyError(`Amount must be string, got ${typeof amountStr}`);
  }
  if (!AMOUNT_REGEX.test(amountStr)) {
    throw new MoneyError(`Amount "${amountStr}" must match ${AMOUNT_REGEX}`);
  }
  const [wholeStr, fracStr] = amountStr.split(".");
  if (!/^\d+$/.test(wholeStr) || !/^\d{2}$/.test(fracStr)) {
    throw new MoneyError(`Invalid amount format "${amountStr}"`);
  }
  const whole = Number.parseInt(wholeStr, 10);
  const frac = Number.parseInt(fracStr, 10);
  if (!Number.isInteger(whole) || !Number.isInteger(frac)) {
    throw new MoneyError(`Invalid amount components "${amountStr}"`);
  }
  const minor = whole * 100 + frac;
  assertSafeInteger(minor);
  if (minor < 0) throw new MoneyError(`Negative amount "${amountStr}"`);
  return minor as MinorUnits;
}

export function fromMinorUnits(minor: MinorUnits | number): string {
  const m = validateMinorUnits(minor as number);
  const whole = Math.floor(m / 100);
  const frac = m % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function parseOddsHundredths(oddsStr: string): number {
  if (typeof oddsStr !== "string") throw new MoneyError(`Odds must be string`);
  if (!DECIMAL_ODDS_REGEX.test(oddsStr)) {
    throw new MoneyError(`Odds "${oddsStr}" must match ${DECIMAL_ODDS_REGEX}`);
  }
  const [wholeStr, fracStr] = oddsStr.split(".");
  const whole = Number.parseInt(wholeStr, 10);
  const frac = Number.parseInt(fracStr, 10);
  const hundredths = whole * 100 + frac;
  if (!Number.isInteger(hundredths) || hundredths < 100) {
    throw new MoneyError(`Odds "${oddsStr}" invalid hundredths ${hundredths}`);
  }
  return hundredths;
}

/**
 * Calculate potential win (stake × odds) in minor units, half-up rounded.
 * stake: MinorUnits (kobo)
 * oddsStr: decimal string "1.38"
 * returns: MinorUnits (kobo) = stake * odds rounded half-up
 */
export function calculatePotentialWin(stake: MinorUnits, oddsStr: string): MinorUnits {
  const s = validateMinorUnits(stake);
  if (s === 0) return 0 as MinorUnits;
  const oddsHundredths = parseOddsHundredths(oddsStr);
  const numerator = s * oddsHundredths;
  assertSafeInteger(numerator);
  const result = Math.floor((numerator + 50) / 100);
  assertSafeInteger(result);
  return result as MinorUnits;
}

/**
 * Calculate profit (win - stake) — convenience, still integer.
 */
export function calculateProfit(stake: MinorUnits, oddsStr: string): MinorUnits {
  const win = calculatePotentialWin(stake, oddsStr);
  const s = validateMinorUnits(stake);
  if (win < s) {
    return 0 as MinorUnits;
  }
  return (win - s) as MinorUnits;
}
