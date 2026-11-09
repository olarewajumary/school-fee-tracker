import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { requestLogger } from "../middleware/request-logger";
import { createHealthRouter } from "./health";

// The router is mounted exactly as in app.ts. requestLogger is needed because the
// readiness handler uses req.log, which pino-http provides.
function buildTestApp(dbCheck: () => Promise<void>) {
  const app = express();

  app.use(requestLogger);
  app.use("/api/health", createHealthRouter(dbCheck));

  return app;
}

describe("GET /api/health (liveness)", () => {
  it("returns ok", async () => {
    const dbCheck = vi.fn().mockResolvedValue(undefined);

    const response = await request(buildTestApp(dbCheck)).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("school-fee-tracker-api");
  });

  it("never touches the database", async () => {
    const dbCheck = vi.fn().mockRejectedValue(new Error("database is down"));

    const response = await request(buildTestApp(dbCheck)).get("/api/health");

    expect(response.status).toBe(200);
    expect(dbCheck).not.toHaveBeenCalled();
  });
});

describe("GET /api/health/ready (readiness)", () => {
  it("returns 200 and database 'up' when the check passes (positive control)", async () => {
    const dbCheck = vi.fn().mockResolvedValue(undefined);

    const response = await request(buildTestApp(dbCheck)).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.checks.database).toBe("up");
    expect(dbCheck).toHaveBeenCalledTimes(1);
  });

  it("returns 503 and database 'down' when the check fails", async () => {
    const dbCheck = vi.fn().mockRejectedValue(new Error("connection refused"));

    const response = await request(buildTestApp(dbCheck)).get("/api/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("unavailable");
    expect(response.body.checks.database).toBe("down");
  });

  it("does not leak the underlying error message to the client", async () => {
    const dbCheck = vi
      .fn()
      .mockRejectedValue(new Error("postgresql://user:hunter2@secret-host/neondb unreachable"));

    const response = await request(buildTestApp(dbCheck)).get("/api/health/ready");

    const raw = JSON.stringify(response.body);
    expect(response.status).toBe(503);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("secret-host");
  });
});

describe("readiness on the real app", () => {
  it("reports the real Neon database as up", async () => {
    const response = await request(createApp()).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.checks.database).toBe("up");
  });
});
