import { createLogger } from "./logger.js";

const logger = createLogger({ module: "telegram" });

export async function sendTelegram(
  message: string,
  chatId: string
) {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    logger.warn("Telegram token is not configured; skipping send");
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    return res.ok;
  } catch (err) {
    logger.error({ err }, "Telegram send error");
    return false;
  }
}