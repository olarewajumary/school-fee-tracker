import { Router } from "express";
import { prisma } from "../db/client";

export type DatabaseCheck = () => Promise<void>;

// Neon's free tier can take a few seconds to wake up, so the limit is generous.
// Without any limit, a hung connection would make the readiness probe hang too.
const DB_CHECK_TIMEOUT_MS = 10000;

export const checkDatabase: DatabaseCheck = async () => {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Database check timed out")), DB_CHECK_TIMEOUT_MS);
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

// The database check is a parameter so tests can simulate "database down"
// without touching the real database.
export function createHealthRouter(dbCheck: DatabaseCheck = checkDatabase) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "school-fee-tracker-api",
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (req, res) => {
    try {
      await dbCheck();

      res.json({
        status: "ready",
        checks: { database: "up" },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      req.log.error({ err: error }, "Readiness check failed");

      res.status(503).json({
        status: "unavailable",
        checks: { database: "down" },
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
