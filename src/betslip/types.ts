import type { BetLegInput } from "../betting/types.js";
import type { MinorUnits } from "../wallet/money.js";

export type BetslipMode = "SIM" | "REAL";
export type BetslipState = "DRAFT" | "ARCHIVED";
export type SelectionFreshness = "CURRENT" | "PRICE_CHANGED" | "SUSPENDED" | "UNAVAILABLE";
export type ToggleSelectionAction = "ADDED" | "REPLACED" | "REMOVED";

export interface BetslipSelectionSnapshot {
  readonly id?: string;
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

export interface PersistedBetslip {
  readonly id: string;
  readonly userId: string;
  readonly mode: BetslipMode;
  readonly state: BetslipState;
  readonly currency: string;
  readonly stakeMinor: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly selections: ReadonlyArray<BetslipSelectionSnapshot & { readonly id: string }>;
}

export interface ToggleSelectionResult {
  readonly action: ToggleSelectionAction;
  readonly slip: PersistedBetslip;
}

export interface ReconciledSelection {
  readonly selectionId: string;
  readonly stored: BetslipSelectionSnapshot;
  readonly current: BetslipSelectionSnapshot | null;
  readonly status: SelectionFreshness;
  readonly reason?: string;
}

export interface ReconciledBetslip {
  readonly slip: PersistedBetslip;
  readonly selections: ReadonlyArray<ReconciledSelection>;
  readonly blocked: boolean;
}

export interface BookingSnapshotV1 {
  readonly version: 1;
  readonly mode: BetslipMode;
  readonly currency: string;
  readonly stakeMinor: number | null;
  readonly selections: ReadonlyArray<BetslipSelectionSnapshot>;
}

export interface BookingRecord {
  readonly code: string;
  readonly sourceSlipId: string | null;
  readonly createdByUserId: string;
  readonly priceBasis: "SNAPSHOT_AT_BOOKING";
  readonly expiresAt: Date;
  readonly maxUses: number;
  readonly useCount: number;
  readonly createdAt: Date;
}

export interface LoadedBookingSelection {
  readonly booked: BetslipSelectionSnapshot;
  readonly current: BetslipSelectionSnapshot | null;
  readonly status: SelectionFreshness;
  readonly reason?: string;
}

export interface LoadedBooking {
  readonly code: string;
  readonly mode: BetslipMode;
  readonly currency: string;
  readonly stakeMinor: number | null;
  readonly expiresAt: Date;
  readonly maxUses: number;
  readonly useCount: number;
  readonly selections: ReadonlyArray<LoadedBookingSelection>;
}

export interface ImportedBooking {
  readonly booking: LoadedBooking;
  readonly slip: PersistedBetslip;
  readonly importedCount: number;
  readonly unavailableCount: number;
}

export interface PreparedSlip {
  readonly slipId: string;
  readonly userId: string;
  readonly currency: string;
  readonly stakeMinor: MinorUnits;
  readonly legs: ReadonlyArray<BetLegInput>;
}
