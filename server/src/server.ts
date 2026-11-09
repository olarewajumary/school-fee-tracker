import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./lib/logger";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "API listening");
});
