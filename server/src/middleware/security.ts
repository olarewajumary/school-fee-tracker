import cors from "cors";
import type { RequestHandler } from "express";
import helmet from "helmet";

export function securityHeaders(): RequestHandler {
  return helmet();
}

export function corsMiddleware(allowedOrigins: string[]): RequestHandler {
  // new URL(...).origin strips any trailing slash, so "http://localhost:5173/"
  // in an env file still matches the browser's "http://localhost:5173".
  const allowed = new Set(allowedOrigins.map((value) => new URL(value).origin));

  return cors({
    origin: (origin, callback) => {
      // Requests with no Origin header (curl, server-to-server, health checks) are not
      // browser cross-site requests, so CORS does not apply to them.
      if (!origin || allowed.has(origin)) {
        callback(null, true);
        return;
      }

      // Not allowed: we send no CORS headers, and the browser blocks the response.
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 600,
  });
}
