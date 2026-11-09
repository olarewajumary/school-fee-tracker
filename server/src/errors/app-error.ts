export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = "Bad request", details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const validationError = (message = "Validation failed", details?: unknown) =>
  new AppError(400, "VALIDATION_ERROR", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "You do not have permission to do that") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Resource not found") => new AppError(404, "NOT_FOUND", message);

export const conflict = (message = "Resource already exists", details?: unknown) =>
  new AppError(409, "CONFLICT", message, details);
