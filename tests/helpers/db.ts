import type { PrismaClient } from "@prisma/client";

const SYSTEM_ACCOUNT_IDS = ["system_play_mint", "system_stake_pool"];

export async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.bookingCode.deleteMany({}),
    prisma.betslipSelection.deleteMany({}),
    prisma.betslip.deleteMany({}),
    prisma.settlementLeg.deleteMany({}),
    prisma.settlement.deleteMany({}),
    prisma.betLeg.deleteMany({}),
    prisma.bet.deleteMany({}),
    prisma.ledgerEntry.deleteMany({}),
    prisma.ledgerTransaction.deleteMany({}),
    prisma.walletAccount.deleteMany({
      where: {
        id: {
          notIn: SYSTEM_ACCOUNT_IDS,
        },
      },
    }),
  ]);
}
