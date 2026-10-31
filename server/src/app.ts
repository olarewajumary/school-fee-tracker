import express from "express";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "school-fee-tracker-api",
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
