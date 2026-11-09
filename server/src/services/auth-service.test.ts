import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error";
import { hashRefreshToken, verifyAccessToken } from "../lib/tokens";
import { inRolledBackTx } from "../test/rollback";
import { login, logout, refreshSession, registerParent } from "./auth-service";

const PASSWORD = "Password123!";

function uniqueEmail(): string {
  return `auth-${randomUUID()}@test.local`;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
}

describe("registerParent", () => {
  it("creates a PARENT, normalizes the email and name, and returns a working session", async () => {
    await inRolledBackTx(async (tx) => {
      const email = uniqueEmail();

      const session = await registerParent(
        { email: `  ${email.toUpperCase()}  `, password: PASSWORD, name: "  Test Parent  " },
        tx,
      );

      // toEqual fails on extra keys, so this also proves no password hash is returned.
      expect(session.user).toEqual({
        id: expect.any(String),
        email,
        name: "Test Parent",
        role: "PARENT",
      });
      expect(verifyAccessToken(session.accessToken)).toEqual({
        sub: session.user.id,
        role: "PARENT",
      });
      expect(session.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it("stores a bcrypt hash of the password, never the password itself", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Hash Check" },
        tx,
      );

      const row = await tx.user.findUniqueOrThrow({ where: { id: session.user.id } });

      expect(row.passwordHash).not.toContain(PASSWORD);
      expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    });
  });

  it("stores only the hash of the refresh token, not the token", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Token Check" },
        tx,
      );

      const byHash = await tx.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(session.refreshToken) },
      });
      const byRawValue = await tx.refreshToken.count({
        where: { tokenHash: session.refreshToken },
      });

      expect(byHash?.userId).toBe(session.user.id);
      expect(byRawValue).toBe(0);
    });
  });

  it("rejects a duplicate email, even in different letter case, with 409", async () => {
    await inRolledBackTx(async (tx) => {
      const email = uniqueEmail();
      await registerParent({ email, password: PASSWORD, name: "First" }, tx);

      const error = await rejection(
        registerParent({ email: email.toUpperCase(), password: PASSWORD, name: "Second" }, tx),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 409, code: "CONFLICT" });
    });
  });

  it("ignores a role in the input: public registration can only create PARENT", async () => {
    await inRolledBackTx(async (tx) => {
      // A variable (not an object literal) so TypeScript allows the extra "role" field,
      // just like a hostile request body would carry it.
      const hostileInput = {
        email: uniqueEmail(),
        password: PASSWORD,
        name: "Sneaky",
        role: "ADMIN",
      };

      const session = await registerParent(hostileInput, tx);

      expect(session.user.role).toBe("PARENT");
    });
  });
});

describe("login", () => {
  it("logs in a seeded user and stores a refresh token (positive control)", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await login({ email: "admin@demo-school.test", password: PASSWORD }, tx);

      expect(session.user.role).toBe("ADMIN");
      expect(verifyAccessToken(session.accessToken).sub).toBe(session.user.id);

      const stored = await tx.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(session.refreshToken) },
      });
      expect(stored?.userId).toBe(session.user.id);
    });
  });

  it("ignores letter case and surrounding spaces in the email", async () => {
    await inRolledBackTx(async (tx) => {
      const email = uniqueEmail();
      const registered = await registerParent({ email, password: PASSWORD, name: "Case Test" }, tx);

      const session = await login({ email: `  ${email.toUpperCase()}  `, password: PASSWORD }, tx);

      expect(session.user.id).toBe(registered.user.id);
    });
  });

  it("gives the identical 401 for a wrong password, an unknown email and a deactivated account", async () => {
    await inRolledBackTx(async (tx) => {
      const activeEmail = uniqueEmail();
      await registerParent({ email: activeEmail, password: PASSWORD, name: "Active" }, tx);

      const inactiveEmail = uniqueEmail();
      const inactive = await registerParent(
        { email: inactiveEmail, password: PASSWORD, name: "Inactive" },
        tx,
      );
      await tx.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });

      const errors = [
        await rejection(login({ email: activeEmail, password: "WrongPassword1!" }, tx)),
        await rejection(login({ email: uniqueEmail(), password: PASSWORD }, tx)),
        await rejection(login({ email: inactiveEmail, password: PASSWORD }, tx)),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({
          status: 401,
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }
    });
  });
});

describe("refreshSession", () => {
  it("rotates: returns a new token, revokes the old one and links it to its successor", async () => {
    await inRolledBackTx(async (tx) => {
      const first = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Rotate" },
        tx,
      );

      const second = await refreshSession(first.refreshToken, tx);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.user.id).toBe(first.user.id);
      expect(verifyAccessToken(second.accessToken).sub).toBe(first.user.id);

      const oldRow = await tx.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(first.refreshToken) },
      });
      const newRow = await tx.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(second.refreshToken) },
      });

      expect(oldRow.revokedAt).not.toBeNull();
      expect(oldRow.replacedById).toBe(newRow.id);
      expect(newRow.revokedAt).toBeNull();

      // The new token keeps the chain going.
      const third = await refreshSession(second.refreshToken, tx);
      expect(third.refreshToken).not.toBe(second.refreshToken);
    });
  });

  it("treats reuse of an already-rotated token as theft and revokes every session", async () => {
    await inRolledBackTx(async (tx) => {
      const first = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Theft" },
        tx,
      );
      const second = await refreshSession(first.refreshToken, tx);

      // An attacker replays the old token.
      await expect(refreshSession(first.refreshToken, tx)).rejects.toMatchObject({ status: 401 });

      // The legitimate, newer token is now dead too.
      await expect(refreshSession(second.refreshToken, tx)).rejects.toMatchObject({ status: 401 });
    });
  });

  it("rejects an unknown token", async () => {
    await inRolledBackTx(async (tx) => {
      await expect(refreshSession("this-token-does-not-exist", tx)).rejects.toMatchObject({
        status: 401,
        message: "Invalid or expired session",
      });
    });
  });

  it("rejects an expired token", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Expired" },
        tx,
      );

      // Created and expired in the year 2000, so no clock difference can matter.
      const raw = "expired-token-raw-value";
      await tx.refreshToken.create({
        data: {
          userId: session.user.id,
          tokenHash: hashRefreshToken(raw),
          createdAt: new Date("2000-01-01T00:00:00Z"),
          expiresAt: new Date("2000-01-02T00:00:00Z"),
        },
      });

      await expect(refreshSession(raw, tx)).rejects.toMatchObject({ status: 401 });
    });
  });

  it("rejects a valid token once the user has been deactivated", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Deactivated" },
        tx,
      );
      await tx.user.update({ where: { id: session.user.id }, data: { isActive: false } });

      await expect(refreshSession(session.refreshToken, tx)).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  it("rejects a logged-out token without revoking the user's other sessions", async () => {
    await inRolledBackTx(async (tx) => {
      const email = uniqueEmail();
      const phone = await registerParent({ email, password: PASSWORD, name: "Two Devices" }, tx);
      const laptop = await login({ email, password: PASSWORD }, tx);

      await logout(phone.refreshToken, tx);

      await expect(refreshSession(phone.refreshToken, tx)).rejects.toMatchObject({ status: 401 });

      // A plain logout is not theft, so the other device keeps working.
      const refreshed = await refreshSession(laptop.refreshToken, tx);
      expect(refreshed.user.id).toBe(laptop.user.id);
    });
  });
});

describe("logout", () => {
  it("revokes the token so it can no longer be refreshed", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Logout" },
        tx,
      );

      await logout(session.refreshToken, tx);

      const row = await tx.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(session.refreshToken) },
      });
      expect(row.revokedAt).not.toBeNull();
      await expect(refreshSession(session.refreshToken, tx)).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  it("is idempotent: logging out twice does not fail", async () => {
    await inRolledBackTx(async (tx) => {
      const session = await registerParent(
        { email: uniqueEmail(), password: PASSWORD, name: "Twice" },
        tx,
      );

      await logout(session.refreshToken, tx);

      await expect(logout(session.refreshToken, tx)).resolves.toBeUndefined();
    });
  });

  it("does nothing, without an error, for a missing or unknown token", async () => {
    await inRolledBackTx(async (tx) => {
      await expect(logout(undefined, tx)).resolves.toBeUndefined();
      await expect(logout("never-issued-token", tx)).resolves.toBeUndefined();
    });
  });
});
