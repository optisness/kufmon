export type TelegramEventType = "NEW" | "CHANGED" | "REMOVED";

type ListingAlert = {
  category: string | null;
  title: string;
  rooms: number | null;
  price: number;
  url: string;
};

type ListingEventAlert = ListingAlert & {
  eventType: TelegramEventType;
  subscriptionName?: string;
  changes?: Array<{
    field: "price" | "description" | "imageUrl" | "rooms";
    old: string | number | null;
    new: string | number | null;
  }>;
  citySlug?: string;
};

type CategoryPresentation = {
  icon: string;
  urlPath: string;
};

const CATEGORY_PRESENTATION: Record<string, CategoryPresentation> = {
  "1010": { icon: "🏢", urlPath: "kupit/kvartiru" },
  "1020": { icon: "🏠", urlPath: "kupit/dom" },
  "1050": { icon: "🏭", urlPath: "kupit/kommercheskaya/magaziny" },
  "1080": { icon: "🌾", urlPath: "kupit/uchastok" },
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCategoryPresentation(category: string | null): CategoryPresentation {
  if (category && CATEGORY_PRESENTATION[category]) {
    return CATEGORY_PRESENTATION[category];
  }

  return {
    icon: "📌",
    urlPath: "kupit/listing",
  };
}

function formatText(value: string | number | null) {
  if (value == null || value === "") return "—";
  return escapeHtml(value);
}

function formatPrice(value: string | number | null) {
  if (value == null || value === "") return "—";
  return `<b>$${escapeHtml(value)}</b>`;
}

function formatRooms(rooms: number | null) {
  if (rooms == null || !Number.isFinite(Number(rooms))) return "?к";
  return `${escapeHtml(rooms)}к`;
}

function parseAdId(url: string) {
  const match = url.match(/\/vi\/(?:[^/]+\/)*(\d+)(?:[/?#].*)?$/);
  return match?.[1] ?? null;
}

export function buildTelegramListingUrl(listing: {
  url: string;
  category: string | null;
  citySlug?: string;
}) {
  const existing = listing.url.trim();
  if (/^https?:\/\/re\.kufar\.by\/vi\/[^/]+\/kupit\/.+\/\d+$/i.test(existing)) {
    return existing;
  }

  const id = parseAdId(existing);
  if (!id) return existing;

  const citySlug = listing.citySlug?.trim() || "grodno";
  const category = getCategoryPresentation(listing.category);
  return `https://re.kufar.by/vi/${citySlug}/${category.urlPath}/${id}`;
}

function formatChanges(changes: ListingEventAlert["changes"]) {
  if (!changes || changes.length === 0) return null;

  const parts = changes.map((change) => {
    if (change.field === "price") {
      return `цена ${formatPrice(change.old)} → ${formatPrice(change.new)}`;
    }

    if (change.field === "description") {
      if (!change.old && change.new) return "описание добавлено";
      if (change.old && !change.new) return "описание удалено";
      return "описание изменено";
    }

    if (change.field === "imageUrl") {
      if (!change.old && change.new) return "фото добавлено";
      if (change.old && !change.new) return "фото удалено";
      return "фото изменено";
    }

    if (change.field === "rooms") {
      return `комнаты ${formatText(change.old)} → ${formatText(change.new)}`;
    }

    return `${change.field} изменено`;
  });

  return `Изменено: ${parts.join(", ")}`;
}

function formatListingCard(alert: ListingEventAlert) {
  const category = getCategoryPresentation(alert.category);
  const title = escapeHtml(alert.title.trim() || "Без названия");
  const lines = [
    `${category.icon} <b>${title}</b>`,
    `Цена: ${formatPrice(alert.price)}`,
    `Комнат: ${formatRooms(alert.rooms)}`,
  ];

  const changesLine = formatChanges(alert.changes);
  if (changesLine) {
    lines.push(changesLine);
  }

  lines.push(`Ссылка: <a href="${escapeHtml(buildTelegramListingUrl({
    url: alert.url,
    category: alert.category,
    citySlug: alert.citySlug,
  }))}">Куфар</a>`);

  return lines.join("\n");
}

function formatSectionTitle(eventType: TelegramEventType) {
  if (eventType === "NEW") return "🆕 Новые";
  if (eventType === "CHANGED") return "♻️ Измененные";
  return "🗑 Удаленные";
}

export function formatTelegramBatchMessage(items: ListingEventAlert[]) {
  const grouped: Record<TelegramEventType, ListingEventAlert[]> = {
    NEW: [],
    CHANGED: [],
    REMOVED: [],
  };

  for (const item of items) {
    grouped[item.eventType].push(item);
  }

  const subscriptionNames = Array.from(
    new Set(
      items
        .map((item) => item.subscriptionName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const subscriptionHeader = subscriptionNames.length > 0
    ? `${subscriptionNames.length === 1 ? "Подписка" : "Подписки"}: ${subscriptionNames.join(", ")}`
    : null;

  const sections = (Object.keys(grouped) as TelegramEventType[])
    .map((eventType) => {
      const cards = grouped[eventType];
      if (cards.length === 0) return null;
      return [formatSectionTitle(eventType), ...cards.map((card) => formatListingCard(card))].join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return [subscriptionHeader, sections].filter(Boolean).join("\n\n");
}
