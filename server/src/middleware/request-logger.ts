import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { logger } from "../lib/logger";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,100}$/;

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id =
      typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    res.setHeader("X-Request-Id", id);
    return id;
  },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  autoLogging: {
    ignore: (req) => req.url === "/api/health" || req.url === "/api/health/ready",
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
