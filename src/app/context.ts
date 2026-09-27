import { PrismaClient } from "@prisma/client";
import { BettingService } from "../betting/service.js";
import { BetslipService } from "../betslip/service.js";
import { DeterministicRealtimeFixture } from "../realtime/fixture.js";
import { RealtimeHub } from "../realtime/hub.js";
import { RealtimeOverlayProvider } from "../realtime/provider.js";
import { SettlementService } from "../settlement/service.js";
import { FixtureSportsProvider } from "../sports/provider.js";
import { FundingService } from "../wallet/funding.js";
import { LedgerService } from "../wallet/ledger.js";
import { toMinorUnits } from "../wallet/money.js";

export const DEMO_USER_ID = "demo_play_user";
export const DEMO_CURRENCY = "NGN";
const DEMO_GRANT_IDEMPOTENCY = "demo_seed_grant_v1";

export interface AppContext {
  readonly prisma: PrismaClient;
  readonly ledger: LedgerService;
  readonly funding: FundingService;
  readonly baseProvider: FixtureSportsProvider;
  readonly realtimeHub: RealtimeHub;
  readonly realtimeProvider: RealtimeOverlayProvider;
  readonly realtimeFixture: DeterministicRealtimeFixture;
  readonly betting: BettingService;
  readonly betslip: BetslipService;
  readonly settlement: SettlementService;
}

export async function createAppContext(): Promise<AppContext> {
  const prisma = new PrismaClient();
  const ledger = new LedgerService(prisma);
  const funding = new FundingService(prisma, ledger);
  const baseProvider = new FixtureSportsProvider("customer-web-fixture-v1");
  const realtimeHub = new RealtimeHub({ historyLimit: 500 });
  const realtimeProvider = new RealtimeOverlayProvider(baseProvider, realtimeHub);
  const realtimeFixture = new DeterministicRealtimeFixture(baseProvider, realtimeHub);
  const betting = new BettingService({
    prisma,
    ledger,
    funding,
    provider: realtimeProvider,
  });
  const betslip = new BetslipService({
    prisma,
    provider: realtimeProvider,
  });
  const settlement = new SettlementService({ prisma, ledger });

  await ledger.ensureSystemAccounts();
  const existingDemoWallet = await prisma.walletAccount.findFirst({
    where: {
      userId: DEMO_USER_ID,
      kind: "REAL",
      currency: DEMO_CURRENCY,
    },
  });
  if (!existingDemoWallet) {
    await ledger.createAccount(DEMO_USER_ID, "REAL", DEMO_CURRENCY);
  }
  await funding.grantPlayMoney({
    userId: DEMO_USER_ID,
    amount: toMinorUnits("50000.00"),
    idempotencyKey: DEMO_GRANT_IDEMPOTENCY,
  });

  await realtimeFixture.seed();

  return {
    prisma,
    ledger,
    funding,
    baseProvider,
    realtimeHub,
    realtimeProvider,
    realtimeFixture,
    betting,
    betslip,
    settlement,
  };
}

export async function ensureDemoDraftSlip(context: AppContext): Promise<string> {
  const existing = await context.betslip.listSlips(DEMO_USER_ID, {
    state: "DRAFT",
    limit: 1,
  });
  if (existing[0]) return existing[0].id;

  const created = await context.betslip.createSlip({
    userId: DEMO_USER_ID,
    mode: "REAL",
    currency: DEMO_CURRENCY,
  });
  return created.id;
}

export async function demoBalanceMinor(context: AppContext): Promise<number> {
  const wallet = await context.prisma.walletAccount.findFirst({
    where: {
      userId: DEMO_USER_ID,
      kind: "REAL",
      currency: DEMO_CURRENCY,
    },
  });
  if (!wallet) throw new Error("Demo wallet is missing");
  return context.ledger.getBalance(wallet.id);
}
