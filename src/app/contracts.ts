export interface ApiSport {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface ApiCategory {
  readonly id: string;
  readonly sportId: string;
  readonly slug: string;
  readonly name: string;
  readonly region?: string;
}

export interface ApiCompetition {
  readonly id: string;
  readonly sportId: string;
  readonly categoryId: string;
  readonly slug: string;
  readonly name: string;
}

export interface ApiPrice {
  readonly id: string;
  readonly outcomeId: string;
  readonly version: number;
  readonly decimalOdds: string;
}

export interface ApiOutcome {
  readonly id: string;
  readonly marketId: string;
  readonly label: string;
  readonly state: string;
  readonly price: ApiPrice | null;
}

export interface ApiMarket {
  readonly id: string;
  readonly eventId: string;
  readonly type: string;
  readonly line: string | null;
  readonly state: string;
  readonly version: number;
  readonly outcomes: readonly ApiOutcome[];
}

export interface ApiEvent {
  readonly id: string;
  readonly sportId: string;
  readonly categoryId: string;
  readonly competitionId: string;
  readonly startsAt: string;
  readonly status: string;
  readonly liveClock: string | null;
  readonly period: string | null;
  readonly score: {
    readonly home: number;
    readonly away: number;
  } | null;
  readonly home: {
    readonly id: string;
    readonly name: string;
    readonly shortName?: string;
  };
  readonly away: {
    readonly id: string;
    readonly name: string;
    readonly shortName?: string;
  };
  readonly markets: readonly ApiMarket[];
}

export interface ApiSlipSelection {
  readonly id: string;
  readonly eventId: string;
  readonly marketId: string;
  readonly outcomeId: string;
  readonly priceId: string;
  readonly priceVersion: number;
  readonly decimalOdds: string;
  readonly marketVersion: number;
  readonly marketState: string;
  readonly outcomeState: string;
  readonly freshness: "CURRENT" | "PRICE_CHANGED" | "SUSPENDED" | "UNAVAILABLE";
  readonly currentDecimalOdds: string | null;
  readonly currentPriceVersion: number | null;
}

export interface ApiSlip {
  readonly id: string;
  readonly mode: "SIM" | "REAL";
  readonly currency: string;
  readonly stakeMinor: number | null;
  readonly blocked: boolean;
  readonly selections: readonly ApiSlipSelection[];
}

export interface ApiBetHistory {
  readonly betId: string;
  readonly betRef: string;
  readonly stakeMinor: number;
  readonly totalOdds: string;
  readonly potentialWinMinor: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly settlement: {
    readonly resultVersion: number;
    readonly outcome: string;
    readonly creditMinor: number;
    readonly createdAt: string;
  } | null;
}

export interface ApiBootstrap {
  readonly demo: {
    readonly userId: string;
    readonly balanceMinor: number;
    readonly currency: "NGN";
    readonly playMoney: true;
  };
  readonly sports: readonly ApiSport[];
  readonly categories: readonly ApiCategory[];
  readonly competitions: readonly ApiCompetition[];
  readonly events: readonly ApiEvent[];
  readonly slip: ApiSlip;
  readonly openBets: readonly ApiBetHistory[];
  readonly settledBets: readonly ApiBetHistory[];
}

export interface ApiReceipt {
  readonly id: string;
  readonly betRef: string;
  readonly txnRef: string;
  readonly stakeMinor: number;
  readonly totalOdds: string;
  readonly potentialWinMinor: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly legCount: number;
}

export interface ApiBooking {
  readonly code: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly useCount: number;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}
