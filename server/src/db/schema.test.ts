import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";

class Rollback extends Error {}

/**
 * Runs `work` inside a database transaction and ALWAYS rolls it back,
 * so tests can write freely without changing the seeded data.
 * Errors thrown by `work` (for example a constraint violation) are re-thrown.
 */
async function withRollback(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await work(tx);
        throw new Rollback("intentional rollback");
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

async function loadFixtures(tx: Prisma.TransactionClient) {
  const admin = await tx.user.findUniqueOrThrow({ where: { email: "admin@demo-school.test" } });
  const student = await tx.student.findUniqueOrThrow({ where: { studentNumber: "STU-0003" } });
  const term = await tx.term.findUniqueOrThrow({ where: { name: "Fall 2026" } });
  return { admin, student, term };
}

describe("database schema guarantees", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("has the seeded users: 1 admin, 2 teachers, 4 parents", async () => {
    const [admins, teachers, parents] = await Promise.all([
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.user.count({ where: { role: "TEACHER" } }),
      prisma.user.count({ where: { role: "PARENT" } }),
    ]);

    expect([admins, teachers, parents]).toEqual([1, 2, 4]);
  });

  it("rejects a second user with the same email", async () => {
    await expect(
      withRollback(async (tx) => {
        await tx.user.create({
          data: {
            email: "admin@demo-school.test",
            name: "Duplicate Admin",
            role: "PARENT",
            passwordHash: "not-a-real-hash",
          },
        });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("accepts a valid positive payment (control for the tests below)", async () => {
    await withRollback(async (tx) => {
      const { admin, student, term } = await loadFixtures(tx);

      const payment = await tx.payment.create({
        data: {
          studentId: student.id,
          termId: term.id,
          amountCents: 1_000,
          method: "CASH",
          recordedById: admin.id,
        },
      });

      expect(payment.amountCents).toBe(1_000);
    });
  });

  it.each([0, -500])("rejects a payment of %i cents (CHECK constraint)", async (amountCents) => {
    await expect(
      withRollback(async (tx) => {
        const { admin, student, term } = await loadFixtures(tx);

        await tx.payment.create({
          data: {
            studentId: student.id,
            termId: term.id,
            amountCents,
            method: "CASH",
            recordedById: admin.id,
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("gives each payment a higher receipt number than the one before", async () => {
    await withRollback(async (tx) => {
      const { admin, student, term } = await loadFixtures(tx);
      const data = {
        studentId: student.id,
        termId: term.id,
        amountCents: 500,
        method: "CASH" as const,
        recordedById: admin.id,
      };

      const first = await tx.payment.create({ data });
      const second = await tx.payment.create({ data });

      expect(second.receiptNumber).toBeGreaterThan(first.receiptNumber);
    });
  });

  it("allows deleting a student who has no payments (control)", async () => {
    await withRollback(async (tx) => {
      await tx.student.delete({ where: { studentNumber: "STU-0003" } });
    });
  });

  it("refuses to delete a student who has payments (Restrict)", async () => {
    await expect(
      withRollback(async (tx) => {
        await tx.student.delete({ where: { studentNumber: "STU-0001" } });
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate fee name for the same class and term", async () => {
    await expect(
      withRollback(async (tx) => {
        const existing = await tx.feeStructure.findFirstOrThrow();

        await tx.feeStructure.create({
          data: {
            classId: existing.classId,
            termId: existing.termId,
            name: existing.name,
            amountCents: 1_000,
          },
        });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("accepts a term whose end date is after its start date (control)", async () => {
    await withRollback(async (tx) => {
      const term = await tx.term.create({
        data: {
          name: `Test term ${Date.now()}`,
          startDate: new Date("2030-01-01"),
          endDate: new Date("2030-03-01"),
        },
      });

      expect(term.id).toBeTruthy();
    });
  });

  it("rejects a term that ends before it starts (CHECK constraint)", async () => {
    await expect(
      withRollback(async (tx) => {
        await tx.term.create({
          data: {
            name: `Backwards term ${Date.now()}`,
            startDate: new Date("2030-03-01"),
            endDate: new Date("2030-01-01"),
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("keeps voided payments in the table, marked with a reason", async () => {
    const voided = await prisma.payment.findMany({ where: { voidedAt: { not: null } } });

    expect(voided).toHaveLength(1);
    expect(voided[0].voidReason).toBe("Duplicate entry");
  });
});
