import { describe, it, expect } from "vitest";
import { buildTelegramListingUrl, formatTelegramBatchMessage } from "../src/telegramMessage.js";

describe("telegramMessage", () => {
  it("builds a canonical Kufar url from a bare listing url", () => {
    expect(
      buildTelegramListingUrl({
        url: "https://re.kufar.by/vi/1059448809",
        category: "1010",
      }),
    ).toBe("https://re.kufar.by/vi/grodno/obmen/kvartiru/1059448809");
  });

  it("keeps an already canonical Kufar url unchanged", () => {
    expect(
      buildTelegramListingUrl({
        url: "https://re.kufar.by/vi/grodno/obmen/kvartiru/1059448809",
        category: "1010",
      }),
    ).toBe("https://re.kufar.by/vi/grodno/obmen/kvartiru/1059448809");
  });

  it("falls back to a generic path for unknown categories", () => {
    expect(
      buildTelegramListingUrl({
        url: "https://re.kufar.by/vi/1059448809",
        category: "9999",
      }),
    ).toBe("https://re.kufar.by/vi/grodno/obmen/listing/1059448809");
  });

  it("formats grouped telegram messages with category styling and change summary", () => {
    const message = formatTelegramBatchMessage([
      {
        eventType: "NEW",
        category: "1010",
        title: "Apartment listing",
        rooms: 2,
        price: 167770.8,
        url: "https://re.kufar.by/vi/1059448809",
      },
      {
        eventType: "CHANGED",
        category: "1050",
        title: "Office space",
        rooms: null,
        price: 90000,
        url: "https://re.kufar.by/vi/1059448810",
        changes: [
          { field: "price", old: 95000, new: 90000 },
          { field: "description", old: null, new: "Now with parking" },
          { field: "imageUrl", old: null, new: "https://rms.kufar.by/v1/gallery/a.jpg" },
        ],
      },
      {
        eventType: "REMOVED",
        category: "1080",
        title: "Plot listing",
        rooms: null,
        price: 50000,
        url: "https://re.kufar.by/vi/1059448811",
      },
    ]);

    expect(message).toContain("🆕 Новые");
    expect(message).toContain("♻️ Измененные");
    expect(message).toContain("🗑 Удаленные");
    expect(message).toContain("🏢 🔵 Квартира");
    expect(message).toContain("🏭 🟠 Коммерческая");
    expect(message).toContain("🌾 🟤 Участок");
    expect(message).toContain("Apartment listing");
    expect(message).toContain("Комнат: 2к");
    expect(message).toContain("Цена: 167770.8");
    expect(message).toContain("Изменено: цена 95000 → 90000, описание добавлено, фото добавлено");
    expect(message).toContain("https://re.kufar.by/vi/grodno/obmen/kvartiru/1059448809");
  });
});
