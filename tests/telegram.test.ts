import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";

const prismaMock = {
  telegramDeliveryLog: {
    create: vi.fn(),
  },
};

vi.doMock("../src/db.js", () => ({ prisma: prismaMock }));

let sendTrackedTelegram: typeof import("../src/telegram.js").sendTrackedTelegram;

beforeAll(async () => {
  const module = await import("../src/telegram.js");
  sendTrackedTelegram = module.sendTrackedTelegram;
});

describe("telegram delivery tracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_TOKEN;
    delete process.env.ADMIN_TELEGRAM_CHAT_ID;
  });

  it("records successful telegram deliveries", async () => {
    process.env.TELEGRAM_TOKEN = "token";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendTrackedTelegram(
      "Hello",
      "123",
      {
        userId: "user-1",
        userLabel: "Anna",
        purpose: "test_message",
      },
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.telegramDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          userLabel: "Anna",
          chatId: "123",
          purpose: "test_message",
          success: true,
          statusCode: 200,
          error: null,
        }),
      }),
    );
  });

  it("logs failed deliveries and notifies the admin", async () => {
    process.env.TELEGRAM_TOKEN = "token";
    process.env.ADMIN_TELEGRAM_CHAT_ID = "999";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ description: "Forbidden: bot was blocked by the user" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendTrackedTelegram(
      "Hello",
      "123",
      {
        userId: "user-1",
        userLabel: "Anna",
        purpose: "subscription_backfill",
      },
    );

    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.telegramDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          userLabel: "Anna",
          chatId: "123",
          purpose: "subscription_backfill",
          success: false,
          statusCode: 403,
        }),
      }),
    );

    const adminRequest = fetchMock.mock.calls[1];
    expect(String(adminRequest?.[0] ?? "")).toContain("api.telegram.org");
    const adminPayload = JSON.parse(String(adminRequest?.[1]?.body ?? "{}"));
    expect(adminPayload.chat_id).toBe("999");
    expect(adminPayload.text).toContain("User: Anna");
    expect(adminPayload.text).toContain("Purpose: subscription_backfill");
    expect(adminPayload.text).toContain("Forbidden: bot was blocked by the user");
  });
});
