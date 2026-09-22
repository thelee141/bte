import { describe, it, expect } from "vitest";
import {
  toMinorUnits,
  fromMinorUnits,
  calculatePotentialWin,
  calculateProfit,
  validateMinorUnits,
  parseOddsHundredths,
} from "../src/wallet/money.js";
import type { MinorUnits } from "../src/wallet/money.js";

function minor(n: number): MinorUnits {
  return n as MinorUnits;
}

describe("money helpers", () => {
  it("parse 100.00 NGN -> 10000 kobo", () => {
    expect(toMinorUnits("100.00")).toBe(10000);
    expect(toMinorUnits("0.00")).toBe(0);
    expect(toMinorUnits("0.01")).toBe(1);
    expect(toMinorUnits("123456.78")).toBe(12345678);
  });

  it("invalid amounts throw", () => {
    expect(() => toMinorUnits("1.8")).toThrow();
    expect(() => toMinorUnits("-5")).toThrow();
    expect(() => toMinorUnits("abc")).toThrow();
    expect(() => toMinorUnits("1.234")).toThrow();
    expect(() => toMinorUnits("")).toThrow();
    expect(() => toMinorUnits("1.")).toThrow();
    expect(() => toMinorUnits(".00")).toThrow();
  });

  it("fromMinorUnits formats correctly", () => {
    expect(fromMinorUnits(minor(10000))).toBe("100.00");
    expect(fromMinorUnits(minor(0))).toBe("0.00");
    expect(fromMinorUnits(minor(1))).toBe("0.01");
  });

  it("validateMinorUnits rejects non-integer, negative", () => {
    expect(() => validateMinorUnits(-1)).toThrow();
    expect(() => validateMinorUnits(1.5)).toThrow();
    expect(() => validateMinorUnits("100")).toThrow();
  });

  it("potential-win: stake 10000 × odds 1.38 = 13800", () => {
    const stake = toMinorUnits("100.00");
    const win = calculatePotentialWin(stake, "1.38");
    expect(win).toBe(13800);
  });

  it("half-up rounding: stake 333 × 1.33 = 443", () => {
    const win = calculatePotentialWin(minor(333), "1.33");
    expect(win).toBe(443);
  });

  it("half-up exact .5 case: 50 × 1.01 = 50.5 -> 51", () => {
    const win = calculatePotentialWin(minor(50), "1.01");
    expect(win).toBe(51);
  });

  it("profit is win minus stake", () => {
    expect(calculateProfit(toMinorUnits("100.00"), "1.38")).toBe(3800);
  });

  it("odds parsing rejects invalid", () => {
    expect(() => parseOddsHundredths("1.8")).toThrow();
    expect(() => parseOddsHundredths("0.99")).toThrow();
    expect(() => parseOddsHundredths("abc")).toThrow();
  });

  it("zero stake returns zero", () => {
    const win = calculatePotentialWin(minor(0), "2.00");
    expect(win).toBe(0);
  });
});
