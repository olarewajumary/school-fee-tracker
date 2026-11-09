import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requestLogger } from "./request-logger";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A tiny standalone app: only the middleware under test plus one route that echoes req.id.
function buildTestApp() {
  const app = express();

  app.use(requestLogger);
  app.get("/ping", (req, res) => {
    res.json({ id: req.id });
  });

  return app;
}

describe("requestLogger", () => {
  it("generates a UUID request id when none is supplied", async () => {
    const response = await request(buildTestApp()).get("/ping");

    expect(response.status).toBe(200);
    expect(response.body.id).toMatch(UUID_PATTERN);
    expect(response.headers["x-request-id"]).toBe(response.body.id);
  });

  it("reuses a supplied request id when it is safe", async () => {
    const response = await request(buildTestApp())
      .get("/ping")
      .set("X-Request-Id", "trace-abc-123");

    expect(response.body.id).toBe("trace-abc-123");
    expect(response.headers["x-request-id"]).toBe("trace-abc-123");
  });

  it.each([
    ["is 101 characters long", "x".repeat(101)],
    ["contains spaces", "has spaces here"],
  ])("replaces a supplied request id that %s", async (_label, unsafeId) => {
    const response = await request(buildTestApp()).get("/ping").set("X-Request-Id", unsafeId);

    expect(response.body.id).not.toBe(unsafeId);
    expect(response.body.id).toMatch(UUID_PATTERN);
    expect(response.headers["x-request-id"]).toBe(response.body.id);
  });

  it("gives different requests different ids", async () => {
    const app = buildTestApp();

    const first = await request(app).get("/ping");
    const second = await request(app).get("/ping");

    expect(first.body.id).not.toBe(second.body.id);
  });
});
