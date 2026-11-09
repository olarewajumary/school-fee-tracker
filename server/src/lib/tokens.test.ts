import { sign } from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { AppError } from "../errors/app-error";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens";

const USER = { id: "11111111-1111-4111-8111-111111111111", role: "PARENT" as const };
const OTHER_SECRET = "b".repeat(32);

function toBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodePayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw");
}

describe("access tokens", () => {
  it("round-trips: a token we sign verifies to the same user id and role (positive control)", () => {
    const token = signAccessToken(USER);

    expect(verifyAccessToken(token)).toEqual({ sub: USER.id, role: "PARENT" });
  });

  it("carries only the user id, the role and timestamps", () => {
    const payload = decodePayload(signAccessToken(USER));

    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "role", "sub"]);
  });

  it("expires after the configured lifetime", () => {
    const payload = decodePayload(signAccessToken(USER));

    expect(Number(payload.exp) - Number(payload.iat)).toBe(config.ACCESS_TOKEN_TTL_MINUTES * 60);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signAccessToken(USER, { secret: OTHER_SECRET });

    expect(() => verifyAccessToken(token)).toThrow(AppError);
  });

  it("rejects an expired token", () => {
    const token = signAccessToken(USER, { ttlSeconds: -10 });

    expect(() => verifyAccessToken(token)).toThrow(AppError);
  });

  it("rejects a token whose payload was edited to claim ADMIN (signature no longer matches)", () => {
    const [header, , signature] = signAccessToken(USER).split(".");
    const forgedPayload = toBase64Url({ sub: USER.id, role: "ADMIN" });

    expect(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toThrow(AppError);
  });

  it("rejects an unsigned token that claims alg 'none'", () => {
    const header = toBase64Url({ alg: "none", typ: "JWT" });
    const payload = toBase64Url({ sub: USER.id, role: "ADMIN" });

    expect(() => verifyAccessToken(`${header}.${payload}.`)).toThrow(AppError);
  });

  it("rejects a correctly signed token whose payload has an unknown role", () => {
    const token = sign({ role: "SUPERUSER" }, config.JWT_ACCESS_SECRET, {
      subject: USER.id,
      algorithm: "HS256",
      expiresIn: 60,
    });

    expect(() => verifyAccessToken(token)).toThrow(AppError);
  });

  it.each(["", "not-a-jwt", "a.b.c"])("rejects garbage input %j", (garbage) => {
    expect(() => verifyAccessToken(garbage)).toThrow(AppError);
  });

  it("fails with a generic 401 that does not say which check failed", () => {
    const error = caught(() => verifyAccessToken(signAccessToken(USER, { ttlSeconds: -10 })));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid or expired token",
    });
  });
});

describe("refresh tokens", () => {
  it("generates a 43-character url-safe token and a 64-character hex hash", () => {
    const { token, tokenHash } = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different token every time", () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  it("returns a hash that matches hashing the token again, and never the token itself", () => {
    const { token, tokenHash } = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toBe(token);
  });

  it("uses real SHA-256 (known test vector for 'abc')", () => {
    expect(hashRefreshToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
