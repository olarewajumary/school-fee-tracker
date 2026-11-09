import type { Role } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { sign, verify } from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config";
import { unauthorized } from "../errors/app-error";

const accessPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(["ADMIN", "TEACHER", "PARENT"]),
});

export type AccessTokenPayload = z.infer<typeof accessPayloadSchema>;

type SignOptions = {
  secret?: string;
  ttlSeconds?: number;
};

// Access token: a short-lived, signed JWT carrying only the user id (sub) and role.
export function signAccessToken(user: { id: string; role: Role }, options: SignOptions = {}) {
  const { secret = config.JWT_ACCESS_SECRET, ttlSeconds = config.ACCESS_TOKEN_TTL_MINUTES * 60 } =
    options;

  return sign({ role: user.role }, secret, {
    subject: user.id,
    expiresIn: ttlSeconds,
    algorithm: "HS256",
  });
}

export function verifyAccessToken(
  token: string,
  secret: string = config.JWT_ACCESS_SECRET,
): AccessTokenPayload {
  try {
    // Pinning the algorithm stops "alg" tricks, such as a token claiming it needs no signature.
    const decoded = verify(token, secret, { algorithms: ["HS256"] });
    const parsed = accessPayloadSchema.safeParse(decoded);

    if (!parsed.success) {
      throw new Error("Unexpected token payload");
    }

    return parsed.data;
  } catch {
    // One generic message for every failure (bad signature, expired, malformed),
    // so the response never tells an attacker which part was wrong.
    throw unauthorized("Invalid or expired token");
  }
}

// Refresh token: a random string. The client gets the token; the database gets only its hash.
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
