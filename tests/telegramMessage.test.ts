import { describe, it, expect } from "vitest";
import { buildTelegramListingUrl, formatTelegramBatchMessage, splitTelegramMessageChunks } from "../src/telegramMessage.js";

describe("telegramMessage", () => {
  it("builds a canonical Kufar url from a bare listing url", () => {
    expect(
      buildTelegramListingUrl({
        url: "https://re.kufar.by/vi/1059448809",
        category: "1010",
      }),
    ).toBe("https://re.kufar.by/vi/grodno/kupit/kvartiru/1059448809");
  });

  it("keeps an already canonical Kufar url unchanged", () => {
    expect(
      buildTelegramListingUrl({
        url: "https://re.kufar.by/vi/grodno/kupit/kvartiru/1059448809",
        category: "1010",
      }),
    ).toBe("https://re.kufar.by/vi/grodno/kupit/kvartiru/1059448809");
  });

  it("falls back to a generic path for unknown categories", () => {
    expect(
      buildTelegramListingUrl({
        url: "https://re.kufar.by/vi/1059448809",
        category: "9999",
      }),
    ).toBe("https://re.kufar.by/vi/grodno/kupit/listing/1059448809");
  });

  it("formats grouped telegram messages with bold titles and spaced dollar prices", () => {
    const message = formatTelegramBatchMessage([
      {
        eventType: "NEW",
        category: "1010",
        title: "Apartment listing",
        rooms: 2,
        price: 167770.8,
        url: "https://re.kufar.by/vi/1059448809",
        subscriptionName: "Minsk 2 rooms",
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

    expect(message).toContain("\u041d\u043e\u0432\u044b\u0435");
    expect(message).toContain("\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u043d\u044b\u0435");
    expect(message).toContain("\u0423\u0434\u0430\u043b\u0435\u043d\u043d\u044b\u0435");
    expect(message).toContain("Подписка: Minsk 2 rooms");
    expect(message).toContain("🏢 <b>Apartment listing</b>");
    expect(message).toContain("🏭 <b>Office space</b>");
    expect(message).toContain("🌾 <b>Plot listing</b>");
    expect(message).toContain("Цена: <b>167 770.8 $</b>");
    expect(message).toContain("Комнат: 2к");
    expect(message).toContain("Изменено: цена <b>95 000 $</b> → <b>90 000 $</b>, описание добавлено, фото добавлено");
    expect(message).toContain("https://re.kufar.by/vi/grodno/kupit/kvartiru/1059448809");
  });

  it("splits telegram html messages on block boundaries", () => {
    const text = [
      "Подписка: test",
      "",
      "🆕 Новые",
      "",
      "🏢 <b>First card</b>",
      "Цена: <b>44 000 $</b>",
      "Комнат: 2к",
      "Ссылка: <a href=\"https://re.kufar.by/vi/grodno/kupit/kvartiru/1\">Куфар</a>",
      "",
      "🏢 <b>Second card</b>",
      "Цена: <b>55 000 $</b>",
      "Комнат: 3к",
      "Ссылка: <a href=\"https://re.kufar.by/vi/grodno/kupit/kvartiru/2\">Куфар</a>",
    ].join("\n");

    const chunks = splitTelegramMessageChunks(text, 140);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toContain("<b>First card</b>");
    expect(chunks.join("\n\n")).toContain("<b>Second card</b>");
  });
});
