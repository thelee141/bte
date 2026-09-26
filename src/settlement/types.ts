export type LegSettlementOutcome = "WON" | "LOST" | "VOID";
export type BetSettlementOutcome = "WON" | "LOST" | "VOID" | "PARTIAL_VOID";

export interface LegSettlementDecision {
  readonly betLegId: string;
  readonly outcome: LegSettlementOutcome;
}

export interface SettleBetInput {
  readonly betId: string;
  readonly resultVersion: number;
  readonly source: string;
  readonly legs: ReadonlyArray<LegSettlementDecision>;
}

export interface SettledLeg {
  readonly betLegId: string;
  readonly outcome: LegSettlementOutcome;
}

export interface SettledBet {
  readonly settlementId: string;
  readonly betId: string;
  readonly betRef: string;
  readonly resultVersion: number;
  readonly source: string;
  readonly outcome: BetSettlementOutcome;
  readonly creditMinor: number;
  readonly ledgerTxnId: string | null;
  readonly createdAt: Date;
  readonly legs: ReadonlyArray<SettledLeg>;
}

export interface BetHistoryItem {
  readonly betId: string;
  readonly betRef: string;
  readonly userId: string;
  readonly stakeMinor: number;
  readonly totalOdds: string;
  readonly potentialWinMinor: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
  readonly settlement: {
    readonly resultVersion: number;
    readonly outcome: BetSettlementOutcome;
    readonly creditMinor: number;
    readonly createdAt: Date;
  } | null;
}
