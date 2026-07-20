import cron from "node-cron";
import { saveKufarAds } from "./kufar.js";

export function startCron() {
  console.log("⏱ Cron started (every 5 min)");

  cron.schedule("*/5 * * * *", async () => {
    console.log("⏳ Running sync...");

    try {
      const result = await saveKufarAds();
      console.log("✅ Sync done:", result);
    } catch (err) {
      console.error("❌ Cron error:", err);
    }
  });
}