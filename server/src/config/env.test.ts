import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const VALID_DATABASE_URL = "postgresql://user:pass@localhost:5432/school";
const VALID_SECRET = "a".repeat(32);

// Every required variable, with valid values. Each test changes only what it is about.
const VALID_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: VALID_DATABASE_URL,
  JWT_ACCESS_SECRET: VALID_SECRET,
};

/** Runs parseEnv and returns the error message. Fails the test if nothing is thrown. */
function errorMessage(env: NodeJS.ProcessEnv): string {
  try {
    parseEnv(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected parseEnv to throw, but it succeeded");
}

describe("parseEnv", () => {
  it("applies sensible defaults when only the required variables are set", () => {
    const env = parseEnv(VALID_ENV);

    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      CLIENT_URL: "http://localhost:5173",
      LOG_LEVEL: "info",
    });
  });

  it("converts PORT from a string to a number", () => {
    const env = parseEnv({ ...VALID_ENV, PORT: "8080" });

    expect(env.PORT).toBe(8080);
  });

  it("accepts the postgres:// scheme as well as postgresql://", () => {
    const env = parseEnv({
      ...VALID_ENV,
      DATABASE_URL: "postgres://user:pass@localhost:5432/school",
    });

    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(errorMessage({ JWT_ACCESS_SECRET: VALID_SECRET })).toContain("DATABASE_URL");
  });

  it("rejects a DATABASE_URL that is not PostgreSQL", () => {
    expect(
      errorMessage({ ...VALID_ENV, DATABASE_URL: "mysql://user:pass@localhost/school" }),
    ).toContain("PostgreSQL");
  });

  it.each(["abc", "0", "70000"])("rejects PORT=%s", (port) => {
    expect(errorMessage({ ...VALID_ENV, PORT: port })).toContain("PORT");
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(errorMessage({ ...VALID_ENV, NODE_ENV: "staging" })).toContain("NODE_ENV");
  });

  it("rejects a CLIENT_URL that is not a URL", () => {
    expect(errorMessage({ ...VALID_ENV, CLIENT_URL: "not-a-url" })).toContain("CLIENT_URL");
  });

  it("reports every problem at once instead of only the first", () => {
    const message = errorMessage({ PORT: "abc" });

    expect(message).toContain("PORT");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("JWT_ACCESS_SECRET");
  });

  describe("auth settings", () => {
    it("rejects a missing JWT_ACCESS_SECRET (there is deliberately no default)", () => {
      expect(errorMessage({ DATABASE_URL: VALID_DATABASE_URL })).toContain("JWT_ACCESS_SECRET");
    });

    it("rejects a JWT_ACCESS_SECRET shorter than 32 characters", () => {
      expect(errorMessage({ ...VALID_ENV, JWT_ACCESS_SECRET: "a".repeat(31) })).toContain(
        "JWT_ACCESS_SECRET",
      );
    });

    it("accepts a JWT_ACCESS_SECRET of exactly 32 characters (positive control)", () => {
      const env = parseEnv({ ...VALID_ENV, JWT_ACCESS_SECRET: "a".repeat(32) });

      expect(env.JWT_ACCESS_SECRET).toHaveLength(32);
    });

    it("defaults token lifetimes to 15 minutes and 7 days", () => {
      const env = parseEnv(VALID_ENV);

      expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
      expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    });

    it.each([
      ["ACCESS_TOKEN_TTL_MINUTES", "0"],
      ["ACCESS_TOKEN_TTL_MINUTES", "61"],
      ["REFRESH_TOKEN_TTL_DAYS", "0"],
      ["REFRESH_TOKEN_TTL_DAYS", "91"],
    ])("rejects %s=%s", (name, value) => {
      expect(errorMessage({ ...VALID_ENV, [name]: value })).toContain(name);
    });
  });
});
