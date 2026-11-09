import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { config } from "../config";
import { errorHandler } from "./error-handler";
import { notFoundHandler } from "./not-found";
import { requestLogger } from "./request-logger";
import { corsMiddleware, securityHeaders } from "./security";

const ALLOWED = "http://localhost:5173";
const BLOCKED = "http://evil.example";

// Standalone app with the real pipeline order, but our own allow-list.
// The trailing slash on purpose: the middleware must normalize it.
function buildTestApp() {
  const app = express();

  app.use(requestLogger);
  app.use(securityHeaders());
  app.use(corsMiddleware([`${ALLOWED}/`]));
  app.use(express.json());

  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

describe("corsMiddleware", () => {
  it("allows an origin on the allow-list and enables credentials (positive control)", async () => {
    const response = await request(buildTestApp()).get("/ping").set("Origin", ALLOWED);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("matches the allow-list even when the configured URL has a trailing slash", async () => {
    // buildTestApp() passes "http://localhost:5173/" (with slash) to corsMiddleware.
    const response = await request(buildTestApp()).get("/ping").set("Origin", ALLOWED);

    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("sends no CORS headers to an origin that is not on the allow-list", async () => {
    const response = await request(buildTestApp()).get("/ping").set("Origin", BLOCKED);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("serves requests with no Origin header (curl, server-to-server)", async () => {
    const response = await request(buildTestApp()).get("/ping");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a preflight from an allowed origin, even on a route that does not exist", async () => {
    const response = await request(buildTestApp())
      .options("/api/students")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("gives a preflight from a blocked origin no permission headers", async () => {
    const response = await request(buildTestApp())
      .options("/api/students")
      .set("Origin", BLOCKED)
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("exposes X-Request-Id so the frontend can read it", async () => {
    const response = await request(buildTestApp()).get("/ping").set("Origin", ALLOWED);

    expect(response.headers["access-control-expose-headers"]).toContain("X-Request-Id");
  });
});

describe("security headers on the real app", () => {
  it("sets helmet headers, hides X-Powered-By, and applies CORS for CLIENT_URL", async () => {
    const clientOrigin = new URL(config.CLIENT_URL).origin;

    const response = await request(createApp()).get("/api/health").set("Origin", clientOrigin);

    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe(clientOrigin);
  });

  it("does not grant CORS to a random origin on the real app", async () => {
    const response = await request(createApp()).get("/api/health").set("Origin", BLOCKED);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
