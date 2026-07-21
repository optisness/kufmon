import cron from "node-cron";
import { saveKufarAds } from "./kufar.js";
import { createLogger } from "./logger.js";
import { incMetric } from "./metrics.js";

const logger = createLogger({ module: "cron" });

export function startCron() {
  logger.info({ interval: "5m" }, "Cron started");

  cron.schedule("*/5 * * * *", async () => {
    logger.info("Running sync...");
    incMetric("syncRuns");

    try {
      const result = await saveKufarAds();
      logger.info({ synced: result }, "Sync done");
    } catch (err) {
      logger.error({ err }, "Cron error");
    }
  });
}