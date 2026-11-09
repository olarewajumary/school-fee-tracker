import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

// Thrown on purpose at the end of every test so the transaction always rolls back.
class Rollback extends Error {}

export async function inRolledBackTx(
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  } catch (error) {
    // A Rollback is the normal ending. Anything else is a real failure: rethrow it.
    if (!(error instanceof Rollback)) throw error;
  }
}
