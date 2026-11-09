import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { config } from "../config";
import { AppError } from "../errors/app-error";
import type { ErrorCode } from "../errors/app-error";

type NormalizedError = {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
};

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return {
        status: 409,
        code: "CONFLICT",
        message: "A record with these values already exists",
        details: { fields: error.meta?.target },
      };
    }

    if (error.code === "P2025") {
      return { status: 404, code: "NOT_FOUND", message: "Record not found" };
    }
  }

  // express.json() throws this when the request body is not valid JSON.
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    return { status: 400, code: "BAD_REQUEST", message: "Request body is not valid JSON" };
  }

  return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" };
}

// Express only treats a function as an error handler if it has exactly 4 parameters,
// so `_next` must stay even though we don't use it.
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);

  if (normalized.status >= 500) {
    req.log.error({ err: error }, "Unhandled error");
  }

  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      requestId: String(req.id),
      ...(config.NODE_ENV === "development" && normalized.status >= 500 && error instanceof Error
        ? { stack: error.stack }
        : {}),
    },
  });
};
