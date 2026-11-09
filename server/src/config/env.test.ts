import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const VALID_DATABASE_URL = "postgresql://user:pass@localhost:5432/school";

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
  it("applies sensible defaults when only DATABASE_URL is set", () => {
    const env = parseEnv({ DATABASE_URL: VALID_DATABASE_URL });

    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      CLIENT_URL: "http://localhost:5173",
      LOG_LEVEL: "info",
    });
  });

  it("converts PORT from a string to a number", () => {
    const env = parseEnv({ DATABASE_URL: VALID_DATABASE_URL, PORT: "8080" });

    expect(env.PORT).toBe(8080);
  });

  it("accepts the postgres:// scheme as well as postgresql://", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/school" });

    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(errorMessage({})).toContain("DATABASE_URL");
  });

  it("rejects a DATABASE_URL that is not PostgreSQL", () => {
    expect(errorMessage({ DATABASE_URL: "mysql://user:pass@localhost/school" })).toContain(
      "PostgreSQL",
    );
  });

  it.each(["abc", "0", "70000"])("rejects PORT=%s", (port) => {
    expect(errorMessage({ DATABASE_URL: VALID_DATABASE_URL, PORT: port })).toContain("PORT");
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(errorMessage({ DATABASE_URL: VALID_DATABASE_URL, NODE_ENV: "staging" })).toContain(
      "NODE_ENV",
    );
  });

  it("rejects a CLIENT_URL that is not a URL", () => {
    expect(errorMessage({ DATABASE_URL: VALID_DATABASE_URL, CLIENT_URL: "not-a-url" })).toContain(
      "CLIENT_URL",
    );
  });

  it("reports every problem at once instead of only the first", () => {
    const message = errorMessage({ PORT: "abc" });

    expect(message).toContain("PORT");
    expect(message).toContain("DATABASE_URL");
  });
});
