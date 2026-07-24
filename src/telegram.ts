import { createLogger } from "./logger.js";
import { prisma } from "./db.js";

const logger = createLogger({ module: "telegram" });

type TelegramSendOptions = {
  parseMode?: "HTML";
};

type TelegramDeliveryContext = {
  userId?: string | null;
  userLabel?: string | null;
  purpose?: string;
  notifyAdminOnFailure?: boolean;
};

async function sendTelegramRaw(
  message: string,
  chatId: string,
  options?: TelegramSendOptions,
) {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    logger.warn("Telegram token is not configured; skipping send");
    return { ok: false, statusCode: null as number | null, error: "Telegram token is not configured" };
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
        ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
      }),
    });

    let error: string | null = null;
    if (!res.ok) {
      try {
        const body = await res.json();
        error = typeof body?.description === "string" ? body.description : JSON.stringify(body);
      } catch {
        try {
          error = await res.text();
        } catch {
          error = `HTTP ${res.status}`;
        }
      }
    }

    return { ok: res.ok, statusCode: res.status, error };
  } catch (err) {
    logger.error({ err }, "Telegram send error");
    return { ok: false, statusCode: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function recordTelegramDelivery(params: {
  userId?: string | null;
  userLabel?: string | null;
  chatId: string;
  purpose: string;
  result: Awaited<ReturnType<typeof sendTelegramRaw>>;
}) {
  try {
    await prisma.telegramDeliveryLog.create({
      data: {
        userId: params.userId ?? null,
        userLabel: params.userLabel ?? null,
        chatId: params.chatId,
        purpose: params.purpose,
        success: params.result.ok,
        statusCode: params.result.statusCode,
        error: params.result.error,
      },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to persist telegram delivery log");
  }
}

async function notifyAdminAboutFailedDelivery(params: {
  userId?: string | null;
  userLabel?: string | null;
  chatId: string;
  purpose: string;
  result: Awaited<ReturnType<typeof sendTelegramRaw>>;
}) {
  const adminChatId = String(process.env.ADMIN_TELEGRAM_CHAT_ID ?? "").trim();
  if (!adminChatId) return;

  const userLabel = params.userLabel?.trim() || params.userId?.trim() || params.chatId;
  const details = [
    "⚠️ Telegram delivery failed",
    `User: ${userLabel}`,
    `Chat ID: ${params.chatId}`,
    `Purpose: ${params.purpose}`,
    params.result.statusCode != null ? `Status: ${params.result.statusCode}` : null,
    params.result.error ? `Error: ${params.result.error}` : null,
  ].filter(Boolean).join("\n");

  const adminResult = await sendTelegramRaw(details, adminChatId);
  if (!adminResult.ok) {
    logger.warn({ adminResult }, "Failed to notify admin about telegram delivery failure");
  }
}

export async function sendTelegram(
  message: string,
  chatId: string,
  options?: TelegramSendOptions,
) {
  const result = await sendTelegramRaw(message, chatId, options);
  return result.ok;
}

export async function sendTrackedTelegram(
  message: string,
  chatId: string,
  context: TelegramDeliveryContext,
  options?: TelegramSendOptions,
) {
  const result = await sendTelegramRaw(message, chatId, options);
  await recordTelegramDelivery({
    userId: context.userId,
    userLabel: context.userLabel,
    chatId,
    purpose: context.purpose ?? "user_notification",
    result,
  });

  if (!result.ok && context.notifyAdminOnFailure !== false) {
    await notifyAdminAboutFailedDelivery({
      userId: context.userId,
      userLabel: context.userLabel,
      chatId,
      purpose: context.purpose ?? "user_notification",
      result,
    });
  }

  return result.ok;
}
