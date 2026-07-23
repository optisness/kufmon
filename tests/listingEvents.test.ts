import { describe, expect, it } from "vitest";
import { formatEventSummary } from "../src/listingEvents.js";

describe("listingEvents", () => {
  it("renders extended new-event details in history summaries", () => {
    const summary = formatEventSummary("NEW", {
      snapshot: {
        title: "Test listing",
        price: 12345,
        description: "Short description",
        fullDescription: "Full description with all details",
        address: "Grodno, Lenina 1",
        imageUrl: "https://rms.kufar.by/v1/gallery/adim1/cover.jpg",
        imageUrls: [
          "https://rms.kufar.by/v1/gallery/adim1/photo-1.jpg",
          "https://rms.kufar.by/v1/gallery/adim1/photo-2.jpg",
        ],
        rooms: 2,
        category: "1010",
        sellerType: "private",
        url: "https://re.kufar.by/vi/1",
        location: null,
      },
    });

    expect(summary).toContain("Создано: Test listing");
    expect(summary).toContain("Цена: $12345");
    expect(summary).toContain("Комнаты: 2");
    expect(summary).toContain("Адрес: Grodno, Lenina 1");
    expect(summary).toContain("Полное описание: Full description with all details");
    expect(summary).toContain("Все фото: https://rms.kufar.by/v1/gallery/adim1/photo-1.jpg, https://rms.kufar.by/v1/gallery/adim1/photo-2.jpg");
  });
});
