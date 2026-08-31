import cron from "node-cron";
import { saveKufarAds } from "./kufar.js";
import { createLogger } from "./logger.js";
import { incMetric } from "./metrics.js";
import { sendBillingExpiryReminders } from "./billingReminders.js";

const logger = createLogger({ module: "cron" });

export function startCron() {
  logger.info({ syncInterval: "15m", remindersAt: "10:00 Europe/Minsk" }, "Cron started");

  cron.schedule("*/15 * * * *", async () => {
    logger.info("Running sync...");
    incMetric("syncRuns");

    try {
      const result = await saveKufarAds();
      logger.info({ synced: result }, "Sync done");
    } catch (err) {
      logger.error({ err }, "Cron error");
    }
  });

  cron.schedule("0 10 * * *", async () => {
    logger.info("Running billing reminders...");

    try {
      await sendBillingExpiryReminders();
    } catch (err) {
      logger.error({ err }, "Billing reminder cron error");
    }
  }, {
    timezone: "Europe/Minsk",
  });
}
