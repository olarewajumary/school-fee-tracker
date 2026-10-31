import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("GET /api/health", () => {
  const app = createApp();

  it("responds with 200 and a JSON content type", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("reports the service as healthy", async () => {
    const res = await request(app).get("/api/health");

    expect(res.body).toMatchObject({ status: "ok", service: "school-fee-tracker-api" });
  });

  it("includes a valid ISO-8601 timestamp", async () => {
    const res = await request(app).get("/api/health");

    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it("does not advertise the framework in response headers", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
