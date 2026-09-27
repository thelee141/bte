import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import type { BetLegInput } from "../betting/types.js";
import {
  EventStatus,
  MarketState,
  type CanonicalMarket,
  type CanonicalOutcome,
  type CanonicalPrice,
  type SportsProvider,
} from "../sports/types.js";
import { validateMinorUnits } from "../wallet/money.js";
import { BetslipError } from "./errors.js";
import type {
  BookingRecord,
  BookingSnapshotV1,
  BetslipMode,
  BetslipSelectionSnapshot,
  ImportedBooking,
  LoadedBooking,
  LoadedBookingSelection,
  PersistedBetslip,
  PreparedSlip,
  ReconciledBetslip,
  ReconciledSelection,
  SelectionFreshness,
  ToggleSelectionResult,
} from "./types.js";

const DEFAULT_CURRENCY = "NGN";
const DEFAULT_BOOKING_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BOOKING_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_MAX_USES = 100;
const MAX_BOOKING_USES = 10_000;
const BOOKING_CODE_LENGTH = 12;
const BOOKING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_CODE_ATTEMPTS = 8;

type PrismaSlip = Prisma.BetslipGetPayload<{
  include: { selections: true };
}>;

type PrismaBooking = Prisma.BookingCodeGetPayload<Record<string, never>>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isBetslipMode(value: unknown): value is BetslipMode {
  return value === "SIM" || value === "REAL";
}

function normalizeBookingCode(code: string): string {
  return code.trim().toUpperCase();
}

function generateBookingCode(): string {
  const bytes = randomBytes(BOOKING_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < BOOKING_CODE_LENGTH; index++) {
    code += BOOKING_ALPHABET[bytes[index] & 31];
  }
  return code;
}

function selectionSnapshotFromRow(
  row: Prisma.BetslipSelectionGetPayload<Record<string, never>>,
): BetslipSelectionSnapshot & { readonly id: string } {
  return {
    id: row.id,
    eventId: row.eventId,
    marketId: row.marketId,
    outcomeId: row.outcomeId,
    priceId: row.priceId,
    priceVersion: row.priceVersion,
    decimalOdds: row.decimalOdds,
    marketVersion: row.marketVersion,
    marketState: row.marketState,
    outcomeState: row.outcomeState,
  };
}

function snapshotWithoutId(
  selection: BetslipSelectionSnapshot & { readonly id?: string },
): BetslipSelectionSnapshot {
  return {
    eventId: selection.eventId,
    marketId: selection.marketId,
    outcomeId: selection.outcomeId,
    priceId: selection.priceId,
    priceVersion: selection.priceVersion,
    decimalOdds: selection.decimalOdds,
    marketVersion: selection.marketVersion,
    marketState: selection.marketState,
    outcomeState: selection.outcomeState,
  };
}

function mapSlip(row: PrismaSlip): PersistedBetslip {
  return {
    id: row.id,
    userId: row.userId,
    mode: row.mode as BetslipMode,
    state: row.state as PersistedBetslip["state"],
    currency: row.currency,
    stakeMinor: row.stakeMinor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    selections: [...row.selections]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map(selectionSnapshotFromRow),
  };
}

function mapBooking(row: PrismaBooking): BookingRecord {
  return {
    code: row.code,
    sourceSlipId: row.sourceSlipId,
    createdByUserId: row.createdByUserId,
    priceBasis: "SNAPSHOT_AT_BOOKING",
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    useCount: row.useCount,
    createdAt: row.createdAt,
  };
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BetslipError("BOOKING_INVALID", `Booking snapshot field ${field} is invalid`);
  }
}

function parseSnapshotSelection(value: unknown): BetslipSelectionSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BetslipError("BOOKING_INVALID", "Booking selection must be an object");
  }
  const row = value as Record<string, unknown>;

  assertNonEmptyString(row.eventId, "eventId");
  assertNonEmptyString(row.marketId, "marketId");
  assertNonEmptyString(row.outcomeId, "outcomeId");
  assertNonEmptyString(row.priceId, "priceId");
  assertNonEmptyString(row.decimalOdds, "decimalOdds");
  assertNonEmptyString(row.marketState, "marketState");
  assertNonEmptyString(row.outcomeState, "outcomeState");

  if (!Number.isInteger(row.priceVersion) || (row.priceVersion as number) < 1) {
    throw new BetslipError("BOOKING_INVALID", "Booking priceVersion must be an integer >= 1");
  }
  if (!Number.isInteger(row.marketVersion) || (row.marketVersion as number) < 1) {
    throw new BetslipError("BOOKING_INVALID", "Booking marketVersion must be an integer >= 1");
  }

  return {
    eventId: row.eventId,
    marketId: row.marketId,
    outcomeId: row.outcomeId,
    priceId: row.priceId,
    priceVersion: row.priceVersion as number,
    decimalOdds: row.decimalOdds,
    marketVersion: row.marketVersion as number,
    marketState: row.marketState,
    outcomeState: row.outcomeState,
  };
}

function parseBookingSnapshot(value: Prisma.JsonValue): BookingSnapshotV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BetslipError("BOOKING_INVALID", "Booking snapshot must be an object");
  }
  const row = value as Record<string, Prisma.JsonValue>;

  if (row.version !== 1) {
    throw new BetslipError("BOOKING_INVALID", "Unsupported booking snapshot version");
  }
  if (!isBetslipMode(row.mode)) {
    throw new BetslipError("BOOKING_INVALID", "Booking mode is invalid");
  }
  assertNonEmptyString(row.currency, "currency");

  let stakeMinor: number | null = null;
  if (row.stakeMinor !== null) {
    if (typeof row.stakeMinor !== "number") {
      throw new BetslipError("BOOKING_INVALID", "Booking stakeMinor must be an integer or null");
    }
    stakeMinor = validateMinorUnits(row.stakeMinor);
  }

  if (!Array.isArray(row.selections)) {
    throw new BetslipError("BOOKING_INVALID", "Booking selections must be an array");
  }

  return {
    version: 1,
    mode: row.mode,
    currency: row.currency,
    stakeMinor,
    selections: row.selections.map(parseSnapshotSelection),
  };
}

function currentSnapshot(
  market: CanonicalMarket,
  outcome: CanonicalOutcome,
  price: CanonicalPrice,
): BetslipSelectionSnapshot {
  return {
    eventId: market.eventId,
    marketId: market.id,
    outcomeId: outcome.id,
    priceId: price.id,
    priceVersion: price.version,
    decimalOdds: price.decimalOdds,
    marketVersion: market.version,
    marketState: market.state,
    outcomeState: outcome.state,
  };
}

function snapshotChanged(
  stored: BetslipSelectionSnapshot,
  current: BetslipSelectionSnapshot,
): boolean {
  return (
    stored.priceId !== current.priceId ||
    stored.priceVersion !== current.priceVersion ||
    stored.decimalOdds !== current.decimalOdds ||
    stored.marketVersion !== current.marketVersion
  );
}

export class BetslipService {
  private readonly prisma: PrismaClient;
  private readonly provider: SportsProvider;
  private readonly clock: () => Date;

  constructor(opts: { prisma?: PrismaClient; provider: SportsProvider; clock?: () => Date }) {
    this.prisma = opts.prisma ?? new PrismaClient();
    this.provider = opts.provider;
    this.clock = opts.clock ?? (() => new Date());
  }

  async createSlip(input: {
    userId: string;
    mode?: BetslipMode;
    currency?: string;
  }): Promise<PersistedBetslip> {
    if (!input?.userId) throw new BetslipError("FORBIDDEN", "userId is required");
    const mode = input.mode ?? "REAL";
    if (!isBetslipMode(mode)) throw new BetslipError("INVALID_MODE", `Unsupported mode ${String(mode)}`);
    const currency = input.currency ?? DEFAULT_CURRENCY;
    if (!currency) throw new BetslipError("INVALID_STATE", "currency is required");

    const created = await this.prisma.betslip.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        mode,
        state: "DRAFT",
        currency,
      },
      include: { selections: true },
    });
    return mapSlip(created);
  }

  async getSlip(userId: string, slipId: string): Promise<PersistedBetslip> {
    return mapSlip(await this.getOwnedSlip(userId, slipId));
  }

  async listSlips(
    userId: string,
    opts?: { state?: "DRAFT" | "ARCHIVED"; limit?: number },
  ): Promise<PersistedBetslip[]> {
    if (!userId) return [];
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
    const rows = await this.prisma.betslip.findMany({
      where: {
        userId,
        ...(opts?.state ? { state: opts.state } : {}),
      },
      include: { selections: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return rows.map(mapSlip);
  }

  async setStake(userId: string, slipId: string, stakeMinor: number | null): Promise<PersistedBetslip> {
    const slip = await this.getOwnedSlip(userId, slipId);
    this.assertDraft(slip);

    let nextStake: number | null = null;
    if (stakeMinor !== null) {
      nextStake = validateMinorUnits(stakeMinor);
      if (nextStake <= 0) throw new BetslipError("INVALID_STAKE", "Stake must be > 0");
    }

    await this.prisma.betslip.update({
      where: { id: slipId },
      data: { stakeMinor: nextStake },
    });
    return this.getSlip(userId, slipId);
  }

  async archiveSlip(userId: string, slipId: string): Promise<PersistedBetslip> {
    const slip = await this.getOwnedSlip(userId, slipId);
    if (slip.state === "ARCHIVED") return mapSlip(slip);

    await this.prisma.betslip.update({
      where: { id: slipId },
      data: { state: "ARCHIVED" },
    });
    return this.getSlip(userId, slipId);
  }

  async toggleSelection(input: {
    userId: string;
    slipId: string;
    eventId: string;
    marketId: string;
    outcomeId: string;
  }): Promise<ToggleSelectionResult> {
    if (!input.userId || !input.slipId) {
      throw new BetslipError("SLIP_NOT_FOUND", "userId and slipId are required");
    }

    const before = await this.getOwnedSlip(input.userId, input.slipId);
    this.assertDraft(before);

    const sameOutcome = before.selections.find((selection) => selection.outcomeId === input.outcomeId);
    if (sameOutcome) {
      await this.prisma.betslipSelection.delete({ where: { id: sameOutcome.id } });
      return { action: "REMOVED", slip: await this.getSlip(input.userId, input.slipId) };
    }

    const snapshot = await this.resolveOpenSelection(input.eventId, input.marketId, input.outcomeId);

    const action = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>
        `SELECT id FROM "betslips" WHERE id = ${input.slipId} FOR UPDATE`;
      if (locked.length === 0) {
        throw new BetslipError("SLIP_NOT_FOUND", `Slip ${input.slipId} not found`);
      }

      const slip = await tx.betslip.findUnique({
        where: { id: input.slipId },
        include: { selections: true },
      });
      if (!slip) throw new BetslipError("SLIP_NOT_FOUND", `Slip ${input.slipId} not found`);
      if (slip.userId !== input.userId) {
        throw new BetslipError("FORBIDDEN", "Slip does not belong to this user");
      }
      this.assertDraft(slip);

      const sameOutcomeInside = slip.selections.find(
        (selection) => selection.outcomeId === input.outcomeId,
      );
      if (sameOutcomeInside) {
        await tx.betslipSelection.delete({ where: { id: sameOutcomeInside.id } });
        return "REMOVED" as const;
      }

      const sameMarket = slip.selections.find((selection) => selection.marketId === input.marketId);
      if (sameMarket) {
        await tx.betslipSelection.update({
          where: { id: sameMarket.id },
          data: snapshot,
        });
        return "REPLACED" as const;
      }

      await tx.betslipSelection.create({
        data: {
          id: randomUUID(),
          slipId: input.slipId,
          ...snapshot,
        },
      });
      return "ADDED" as const;
    });

    return { action, slip: await this.getSlip(input.userId, input.slipId) };
  }

  async removeSelection(userId: string, slipId: string, selectionId: string): Promise<PersistedBetslip> {
    const slip = await this.getOwnedSlip(userId, slipId);
    this.assertDraft(slip);
    if (!slip.selections.some((selection) => selection.id === selectionId)) {
      throw new BetslipError("INVALID_SELECTION", "Selection does not belong to this slip");
    }

    await this.prisma.betslipSelection.delete({ where: { id: selectionId } });
    return this.getSlip(userId, slipId);
  }

  async clearSlip(userId: string, slipId: string): Promise<PersistedBetslip> {
    const slip = await this.getOwnedSlip(userId, slipId);
    this.assertDraft(slip);
    await this.prisma.betslipSelection.deleteMany({ where: { slipId } });
    return this.getSlip(userId, slipId);
  }

  async reconcileSlip(userId: string, slipId: string): Promise<ReconciledBetslip> {
    const slip = await this.getOwnedSlip(userId, slipId);
    const mapped = mapSlip(slip);
    const selections = await Promise.all(
      mapped.selections.map((selection) => this.inspectSelection(selection)),
    );

    return {
      slip: mapped,
      selections,
      blocked: selections.some((selection) => selection.status !== "CURRENT"),
    };
  }

  async acceptPriceChanges(userId: string, slipId: string): Promise<PersistedBetslip> {
    const reconciled = await this.reconcileSlip(userId, slipId);
    this.assertDraft(reconciled.slip);

    const changed = reconciled.selections.filter(
      (selection) => selection.status === "PRICE_CHANGED" && selection.current !== null,
    );
    if (changed.length === 0) return reconciled.slip;

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>
        `SELECT id FROM "betslips" WHERE id = ${slipId} FOR UPDATE`;
      if (locked.length === 0) throw new BetslipError("SLIP_NOT_FOUND", `Slip ${slipId} not found`);

      const lockedSlip = await tx.betslip.findUnique({ where: { id: slipId } });
      if (!lockedSlip) throw new BetslipError("SLIP_NOT_FOUND", `Slip ${slipId} not found`);
      if (lockedSlip.userId !== userId) throw new BetslipError("FORBIDDEN", "Slip does not belong to this user");
      this.assertDraft(lockedSlip);

      for (const selection of changed) {
        if (!selection.current) continue;
        await tx.betslipSelection.updateMany({
          where: { id: selection.selectionId, slipId },
          data: snapshotWithoutId(selection.current),
        });
      }
    });

    return this.getSlip(userId, slipId);
  }

  async prepareForPlacement(userId: string, slipId: string): Promise<PreparedSlip> {
    const reconciled = await this.reconcileSlip(userId, slipId);
    const slip = reconciled.slip;
    this.assertDraft(slip);

    if (slip.mode !== "REAL") {
      throw new BetslipError("INVALID_MODE", "SIM slips cannot be submitted to the wallet betting engine");
    }
    if (slip.selections.length === 0) {
      throw new BetslipError("EMPTY_SLIP", "At least one selection is required");
    }
    if (slip.stakeMinor === null || slip.stakeMinor <= 0) {
      throw new BetslipError("INVALID_STAKE", "A positive persisted stake is required");
    }

    const priceChanged = reconciled.selections.filter((selection) => selection.status === "PRICE_CHANGED");
    if (priceChanged.length > 0) {
      throw new BetslipError("PRICE_CHANGED", "One or more selections require explicit price acceptance", {
        selectionIds: priceChanged.map((selection) => selection.selectionId),
      });
    }

    const suspended = reconciled.selections.filter((selection) => selection.status === "SUSPENDED");
    if (suspended.length > 0) {
      throw new BetslipError("SUSPENDED", "One or more selections are suspended", {
        selectionIds: suspended.map((selection) => selection.selectionId),
      });
    }

    const unavailable = reconciled.selections.filter((selection) => selection.status === "UNAVAILABLE");
    if (unavailable.length > 0) {
      throw new BetslipError("UNAVAILABLE_SELECTION", "One or more selections are unavailable", {
        selectionIds: unavailable.map((selection) => selection.selectionId),
      });
    }

    const legs: BetLegInput[] = reconciled.selections.map((selection) => {
      const current = selection.current;
      if (!current) {
        throw new BetslipError("UNAVAILABLE_SELECTION", "Selection lost authoritative quote during preparation");
      }
      return {
        eventId: current.eventId,
        marketId: current.marketId,
        outcomeId: current.outcomeId,
        expectedPriceVersion: current.priceVersion,
        expectedDecimalOdds: current.decimalOdds,
      };
    });

    return {
      slipId: slip.id,
      userId: slip.userId,
      currency: slip.currency,
      stakeMinor: validateMinorUnits(slip.stakeMinor),
      legs,
    };
  }

  async bookSlip(input: {
    userId: string;
    slipId: string;
    ttlSeconds?: number;
    maxUses?: number;
  }): Promise<BookingRecord> {
    const slip = await this.getOwnedSlip(input.userId, input.slipId);
    this.assertDraft(slip);
    if (slip.selections.length === 0) {
      throw new BetslipError("EMPTY_SLIP", "Cannot book an empty slip");
    }

    const ttlSeconds = input.ttlSeconds ?? DEFAULT_BOOKING_TTL_SECONDS;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_BOOKING_TTL_SECONDS) {
      throw new BetslipError(
        "BOOKING_INVALID",
        `ttlSeconds must be an integer between 60 and ${MAX_BOOKING_TTL_SECONDS}`,
      );
    }

    const maxUses = input.maxUses ?? DEFAULT_MAX_USES;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_BOOKING_USES) {
      throw new BetslipError(
        "BOOKING_INVALID",
        `maxUses must be an integer between 1 and ${MAX_BOOKING_USES}`,
      );
    }

    const snapshot: BookingSnapshotV1 = {
      version: 1,
      mode: slip.mode as BetslipMode,
      currency: slip.currency,
      stakeMinor: slip.stakeMinor,
      selections: slip.selections.map((selection) => snapshotWithoutId(selectionSnapshotFromRow(selection))),
    };

    const now = this.clock();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateBookingCode();
      try {
        const created = await this.prisma.bookingCode.create({
          data: {
            id: randomUUID(),
            code,
            sourceSlipId: slip.id,
            createdByUserId: slip.userId,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            priceBasis: "SNAPSHOT_AT_BOOKING",
            expiresAt,
            maxUses,
          },
        });
        return mapBooking(created);
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }

    throw new BetslipError("CODE_GENERATION_FAILED", "Could not generate a unique booking code");
  }

  async loadBooking(codeInput: string): Promise<LoadedBooking> {
    const code = normalizeBookingCode(codeInput);
    if (!code) throw new BetslipError("BOOKING_NOT_FOUND", "Booking code is required");

    const booking = await this.prisma.bookingCode.findUnique({ where: { code } });
    if (!booking) throw new BetslipError("BOOKING_NOT_FOUND", `Booking code ${code} not found`);

    const now = this.clock();
    this.assertBookingUsable(booking, now);

    const snapshot = parseBookingSnapshot(booking.snapshot);
    const selections = await Promise.all(
      snapshot.selections.map(async (booked): Promise<LoadedBookingSelection> => {
        const inspected = await this.inspectSnapshot(booked, booked.outcomeId);
        return {
          booked,
          current: inspected.current,
          status: inspected.status,
          reason: inspected.reason,
        };
      }),
    );

    const consumed = await this.prisma.bookingCode.updateMany({
      where: {
        id: booking.id,
        expiresAt: { gt: now },
        useCount: { lt: booking.maxUses },
      },
      data: {
        useCount: { increment: 1 },
        lastUsedAt: now,
      },
    });

    if (consumed.count !== 1) {
      const latest = await this.prisma.bookingCode.findUnique({ where: { id: booking.id } });
      if (!latest) throw new BetslipError("BOOKING_NOT_FOUND", `Booking code ${code} not found`);
      this.assertBookingUsable(latest, now);
      throw new BetslipError("BOOKING_EXHAUSTED", `Booking code ${code} has no remaining uses`);
    }

    const updated = await this.prisma.bookingCode.findUnique({ where: { id: booking.id } });
    if (!updated) throw new BetslipError("BOOKING_NOT_FOUND", `Booking code ${code} disappeared`);

    return {
      code,
      mode: snapshot.mode,
      currency: snapshot.currency,
      stakeMinor: snapshot.stakeMinor,
      expiresAt: updated.expiresAt,
      maxUses: updated.maxUses,
      useCount: updated.useCount,
      selections,
    };
  }

  async importBooking(input: {
    userId: string;
    code: string;
    targetSlipId?: string;
  }): Promise<ImportedBooking> {
    if (!input.userId) throw new BetslipError("FORBIDDEN", "userId is required");

    let target: PersistedBetslip | null = null;
    if (input.targetSlipId) {
      target = await this.getSlip(input.userId, input.targetSlipId);
      this.assertDraft(target);
    }

    const booking = await this.loadBooking(input.code);

    if (!target) {
      target = await this.createSlip({
        userId: input.userId,
        mode: booking.mode,
        currency: booking.currency,
      });
    }

    const importable = booking.selections.filter((selection) => selection.current !== null);
    const unavailableCount = booking.selections.length - importable.length;

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>
        `SELECT id FROM "betslips" WHERE id = ${target.id} FOR UPDATE`;
      if (locked.length === 0) throw new BetslipError("SLIP_NOT_FOUND", `Slip ${target.id} not found`);

      const slip = await tx.betslip.findUnique({ where: { id: target.id } });
      if (!slip) throw new BetslipError("SLIP_NOT_FOUND", `Slip ${target.id} not found`);
      if (slip.userId !== input.userId) throw new BetslipError("FORBIDDEN", "Slip does not belong to this user");
      this.assertDraft(slip);

      await tx.betslipSelection.deleteMany({ where: { slipId: target.id } });

      for (const selection of importable) {
        const current = selection.current;
        if (!current) continue;
        await tx.betslipSelection.create({
          data: {
            id: randomUUID(),
            slipId: target.id,
            ...snapshotWithoutId(current),
          },
        });
      }

      await tx.betslip.update({
        where: { id: target.id },
        data: {
          mode: booking.mode,
          currency: booking.currency,
          stakeMinor: booking.stakeMinor,
        },
      });
    });

    return {
      booking,
      slip: await this.getSlip(input.userId, target.id),
      importedCount: importable.length,
      unavailableCount,
    };
  }

  private async getOwnedSlip(userId: string, slipId: string): Promise<PrismaSlip> {
    if (!userId || !slipId) throw new BetslipError("SLIP_NOT_FOUND", "userId and slipId are required");

    const slip = await this.prisma.betslip.findUnique({
      where: { id: slipId },
      include: { selections: true },
    });
    if (!slip) throw new BetslipError("SLIP_NOT_FOUND", `Slip ${slipId} not found`);
    if (slip.userId !== userId) throw new BetslipError("FORBIDDEN", "Slip does not belong to this user");
    return slip;
  }

  private assertDraft(slip: { state: string }): void {
    if (slip.state !== "DRAFT") {
      throw new BetslipError("INVALID_STATE", `Slip state ${slip.state} is not editable`);
    }
  }

  private assertBookingUsable(booking: PrismaBooking, now: Date): void {
    if (booking.expiresAt.getTime() <= now.getTime()) {
      throw new BetslipError("BOOKING_EXPIRED", `Booking code ${booking.code} has expired`);
    }
    if (booking.useCount >= booking.maxUses) {
      throw new BetslipError("BOOKING_EXHAUSTED", `Booking code ${booking.code} has no remaining uses`);
    }
  }

  private async resolveOpenSelection(
    eventId: string,
    marketId: string,
    outcomeId: string,
  ): Promise<BetslipSelectionSnapshot> {
    const event = await this.provider.getEvent(eventId);
    if (!event) throw new BetslipError("INVALID_SELECTION", `Event ${eventId} not found`);

    if (event.status === EventStatus.SUSPENDED || event.status === EventStatus.PAUSED) {
      throw new BetslipError("SUSPENDED", `Event ${eventId} is ${event.status}`);
    }
    if (
      event.status === EventStatus.CANCELLED ||
      event.status === EventStatus.ABANDONED ||
      event.status === EventStatus.FINAL
    ) {
      throw new BetslipError("UNAVAILABLE_SELECTION", `Event ${eventId} is ${event.status}`);
    }

    const markets = await this.provider.listMarkets(eventId);
    const market = markets.find((candidate) => candidate.id === marketId);
    if (!market) {
      throw new BetslipError("INVALID_SELECTION", `Market ${marketId} not found for event ${eventId}`);
    }
    if (market.state === MarketState.SUSPENDED) {
      throw new BetslipError("SUSPENDED", `Market ${marketId} is suspended`);
    }
    if (market.state !== MarketState.OPEN) {
      throw new BetslipError("UNAVAILABLE_SELECTION", `Market ${marketId} is ${market.state}`);
    }

    const outcome = market.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) {
      throw new BetslipError("INVALID_SELECTION", `Outcome ${outcomeId} not found in market ${marketId}`);
    }
    if (outcome.state === MarketState.SUSPENDED) {
      throw new BetslipError("SUSPENDED", `Outcome ${outcomeId} is suspended`);
    }
    if (outcome.state !== MarketState.OPEN) {
      throw new BetslipError("UNAVAILABLE_SELECTION", `Outcome ${outcomeId} is ${outcome.state}`);
    }

    const price = await this.latestPrice(outcomeId);
    if (!price) {
      throw new BetslipError("UNAVAILABLE_SELECTION", `Outcome ${outcomeId} has no current price`);
    }

    return currentSnapshot(market, outcome, price);
  }

  private async inspectSelection(
    selection: BetslipSelectionSnapshot & { readonly id: string },
  ): Promise<ReconciledSelection> {
    const inspected = await this.inspectSnapshot(selection, selection.outcomeId);
    return {
      selectionId: selection.id,
      stored: snapshotWithoutId(selection),
      current: inspected.current,
      status: inspected.status,
      reason: inspected.reason,
    };
  }

  private async inspectSnapshot(
    stored: BetslipSelectionSnapshot,
    outcomeId: string,
  ): Promise<{
    current: BetslipSelectionSnapshot | null;
    status: SelectionFreshness;
    reason?: string;
  }> {
    const event = await this.provider.getEvent(stored.eventId);
    if (!event) return { current: null, status: "UNAVAILABLE", reason: "EVENT_NOT_FOUND" };

    if (
      event.status === EventStatus.CANCELLED ||
      event.status === EventStatus.ABANDONED ||
      event.status === EventStatus.FINAL
    ) {
      return { current: null, status: "UNAVAILABLE", reason: `EVENT_${event.status}` };
    }

    const markets = await this.provider.listMarkets(stored.eventId);
    const market = markets.find((candidate) => candidate.id === stored.marketId);
    if (!market) return { current: null, status: "UNAVAILABLE", reason: "MARKET_NOT_FOUND" };

    const outcome = market.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) return { current: null, status: "UNAVAILABLE", reason: "OUTCOME_NOT_FOUND" };

    const price = await this.latestPrice(outcome.id);
    if (!price) return { current: null, status: "UNAVAILABLE", reason: "PRICE_NOT_FOUND" };

    const current = currentSnapshot(market, outcome, price);

    if (
      event.status === EventStatus.SUSPENDED ||
      event.status === EventStatus.PAUSED ||
      market.state === MarketState.SUSPENDED ||
      outcome.state === MarketState.SUSPENDED
    ) {
      return { current, status: "SUSPENDED", reason: "TRADING_SUSPENDED" };
    }

    if (market.state !== MarketState.OPEN || outcome.state !== MarketState.OPEN) {
      return { current: null, status: "UNAVAILABLE", reason: "MARKET_OR_OUTCOME_CLOSED" };
    }

    if (snapshotChanged(stored, current)) {
      return { current, status: "PRICE_CHANGED", reason: "PRICE_OR_MARKET_VERSION_CHANGED" };
    }

    return { current, status: "CURRENT" };
  }

  private async latestPrice(outcomeId: string): Promise<CanonicalPrice | null> {
    const prices = await this.provider.getPrices(outcomeId);
    if (prices.length === 0) return null;
    return [...prices].sort((a, b) => b.version - a.version)[0] ?? null;
  }
}
