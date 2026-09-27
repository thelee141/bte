export function formatNgn(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}₦${(abs / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function parseStakeInput(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function oddsHundredths(value: string): bigint | null {
  if (!/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

export function displayPotentialReturn(stakeMinor: number, odds: readonly string[]): number {
  if (stakeMinor <= 0 || odds.length === 0) return 0;
  let total = oddsHundredths(odds[0]);
  if (total === null) return 0;

  for (let index = 1; index < odds.length; index++) {
    const next = oddsHundredths(odds[index]);
    if (next === null) return 0;
    total = (total * next + 50n) / 100n;
  }

  return Number((BigInt(stakeMinor) * total + 50n) / 100n);
}
