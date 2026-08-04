import { prisma } from "./db.js";
import { createLogger } from "./logger.js";
import { sendTrackedTelegram } from "./telegram.js";

const logger = createLogger({ module: "billing-reminders" });

export type BillingReminderKind = "3_working_days" | "1_day";

const MINSK_TIME_ZONE = "Europe/Minsk";
const REMINDER_PURPOSE_PREFIX = "billing_expiry_reminder";

function getMinskDateParts(reference = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MINSK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return { year, month, day };
}

export function getMinskDateString(reference = new Date()) {
  const { year, month, day } = getMinskDateParts(reference);
  return `${year}-${month}-${day}`;
}

function parsePlainDate(dateString: string) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function formatPlainDate(date: Date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftPlainDate(dateString: string, days: number) {
  const date = parsePlainDate(dateString);
  if (!date) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return formatPlainDate(date);
}

function subtractWorkingDays(dateString: string, amount: number) {
  let remaining = amount;
  let cursor = dateString;

  while (remaining > 0) {
    const shifted = shiftPlainDate(cursor, -1);
    if (!shifted) return null;

    cursor = shifted;
    const weekday = parsePlainDate(cursor)?.getUTCDay() ?? 0;
    if (weekday !== 0 && weekday !== 6) {
      remaining -= 1;
    }
  }

  return cursor;
}

function formatMinskDateLabel(dateString: string) {
  const date = parsePlainDate(dateString);
  if (!date) return dateString;

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MINSK_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function buildReminderPurpose(kind: BillingReminderKind, expiryDate: string) {
  return `${REMINDER_PURPOSE_PREFIX}:${kind}:${expiryDate}`;
}

export function getBillingReminderTargetDate(expiryAt: Date | string, kind: BillingReminderKind) {
  const expiryDate = getMinskDateString(new Date(expiryAt));
  return kind === "1_day"
    ? shiftPlainDate(expiryDate, -1)
    : subtractWorkingDays(expiryDate, 3);
}

export function getBillingReminderKinds(expiryAt: Date | string, reference = new Date()) {
  const today = getMinskDateString(reference);
  const kinds: BillingReminderKind[] = [];

  if (getBillingReminderTargetDate(expiryAt, "3_working_days") === today) {
    kinds.push("3_working_days");
  }

  if (getBillingReminderTargetDate(expiryAt, "1_day") === today) {
    kinds.push("1_day");
  }

  return kinds;
}

function buildReminderMessage(options: {
  kind: BillingReminderKind;
  userLabel: string;
  expiryAt: Date | string;
  isAdmin?: boolean;
}) {
  const dateLabel = formatMinskDateLabel(getMinskDateString(new Date(options.expiryAt)));

  if (options.kind === "1_day") {
    if (options.isAdmin) {
      return [
        `Контроль: подписка <b>RealtMonitor</b> пользователя <b>${options.userLabel}</b> заканчивается завтра, <b>${dateLabel}</b>.`,
        "Клиенту отправлено напоминание о продлении.",
      ].join("\n");
    }

    return [
      `Ваша подписка <b>RealtMonitor</b> заканчивается завтра, <b>${dateLabel}</b>.`,
      "Пожалуйста, оплатите продление, чтобы уведомления продолжили приходить без перерыва.",
    ].join("\n");
  }

  return [
    `Напоминаем: подписка <b>RealtMonitor</b> заканчивается через 3 рабочих дня, <b>${dateLabel}</b>.`,
    "Чтобы мониторинг не прерывался, продлите подписку заранее.",
  ].join("\n");
}

async function hasReminderAlreadyBeenSent(userId: string, purpose: string) {
  const existing = await prisma.telegramDeliveryLog.findFirst({
    where: {
      userId,
      purpose,
    },
    select: {
      id: true,
    },
  });

  return Boolean(existing);
}

export async function sendBillingExpiryReminders(reference = new Date()) {
  const users = await prisma.user.findMany({
    where: {
      planExpiresAt: {
        not: null,
      },
    },
    select: {
      id: true,
      name: true,
      telegramChatId: true,
      planExpiresAt: true,
    },
  });

  let matched = 0;
  let sent = 0;
  let adminCopies = 0;

  for (const user of users) {
    if (!user.planExpiresAt) {
      continue;
    }

    const userLabel = user.name?.trim() || user.telegramChatId;
    const expiryDate = getMinskDateString(user.planExpiresAt);
    const dueKinds = getBillingReminderKinds(user.planExpiresAt, reference);

    if (dueKinds.length === 0) {
      continue;
    }

    matched += 1;

    for (const kind of dueKinds) {
      const purpose = buildReminderPurpose(kind, expiryDate);

      if (await hasReminderAlreadyBeenSent(user.id, purpose)) {
        continue;
      }

      const ok = await sendTrackedTelegram(
        buildReminderMessage({
          kind,
          userLabel,
          expiryAt: user.planExpiresAt,
        }),
        user.telegramChatId,
        {
          userId: user.id,
          userLabel,
          purpose,
        },
        { parseMode: "HTML" },
      );

      if (ok) {
        sent += 1;
      }

      if (kind === "1_day") {
        const adminChatId = String(process.env.ADMIN_TELEGRAM_CHAT_ID ?? "").trim();
        if (adminChatId) {
          const adminPurpose = `${purpose}:admin`;
          if (!(await hasReminderAlreadyBeenSent(user.id, adminPurpose))) {
            await sendTrackedTelegram(
              buildReminderMessage({
                kind,
                userLabel,
                expiryAt: user.planExpiresAt,
                isAdmin: true,
              }),
              adminChatId,
              {
                userId: user.id,
                userLabel,
                purpose: adminPurpose,
                notifyAdminOnFailure: false,
              },
              { parseMode: "HTML" },
            );
            adminCopies += 1;
          }
        }
      }
    }
  }

  logger.info({
    scanned: users.length,
    matched,
    sent,
    adminCopies,
  }, "Billing expiry reminders finished");

  return {
    scanned: users.length,
    matched,
    sent,
    adminCopies,
  };
}
