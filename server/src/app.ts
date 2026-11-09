import express from "express";
import { config } from "./config";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { requestLogger } from "./middleware/request-logger";
import { corsMiddleware, securityHeaders } from "./middleware/security";
import { createHealthRouter } from "./routes/health";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(securityHeaders());
  app.use(corsMiddleware([config.CLIENT_URL]));
  app.use(express.json());

  app.use("/api/health", createHealthRouter());

  // These two MUST stay last: unmatched routes fall into the 404 handler,
  // and any error thrown anywhere above lands in the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
