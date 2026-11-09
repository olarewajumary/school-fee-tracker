import { Prisma } from "@prisma/client";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { conflict, forbidden, notFound, unauthorized } from "../errors/app-error";
import { errorHandler } from "./error-handler";
import { notFoundHandler } from "./not-found";
import { requestLogger } from "./request-logger";

// A small app with routes that each throw a different kind of error.
// The real pipeline order is reproduced: logger -> json -> routes -> 404 -> error handler.
function buildTestApp() {
  const app = express();

  app.use(requestLogger);
  app.use(express.json());

  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/app-error", () => {
    throw notFound("Student not found");
  });

  app.get("/conflict", () => {
    throw conflict("Email already registered", { field: "email" });
  });

  app.get("/unauthorized", () => {
    throw unauthorized();
  });

  app.get("/forbidden", () => {
    throw forbidden();
  });

  app.get("/zod", () => {
    z.object({ email: z.email(), age: z.number() }).parse({ email: "nope", age: "x" });
  });

  app.get("/prisma-unique", () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email"] },
    });
  });

  app.get("/prisma-missing", () => {
    throw new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "test",
    });
  });

  app.get("/async-error", async () => {
    await Promise.resolve();
    throw notFound("Thrown from an async route");
  });

  app.get("/boom", () => {
    throw new Error("secret database password is hunter2");
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

describe("error handling", () => {
  it("does not interfere with a normal successful route (positive control)", async () => {
    const response = await request(buildTestApp()).get("/ok");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns the standard error shape for an AppError", async () => {
    const response = await request(buildTestApp()).get("/app-error");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Student not found",
    });
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it.each([
    ["/conflict", 409, "CONFLICT"],
    ["/unauthorized", 401, "UNAUTHORIZED"],
    ["/forbidden", 403, "FORBIDDEN"],
  ])("maps %s to status %i and code %s", async (path, status, code) => {
    const response = await request(buildTestApp()).get(path);

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
  });

  it("includes details from an AppError when provided", async () => {
    const response = await request(buildTestApp()).get("/conflict");

    expect(response.body.error.details).toEqual({ field: "email" });
  });

  it("maps a Zod error to 400 with field-level details", async () => {
    const response = await request(buildTestApp()).get("/zod");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "age"]));
  });

  it("maps Prisma P2002 (unique constraint) to 409", async () => {
    const response = await request(buildTestApp()).get("/prisma-unique");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(response.body.error.details).toEqual({ fields: ["email"] });
  });

  it("maps Prisma P2025 (record not found) to 404", async () => {
    const response = await request(buildTestApp()).get("/prisma-missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("catches errors thrown inside async routes", async () => {
    const response = await request(buildTestApp()).get("/async-error");

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Thrown from an async route");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const response = await request(buildTestApp()).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.message).toBe("Route GET /does-not-exist not found");
  });

  it("returns 400 for a request body that is not valid JSON", async () => {
    const response = await request(buildTestApp())
      .post("/ok")
      .set("Content-Type", "application/json")
      .send("{bad json");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.body.error.message).toBe("Request body is not valid JSON");
  });

  it("hides internal details for unexpected errors (500) and never leaks a stack trace", async () => {
    const response = await request(buildTestApp()).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.error.message).toBe("Internal server error");

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("stack");
  });
});
