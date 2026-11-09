import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { validationError } from "../errors/app-error";

type Schemas = {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
};

type Source = keyof Schemas;

const SOURCES: Source[] = ["params", "query", "body"];

type Problem = { path: string; message: string };

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const problems: Problem[] = [];

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);

      if (!result.success) {
        for (const issue of result.error.issues) {
          problems.push({
            path: [source, ...issue.path.map(String)].join("."),
            message: issue.message,
          });
        }
        continue;
      }

      // Replace the raw input with the parsed result, so later code gets clean,
      // correctly typed values (trimmed strings, numbers instead of "5", defaults applied).
      // defineProperty is needed because in Express 5 `req.query` is read-only
      // (it is a getter), so a plain `req.query = ...` would throw.
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (problems.length > 0) {
      next(validationError("Validation failed", problems));
      return;
    }

    next();
  };
}
