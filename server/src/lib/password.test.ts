import { describe, expect, it } from "vitest";
import { prisma } from "../db/client";
import { hashPassword, verifyPassword } from "./password";

describe("password helpers", () => {
  it("produces a bcrypt hash with 12 rounds, never the plain password", async () => {
    const hash = await hashPassword("Password123!");

    expect(hash).not.toContain("Password123!");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("accepts the correct password (positive control)", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("gives a different hash each time for the same password (random salt)", async () => {
    const first = await hashPassword("Password123!");
    const second = await hashPassword("Password123!");

    expect(first).not.toBe(second);
    expect(await verifyPassword("Password123!", first)).toBe(true);
    expect(await verifyPassword("Password123!", second)).toBe(true);
  });

  it("verifies the hash that the seed script stored for the demo users", async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo-school.test" },
    });

    expect(await verifyPassword("Password123!", admin.passwordHash)).toBe(true);
  });
});
