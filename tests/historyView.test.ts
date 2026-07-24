import { describe, expect, it } from "vitest";
import { renderHistoryPageHtml, renderHistorySummaryHtml } from "../src/historyView.js";

describe("historyView", () => {
  it("renders photo thumbnails and the lightbox gallery controls", () => {
    const summary = renderHistorySummaryHtml(
      "Создано: Test listing\nВсе фото: https://rms.kufar.by/v1/gallery/adim1/photo-1.jpg, https://rms.kufar.by/v1/gallery/adim1/photo-2.jpg",
    );

    expect(summary).toContain("<strong>Создано:</strong>");
    expect(summary).toContain('data-history-gallery=');
    expect(summary).toContain('data-history-gallery-index="0"');
    expect(summary).toContain('data-history-gallery-index="1"');
    expect(summary).toContain('img src="https://rms.kufar.by/v1/gallery/adim1/photo-1.jpg"');
    expect(summary).toContain('img src="https://rms.kufar.by/v1/gallery/adim1/photo-2.jpg"');
    expect(summary).toContain("Все фото");

    const pageHtml = renderHistoryPageHtml([
      {
        eventType: "NEW",
        createdAt: "2026-07-24T00:00:00.000Z",
        changesJson: {
          snapshot: {
            title: "Test listing",
            price: 12345,
            rooms: 2,
            address: "Grodno, Lenina 1",
            fullDescription: "Full description",
            imageUrls: [
              "https://rms.kufar.by/v1/gallery/adim1/photo-1.jpg",
              "https://rms.kufar.by/v1/gallery/adim1/photo-2.jpg",
            ],
            url: "https://re.kufar.by/vi/1",
            description: "Short description",
            category: "1010",
            sellerType: "private",
            location: null,
          },
        },
      },
    ]);

    expect(pageHtml).toContain('id="history-lightbox"');
    expect(pageHtml).toContain('history-lightbox-prev');
    expect(pageHtml).toContain('history-lightbox-next');
    expect(pageHtml).toContain("ArrowLeft");
    expect(pageHtml).toContain("ArrowRight");
    expect(pageHtml).toContain("24-07 03:00");
  });
});
