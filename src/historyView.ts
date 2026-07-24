import { formatEventSummary } from "./listingEvents.js";
import { formatListingEventAt } from "./listingTable.js";

type HistoryEventView = {
  eventType: string;
  createdAt: string | Date;
  changesJson: any;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emphasizeHistoryLabel(escapedLine: string) {
  const labels = [
    "Создано:",
    "Адрес:",
    "Цена:",
    "Комнаты:",
    "Описание:",
    "Полное описание:",
  ];

  for (const label of labels) {
    if (escapedLine.startsWith(label)) {
      return escapedLine.replace(label, `<strong>${label}</strong>`);
    }
  }

  return escapedLine;
}

function renderHistoryPhotoGallery(urls: string[]) {
  if (urls.length === 0) return "";

  return [
    `<div class="history-photo-gallery" data-history-gallery="${escapeHtml(JSON.stringify(urls))}">`,
    `<div class="history-photo-gallery__label">Все фото</div>`,
    `<div class="history-photo-gallery__grid">`,
    urls
      .map(
        (url, index) =>
          `<button type="button" class="history-photo-thumb" data-history-gallery-index="${index}" aria-label="Открыть фото ${index + 1}">` +
          `<img src="${escapeHtml(url)}" alt="Фото объявления ${index + 1}" loading="lazy" />` +
          `</button>`,
      )
      .join(""),
    `</div>`,
    `</div>`,
  ].join("");
}

export function renderHistorySummaryHtml(summary: string) {
  const lines = String(summary ?? "").split(/\r?\n/);
  const parts: string[] = [];

  for (const line of lines) {
    const photoMatch = line.match(/^Все фото:\s*(.+)$/);

    if (photoMatch) {
      const urls = photoMatch[1]
        .split(/\s*,\s*/)
        .map((url) => url.trim())
        .filter(Boolean);

      if (urls.length > 0) {
        parts.push(renderHistoryPhotoGallery(urls));
      }

      continue;
    }

    if (line.trim().length === 0) {
      parts.push("<div>&nbsp;</div>");
      continue;
    }

    const escapedLine = emphasizeHistoryLabel(escapeHtml(line)).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>',
    );
    parts.push(`<div>${escapedLine}</div>`);
  }

  return parts.join("");
}

export function renderHistoryPageHtml(history: HistoryEventView[], backUrl = "/ui/listings") {
  let html = "<!doctype html><html><head><meta charset='UTF-8' />";
  html += "<meta name='viewport' content='width=device-width, initial-scale=1' />";
  html += "<title>История изменений</title>";
  html += "<style>";
  html += `
    :root {
      --bg: #f6f7fb;
      --panel: #ffffff;
      --text: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --accent: #2563eb;
      --accent-weak: rgba(37, 99, 235, 0.08);
    }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
      color: var(--text);
    }
    .history-page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }
    .history-page__header {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .history-page__back {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.18);
    }
    .history-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px 18px;
      margin-bottom: 14px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
    }
    .history-card__meta {
      font-weight: 700;
      margin-bottom: 10px;
    }
    .history-card__summary {
      line-height: 1.5;
      white-space: normal;
    }
    .history-photo-gallery {
      margin-top: 10px;
    }
    .history-photo-gallery__label {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .history-photo-gallery__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 10px;
    }
    .history-photo-thumb {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      background: #f3f4f6;
      padding: 0;
      cursor: pointer;
      display: block;
      aspect-ratio: 1 / 1;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
    }
    .history-photo-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .history-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.86);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 1000;
    }
    .history-lightbox[hidden] {
      display: none !important;
    }
    .history-lightbox__panel {
      position: relative;
      width: min(1100px, 100%);
      height: min(88vh, 900px);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .history-lightbox__image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 16px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
      background: #111827;
    }
    .history-lightbox__button {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      border: 0;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.95);
      color: #111827;
      font-size: 26px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .history-lightbox__button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .history-lightbox__button--prev {
      left: 8px;
    }
    .history-lightbox__button--next {
      right: 8px;
    }
    .history-lightbox__close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.95);
      color: #111827;
      font-size: 24px;
      cursor: pointer;
    }
    .history-lightbox__counter {
      position: absolute;
      left: 50%;
      bottom: 8px;
      transform: translateX(-50%);
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.72);
      color: #fff;
      font-size: 13px;
      font-weight: 700;
    }
    @media (max-width: 720px) {
      .history-page {
        padding: 14px;
      }
      .history-card {
        padding: 14px;
      }
      .history-lightbox__button {
        width: 42px;
        height: 42px;
        font-size: 22px;
      }
    }
  `;
  html += "</style>";
  html += "</head><body><div class='history-page'>";
  html += "<div class='history-page__header'>";
  html += `<a href='${escapeHtml(backUrl)}' class='history-page__back'>Все объявления</a>`;
  html += "<h2 style='margin:0;'>История изменений</h2>";
  html += "</div>";

  if (history.length === 0) {
    html += "<div class='history-card'>Нет событий</div>";
  }

  for (const event of history) {
    html += "<div class='history-card'>";
    html += "<div class='history-card__meta'><strong>" + escapeHtml(event.eventType) + "</strong> — " + escapeHtml(formatListingEventAt(event.createdAt)) + "</div>";
    html += "<div class='history-card__summary'>" + renderHistorySummaryHtml(formatEventSummary(event.eventType, event.changesJson)) + "</div>";
    html += "</div>";
  }

  html += `
    <div class="history-lightbox" id="history-lightbox" hidden aria-hidden="true">
      <div class="history-lightbox__panel" role="dialog" aria-modal="true" aria-label="Просмотр фото объявления">
        <button type="button" class="history-lightbox__close" id="history-lightbox-close" aria-label="Закрыть">×</button>
        <button type="button" class="history-lightbox__button history-lightbox__button--prev" id="history-lightbox-prev" aria-label="Предыдущее фото">‹</button>
        <img class="history-lightbox__image" id="history-lightbox-image" alt="Фото объявления" />
        <button type="button" class="history-lightbox__button history-lightbox__button--next" id="history-lightbox-next" aria-label="Следующее фото">›</button>
        <div class="history-lightbox__counter" id="history-lightbox-counter"></div>
      </div>
    </div>
    <script>
      (() => {
        const overlay = document.getElementById('history-lightbox');
        const image = document.getElementById('history-lightbox-image');
        const counter = document.getElementById('history-lightbox-counter');
        const prevButton = document.getElementById('history-lightbox-prev');
        const nextButton = document.getElementById('history-lightbox-next');
        const closeButton = document.getElementById('history-lightbox-close');
        let currentUrls = [];
        let currentIndex = 0;

        function renderCurrent() {
          if (!currentUrls.length) return;
          image.src = currentUrls[currentIndex];
          counter.textContent = (currentIndex + 1) + ' / ' + currentUrls.length;
          prevButton.disabled = currentUrls.length < 2;
          nextButton.disabled = currentUrls.length < 2;
        }

        function openGallery(urls, index) {
          currentUrls = urls;
          currentIndex = Math.max(0, Math.min(index, urls.length - 1));
          overlay.hidden = false;
          overlay.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';
          renderCurrent();
        }

        function closeGallery() {
          overlay.hidden = true;
          overlay.setAttribute('aria-hidden', 'true');
          image.removeAttribute('src');
          document.body.style.overflow = '';
        }

        function step(delta) {
          if (!currentUrls.length) return;
          currentIndex = (currentIndex + delta + currentUrls.length) % currentUrls.length;
          renderCurrent();
        }

        document.addEventListener('click', (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;

          const openButton = target.closest('[data-history-gallery-index]');
          if (openButton) {
            const gallery = openButton.closest('[data-history-gallery]');
            if (!gallery) return;

            const urls = JSON.parse(gallery.getAttribute('data-history-gallery') || '[]');
            const index = Number(openButton.getAttribute('data-history-gallery-index') || '0');
            openGallery(urls, index);
            return;
          }

          if (target === overlay) {
            closeGallery();
          }
        });

        prevButton.addEventListener('click', () => step(-1));
        nextButton.addEventListener('click', () => step(1));
        closeButton.addEventListener('click', closeGallery);

        document.addEventListener('keydown', (event) => {
          if (overlay.hidden) return;
          if (event.key === 'Escape') closeGallery();
          if (event.key === 'ArrowLeft') step(-1);
          if (event.key === 'ArrowRight') step(1);
        });
      })();
    </script>
  `;

  html += "</div></body></html>";
  return html;
}
