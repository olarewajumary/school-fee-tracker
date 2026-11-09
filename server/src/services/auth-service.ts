import type { Prisma, Role } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db/client";
import { conflict, unauthorized } from "../errors/app-error";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "../lib/tokens";

// Works with the real client or a transaction client, so tests can run in a rolled-back transaction.
type Db = Prisma.TransactionClient;

export type PublicUser = { id: string; email: string; name: string; role: Role };

export type Session = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
} satisfies Prisma.UserSelect;

// One message for every login failure, so the response never reveals whether the email exists.
const INVALID_CREDENTIALS = "Invalid email or password";
const INVALID_REFRESH = "Invalid or expired session";

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

// Used when the email is unknown, so a missing account takes as long to reject as a wrong
// password. Without it, response time would reveal which emails are registered.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("timing-safety-placeholder");
  return dummyHash;
}

async function createRefreshToken(db: Db, userId: string) {
  const { token, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * DAY_MS);

  const row = await db.refreshToken.create({ data: { userId, tokenHash, expiresAt } });

  return { id: row.id, token, expiresAt };
}

async function startSession(db: Db, user: PublicUser): Promise<Session> {
  const refresh = await createRefreshToken(db, user.id);

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

async function revokeAllForUser(db: Db, userId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function registerParent(
  input: { email: string; password: string; name: string },
  db: Db = prisma,
): Promise<Session> {
  const email = normalizeEmail(input.email);

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw conflict("An account with this email already exists");
  }

  const user = await db.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: "PARENT",
    },
    select: PUBLIC_USER_SELECT,
  });

  return startSession(db, user);
}

export async function login(
  input: { email: string; password: string },
  db: Db = prisma,
): Promise<Session> {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(input.email) } });

  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await getDummyHash()),
  );

  if (!user || !user.isActive || !passwordMatches) {
    throw unauthorized(INVALID_CREDENTIALS);
  }

  return startSession(db, toPublicUser(user));
}

export async function refreshSession(rawToken: string, db: Db = prisma): Promise<Session> {
  const stored = await db.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: true },
  });

  if (!stored) {
    throw unauthorized(INVALID_REFRESH);
  }

  if (stored.revokedAt) {
    // Already swapped for a newer token, yet someone presented the old one: likely theft.
    if (stored.replacedById) {
      await revokeAllForUser(db, stored.userId);
    }
    throw unauthorized(INVALID_REFRESH);
  }

  if (stored.expiresAt <= new Date() || !stored.user.isActive) {
    throw unauthorized(INVALID_REFRESH);
  }

  // Claim the token. The "revokedAt: null" condition makes this safe if two requests race:
  // only one update can match, and the loser gets count 0.
  const claimed = await db.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (claimed.count !== 1) {
    throw unauthorized(INVALID_REFRESH);
  }

  const next = await createRefreshToken(db, stored.userId);
  await db.refreshToken.update({ where: { id: stored.id }, data: { replacedById: next.id } });

  const user = toPublicUser(stored.user);

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: next.token,
    refreshExpiresAt: next.expiresAt,
  };
}

// Logout is idempotent: an unknown, expired or already revoked token is not an error.
export async function logout(rawToken: string | undefined, db: Db = prisma): Promise<void> {
  if (!rawToken) return;

  await db.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
