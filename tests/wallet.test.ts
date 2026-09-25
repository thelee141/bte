import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { LedgerService } from "../src/wallet/ledger.js";
import { FundingService } from "../src/wallet/funding.js";
import { toMinorUnits } from "../src/wallet/money.js";
import type { MinorUnits } from "../src/wallet/money.js";

const prisma = new PrismaClient();
const ledger = new LedgerService(prisma);
const funding = new FundingService(prisma, ledger);

async function ensureSystemAccounts(): Promise<void> {
  await ledger.ensureSystemAccounts();
}

function minor(n: number): MinorUnits {
  return n as MinorUnits;
}

beforeEach(async () => {
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({}),
    prisma.ledgerTransaction.deleteMany({}),
    prisma.betLeg.deleteMany({}),
    prisma.bet.deleteMany({}),
    prisma.walletAccount.deleteMany({
      where: {
        userId: {
          notIn: ["system_play_mint", "system_stake_pool"],
        },
      },
    }),
  ]);
  await ensureSystemAccounts();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueUserId(): string {
  return `user_${randomUUID()}`;
}

describe("wallet ledger", () => {
  it("createAccount + getBalance zero before funding", async () => {
    const userId = uniqueUserId();
    const acc = await ledger.createAccount(userId, "REAL", "NGN");
    expect(acc.userId).toBe(userId);
    const bal = await ledger.getBalance(acc.id);
    expect(bal).toBe(0);
  });

  it("duplicate [userId,kind,currency] -> DUPLICATE_ACCOUNT", async () => {
    const userId = uniqueUserId();
    await ledger.createAccount(userId, "REAL", "NGN");
    await expect(ledger.createAccount(userId, "REAL", "NGN")).rejects.toMatchObject({
      code: "DUPLICATE_ACCOUNT",
    });
    const bonus = await ledger.createAccount(userId, "BONUS", "NGN");
    expect(bonus.kind).toBe("BONUS");
  });

  it("grantPlayMoney credits; replay same key returns original txn, balance unchanged", async () => {
    const userId = uniqueUserId();
    const acc = await ledger.createAccount(userId, "REAL", "NGN");
    const amount = toMinorUnits("100.00");
    const key = `grant_${randomUUID()}`;

    const txn1 = await funding.grantPlayMoney({ userId, amount, idempotencyKey: key });
    expect(txn1.idempotencyKey).toBe(key);

    const bal1 = await ledger.getBalance(acc.id);
    expect(bal1).toBe(10000);

    const txn2 = await funding.grantPlayMoney({ userId, amount, idempotencyKey: key });
    expect(txn2.id).toBe(txn1.id);

    const bal2 = await ledger.getBalance(acc.id);
    expect(bal2).toBe(10000);

    const count = await prisma.ledgerTransaction.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it("debitStake with insufficient funds -> INSUFFICIENT_FUNDS, zero writes", async () => {
    const userId = uniqueUserId();
    const acc = await ledger.createAccount(userId, "REAL", "NGN");
    const bal0 = await ledger.getBalance(acc.id);
    expect(bal0).toBe(0);

    const amount = toMinorUnits("50.00");
    const key = `stake_${randomUUID()}`;
    await expect(
      funding.debitStake({ userId, amount, betRef: `bet_${randomUUID()}`, idempotencyKey: key }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });

    const txns = await prisma.ledgerTransaction.findMany({ where: { idempotencyKey: key } });
    expect(txns.length).toBe(0);

    const balAfter = await ledger.getBalance(acc.id);
    expect(balAfter).toBe(0);
  });

  it("concurrent duplicate post() -> one txn row, both callers get same id", async () => {
    const userId = uniqueUserId();
    const userAcc = await ledger.createAccount(userId, "REAL", "NGN");
    await funding.grantPlayMoney({ userId, amount: toMinorUnits("200.00"), idempotencyKey: `fund_${randomUUID()}` });

    const stakePoolId = "system_stake_pool";
    const idempotencyKey = `concurrent_${randomUUID()}`;
    const betRef = `bet_${randomUUID()}`;
    const amount = toMinorUnits("50.00");

    const input = {
      kind: "STAKE_RESERVE" as const,
      idempotencyKey,
      currency: "NGN",
      refType: "BET",
      refId: betRef,
      entries: [
        { accountId: userAcc.id, debitMinor: amount },
        { accountId: stakePoolId, creditMinor: amount },
      ],
    };

    const [txn1, txn2] = await Promise.all([ledger.post(input), ledger.post(input)]);

    expect(txn1.id).toBe(txn2.id);
    const count = await prisma.ledgerTransaction.count({ where: { idempotencyKey } });
    expect(count).toBe(1);

    const bal = await ledger.getBalance(userAcc.id);
    expect(bal).toBe(15000);
  });

  it("double-entry integrity: debit==credit per txn; one side positive per entry", async () => {
    const userId = uniqueUserId();
    await funding.grantPlayMoney({ userId, amount: toMinorUnits("100.00"), idempotencyKey: `grant_${randomUUID()}` });
    await funding.debitStake({
      userId,
      amount: toMinorUnits("30.00"),
      betRef: `bet_${randomUUID()}`,
      idempotencyKey: `stake_${randomUUID()}`,
    });
    await funding.creditWinnings({
      userId,
      amount: toMinorUnits("60.00"),
      betRef: `bet_${randomUUID()}`,
      idempotencyKey: `win_${randomUUID()}`,
    });

    const txns = await prisma.ledgerTransaction.findMany({ include: { entries: true } });
    expect(txns.length).toBeGreaterThan(0);

    for (const txn of txns) {
      let sumDebit = 0;
      let sumCredit = 0;
      for (const e of txn.entries) {
        sumDebit += e.debitMinor;
        sumCredit += e.creditMinor;
        const hasDebit = e.debitMinor > 0;
        const hasCredit = e.creditMinor > 0;
        expect(hasDebit !== hasCredit).toBe(true);
      }
      expect(sumDebit).toBe(sumCredit);
      expect(sumDebit).toBeGreaterThan(0);
    }
  });

  it("creditWinnings + refundStake flow; frozen account rejects writes", async () => {
    const userId = uniqueUserId();
    const acc = await ledger.createAccount(userId, "REAL", "NGN");
    await funding.grantPlayMoney({ userId, amount: toMinorUnits("100.00"), idempotencyKey: `grant_${randomUUID()}` });

    const betRef = `bet_${randomUUID()}`;
    await funding.debitStake({
      userId,
      amount: toMinorUnits("40.00"),
      betRef,
      idempotencyKey: `stake_${randomUUID()}`,
    });

    let bal = await ledger.getBalance(acc.id);
    expect(bal).toBe(6000);

    await funding.creditWinnings({
      userId,
      amount: toMinorUnits("80.00"),
      betRef,
      idempotencyKey: `win_${randomUUID()}`,
    });
    bal = await ledger.getBalance(acc.id);
    expect(bal).toBe(14000);

    const betRef2 = `bet_${randomUUID()}`;
    await funding.debitStake({
      userId,
      amount: toMinorUnits("20.00"),
      betRef: betRef2,
      idempotencyKey: `stake2_${randomUUID()}`,
    });
    bal = await ledger.getBalance(acc.id);
    expect(bal).toBe(12000);

    await funding.refundStake({
      userId,
      amount: toMinorUnits("20.00"),
      betRef: betRef2,
      idempotencyKey: `refund_${randomUUID()}`,
    });
    bal = await ledger.getBalance(acc.id);
    expect(bal).toBe(14000);

    await prisma.walletAccount.update({ where: { id: acc.id }, data: { frozen: true } });

    await expect(
      funding.grantPlayMoney({ userId, amount: toMinorUnits("10.00"), idempotencyKey: `grant_frozen_${randomUUID()}` }),
    ).rejects.toMatchObject({ code: "ACCOUNT_FROZEN" });

    await expect(
      ledger.post({
        kind: "ADJUSTMENT",
        idempotencyKey: `adj_${randomUUID()}`,
        currency: "NGN",
        refType: "TEST",
        refId: "test",
        entries: [
          { accountId: acc.id, debitMinor: minor(100) },
          { accountId: "system_play_mint", creditMinor: minor(100) },
        ],
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_FROZEN" });
  });

  it("system mint balance may be negative (signed balances)", async () => {
    const userId = uniqueUserId();
    await funding.grantPlayMoney({ userId, amount: toMinorUnits("25.00"), idempotencyKey: `grant_${randomUUID()}` });
    const mintBal = await ledger.getBalance("system_play_mint");
    expect(mintBal).toBe(-2500);
  });

  it("listTransactions returns ordered history", async () => {
    const userId = uniqueUserId();
    const acc = await ledger.createAccount(userId, "REAL", "NGN");
    const keys = [randomUUID(), randomUUID(), randomUUID()];
    for (const k of keys) {
      await funding.grantPlayMoney({ userId, amount: toMinorUnits("10.00"), idempotencyKey: `grant_${k}` });
    }
    const txns = await ledger.listTransactions(acc.id, { limit: 2 });
    expect(txns.length).toBe(2);
    expect(new Date(txns[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(txns[1].createdAt).getTime());
  });
});
