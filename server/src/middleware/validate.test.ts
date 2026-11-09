import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "./error-handler";
import { requestLogger } from "./request-logger";
import { validate } from "./validate";

const bodySchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1),
  age: z.number().int().min(0).default(18),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

const paramsSchema = z.object({
  id: z.uuid(),
});

// The routes echo back what they receive, so the tests can see exactly what the
// middleware handed to the route (parsed values, defaults, trimmed strings).
function buildTestApp() {
  const app = express();

  app.use(requestLogger);
  app.use(express.json());

  app.post("/students", validate({ body: bodySchema }), (req, res) => {
    res.json({ received: req.body });
  });

  app.get("/students", validate({ query: querySchema }), (req, res) => {
    res.json({ received: req.query, pageType: typeof req.query.page });
  });

  app.put("/students/:id", validate({ params: paramsSchema, body: bodySchema }), (req, res) => {
    res.json({ received: { params: req.params, body: req.body } });
  });

  app.use(errorHandler);

  return app;
}

describe("validate middleware", () => {
  it("passes valid input through to the route (positive control)", async () => {
    const response = await request(buildTestApp())
      .post("/students")
      .send({ email: "mary@example.com", name: "Mary", age: 30 });

    expect(response.status).toBe(200);
    expect(response.body.received).toEqual({ email: "mary@example.com", name: "Mary", age: 30 });
  });

  it("replaces the raw body with parsed data (trims strings, applies defaults)", async () => {
    const response = await request(buildTestApp())
      .post("/students")
      .send({ email: "mary@example.com", name: "  Mary  " });

    expect(response.status).toBe(200);
    expect(response.body.received.name).toBe("Mary");
    expect(response.body.received.age).toBe(18);
  });

  it("rejects an invalid body with 400 and field-level details", async () => {
    const response = await request(buildTestApp())
      .post("/students")
      .send({ email: "not-an-email", name: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["body.email", "body.name"]));
  });

  it("reports every problem at once, not just the first", async () => {
    const response = await request(buildTestApp()).post("/students").send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details.length).toBeGreaterThanOrEqual(2);
  });

  it("coerces query strings into real numbers (Express 5 read-only query works)", async () => {
    const response = await request(buildTestApp()).get("/students?page=3");

    expect(response.status).toBe(200);
    expect(response.body.received.page).toBe(3);
    expect(response.body.pageType).toBe("number");
  });

  it("applies query defaults when the parameter is missing", async () => {
    const response = await request(buildTestApp()).get("/students");

    expect(response.status).toBe(200);
    expect(response.body.received.page).toBe(1);
  });

  it("rejects an invalid query with a path prefixed by 'query'", async () => {
    const response = await request(buildTestApp()).get("/students?page=0");

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toBe("query.page");
  });

  it("rejects an invalid route param", async () => {
    const response = await request(buildTestApp())
      .put("/students/not-a-uuid")
      .send({ email: "mary@example.com", name: "Mary" });

    expect(response.status).toBe(400);

    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain("params.id");
  });

  it("collects problems across params and body in one response", async () => {
    const response = await request(buildTestApp())
      .put("/students/not-a-uuid")
      .send({ email: "bad", name: "Mary" });

    expect(response.status).toBe(400);

    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["params.id", "body.email"]));
  });

  it("does not run the route handler when validation fails", async () => {
    const response = await request(buildTestApp()).post("/students").send({ email: "bad" });

    expect(response.status).toBe(400);
    expect(response.body.received).toBeUndefined();
  });
});
