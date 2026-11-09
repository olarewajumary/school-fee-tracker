import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "./client";

// Thrown on purpose at the end of every test so the transaction always rolls back.
class Rollback extends Error {}

async function inRolledBackTx(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
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

const IN_SEVEN_DAYS = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

async function seededAdmin(tx: Prisma.TransactionClient) {
  return tx.user.findUniqueOrThrow({ where: { email: "admin@demo-school.test" } });
}

describe("refresh_tokens table", () => {
  it("stores a token for a user (positive control)", async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await seededAdmin(tx);

      const token = await tx.refreshToken.create({
        data: { userId: admin.id, tokenHash: randomUUID(), expiresAt: IN_SEVEN_DAYS() },
      });

      expect(token.userId).toBe(admin.id);
      expect(token.revokedAt).toBeNull();
      expect(token.replacedById).toBeNull();
      expect(token.expiresAt.getTime()).toBeGreaterThan(token.createdAt.getTime());
    });
  });

  it("rejects a token that expires before it was created (CHECK constraint)", async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await seededAdmin(tx);

      await expect(
        tx.refreshToken.create({
          data: {
            userId: admin.id,
            tokenHash: randomUUID(),
            expiresAt: new Date("2000-01-01T00:00:00Z"),
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("rejects a duplicate token hash (unique constraint)", async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await seededAdmin(tx);
      const tokenHash = randomUUID();

      await tx.refreshToken.create({
        data: { userId: admin.id, tokenHash, expiresAt: IN_SEVEN_DAYS() },
      });

      await expect(
        tx.refreshToken.create({
          data: { userId: admin.id, tokenHash, expiresAt: IN_SEVEN_DAYS() },
        }),
      ).rejects.toThrow();
    });
  });

  it("links an old token to the token that replaced it (rotation chain)", async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await seededAdmin(tx);

      const next = await tx.refreshToken.create({
        data: { userId: admin.id, tokenHash: randomUUID(), expiresAt: IN_SEVEN_DAYS() },
      });
      const old = await tx.refreshToken.create({
        data: {
          userId: admin.id,
          tokenHash: randomUUID(),
          expiresAt: IN_SEVEN_DAYS(),
          revokedAt: new Date(),
          replacedById: next.id,
        },
        include: { replacedBy: true },
      });

      expect(old.replacedBy?.id).toBe(next.id);

      const successor = await tx.refreshToken.findUniqueOrThrow({
        where: { id: next.id },
        include: { replaces: true },
      });
      expect(successor.replaces?.id).toBe(old.id);
    });
  });

  it("deletes a user's tokens when the user is deleted (CASCADE)", async () => {
    await inRolledBackTx(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `cascade-${randomUUID()}@test.local`,
          passwordHash: "not-a-real-hash",
          name: "Cascade Test",
          role: "PARENT",
        },
      });
      await tx.refreshToken.create({
        data: { userId: user.id, tokenHash: randomUUID(), expiresAt: IN_SEVEN_DAYS() },
      });

      await tx.user.delete({ where: { id: user.id } });

      const remaining = await tx.refreshToken.count({ where: { userId: user.id } });
      expect(remaining).toBe(0);
    });
  });

  it("clears the link, not the old token, when the successor is deleted (SET NULL)", async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await seededAdmin(tx);

      const next = await tx.refreshToken.create({
        data: { userId: admin.id, tokenHash: randomUUID(), expiresAt: IN_SEVEN_DAYS() },
      });
      const old = await tx.refreshToken.create({
        data: {
          userId: admin.id,
          tokenHash: randomUUID(),
          expiresAt: IN_SEVEN_DAYS(),
          replacedById: next.id,
        },
      });

      await tx.refreshToken.delete({ where: { id: next.id } });

      const stillThere = await tx.refreshToken.findUniqueOrThrow({ where: { id: old.id } });
      expect(stillThere.replacedById).toBeNull();
    });
  });
});
