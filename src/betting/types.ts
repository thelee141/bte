import type { MinorUnits } from "../wallet/money.js";

export type BetStatus = "ACCEPTED" | "REJECTED";

export interface BetLegInput {
  readonly eventId: string;
  readonly marketId: string;
  readonly outcomeId: string;
  readonly expectedPriceVersion: number;
  readonly expectedDecimalOdds: string;
}

export interface PlaceBetInput {
  readonly userId: string;
  readonly walletAccountId?: string;
  readonly idempotencyKey: string;
  readonly stakeMinor: MinorUnits;
  readonly currency?: string;
  readonly legs: ReadonlyArray<BetLegInput>;
}

export interface AcceptedBetLeg {
  readonly id: string;
  readonly betId: string;
  readonly eventId: string;
  readonly marketId: string;
  readonly outcomeId: string;
  readonly priceId: string;
  readonly priceVersion: number;
  readonly decimalOdds: string;
  readonly marketVersion: number;
  readonly marketState: string;
  readonly outcomeState: string;
}

export interface AcceptedBet {
  readonly id: string;
  readonly betRef: string;
  readonly userId: string;
  readonly walletAccountId: string;
  readonly idempotencyKey: string;
  readonly stakeMinor: number;
  readonly totalOdds: string;
  readonly potentialWinMinor: number;
  readonly currency: string;
  readonly status: BetStatus;
  readonly createdAt: Date;
  readonly legs: ReadonlyArray<AcceptedBetLeg>;
}

export interface PriceSnapshot {
  readonly priceId: string;
  readonly outcomeId: string;
  readonly version: number;
  readonly decimalOdds: string;
  readonly marketVersion: number;
  readonly marketState: string;
  readonly outcomeState: string;
}
