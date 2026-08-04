import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: {
    findMany: vi.fn(),
  },
  telegramDeliveryLog: {
    findFirst: vi.fn(),
  },
};

const sendTrackedTelegramMock = vi.fn();

vi.doMock("../src/db.js", () => ({ prisma: prismaMock }));
vi.doMock("../src/telegram.js", () => ({ sendTrackedTelegram: sendTrackedTelegramMock }));

let billingReminders: typeof import("../src/billingReminders.js");

beforeAll(async () => {
  billingReminders = await import("../src/billingReminders.js");
});

describe("billing reminder helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_TELEGRAM_CHAT_ID;
  });

  it("calculates reminder target dates in Minsk time", () => {
    const expiry = new Date("2026-08-10T12:00:00+03:00");

    expect(billingReminders.getBillingReminderTargetDate(expiry, "1_day")).toBe("2026-08-09");
    expect(billingReminders.getBillingReminderTargetDate(expiry, "3_working_days")).toBe("2026-08-05");
  });

  it("detects reminder kinds due on the target date", () => {
    const expiry = new Date("2026-08-10T12:00:00+03:00");
    const reference = new Date("2026-08-05T10:00:00+03:00");

    expect(billingReminders.getBillingReminderKinds(expiry, reference)).toEqual(["3_working_days"]);
  });
});

describe("billing reminder delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_TELEGRAM_CHAT_ID;
  });

  it("sends the client reminder for three working days and the control copy for one day", async () => {
    process.env.ADMIN_TELEGRAM_CHAT_ID = "999";

    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        name: "Anna",
        telegramChatId: "111",
        planExpiresAt: new Date("2026-08-10T09:00:00+03:00"),
      },
      {
        id: "user-2",
        name: "Ivan",
        telegramChatId: "222",
        planExpiresAt: new Date("2026-08-06T09:00:00+03:00"),
      },
    ]);
    prismaMock.telegramDeliveryLog.findFirst.mockResolvedValue(null);
    sendTrackedTelegramMock.mockResolvedValue(true);

    const result = await billingReminders.sendBillingExpiryReminders(new Date("2026-08-05T10:00:00+03:00"));

    expect(result).toEqual({
      scanned: 2,
      matched: 2,
      sent: 2,
      adminCopies: 1,
    });
    expect(sendTrackedTelegramMock).toHaveBeenCalledTimes(3);
    expect(sendTrackedTelegramMock.mock.calls[0]?.[0]).toContain("через 3 рабочих дня");
    expect(sendTrackedTelegramMock.mock.calls[0]?.[2]).toMatchObject({
      userId: "user-1",
      purpose: "billing_expiry_reminder:3_working_days:2026-08-10",
    });
    expect(sendTrackedTelegramMock.mock.calls[1]?.[0]).toContain("завтра");
    expect(sendTrackedTelegramMock.mock.calls[1]?.[2]).toMatchObject({
      userId: "user-2",
      purpose: "billing_expiry_reminder:1_day:2026-08-06",
    });
    expect(sendTrackedTelegramMock.mock.calls[2]?.[0]).toContain("Контроль");
    expect(sendTrackedTelegramMock.mock.calls[2]?.[2]).toMatchObject({
      userId: "user-2",
      purpose: "billing_expiry_reminder:1_day:2026-08-06:admin",
    });
  });

  it("skips reminders that were already logged", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        name: "Anna",
        telegramChatId: "111",
        planExpiresAt: new Date("2026-08-10T09:00:00+03:00"),
      },
    ]);
    prismaMock.telegramDeliveryLog.findFirst.mockResolvedValue({ id: "log-1" });

    const result = await billingReminders.sendBillingExpiryReminders(new Date("2026-08-05T10:00:00+03:00"));

    expect(result).toEqual({
      scanned: 1,
      matched: 1,
      sent: 0,
      adminCopies: 0,
    });
    expect(sendTrackedTelegramMock).not.toHaveBeenCalled();
  });
});
