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
  changes?: Array<{
    field: "price" | "description" | "imageUrl" | "rooms";
    old: string | number | null;
    new: string | number | null;
  }>;
  citySlug?: string;
};

type CategoryPresentation = {
  icon: string;
  accent: string;
  label: string;
  urlSegment: string;
};

const CATEGORY_PRESENTATION: Record<string, CategoryPresentation> = {
  "1010": { icon: "🏢", accent: "🔵", label: "Квартира", urlSegment: "kvartiru" },
  "1020": { icon: "🏠", accent: "🟢", label: "Дом", urlSegment: "dom" },
  "1050": { icon: "🏭", accent: "🟠", label: "Коммерческая", urlSegment: "kommercheskuyu" },
  "1080": { icon: "🌾", accent: "🟤", label: "Участок", urlSegment: "listing" },
};

function getCategoryPresentation(category: string | null): CategoryPresentation {
  if (category && CATEGORY_PRESENTATION[category]) {
    return CATEGORY_PRESENTATION[category];
  }

  return {
    icon: "📌",
    accent: "⚪",
    label: "Объявление",
    urlSegment: "listing",
  };
}

function formatValue(value: string | number | null) {
  if (value == null || value === "") return "—";
  return String(value);
}

function formatPrice(value: string | number | null) {
  if (value == null || value === "") return "—";
  return `$${String(value)}`;
}

function formatRooms(rooms: number | null) {
  if (rooms == null || !Number.isFinite(Number(rooms))) return "?к";
  return `${rooms}к`;
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
  if (/^https?:\/\/re\.kufar\.by\/vi\/[^/]+\/[^/]+\/\d+$/i.test(existing)) {
    return existing;
  }

  const id = parseAdId(existing);
  if (!id) return existing;

  const citySlug = listing.citySlug?.trim() || "grodno";
  const category = getCategoryPresentation(listing.category);
  return `https://re.kufar.by/vi/${citySlug}/obmen/${category.urlSegment}/${id}`;
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
      return `комнаты ${formatValue(change.old)} → ${formatValue(change.new)}`;
    }

    return `${change.field} изменено`;
  });

  return `Изменено: ${parts.join(", ")}`;
}

function formatListingCard(alert: ListingEventAlert) {
  const category = getCategoryPresentation(alert.category);
  const title = alert.title.trim() || "Без названия";
  const lines = [
    `${category.icon} ${category.accent} ${category.label}`,
    title,
    `Комнат: ${formatRooms(alert.rooms)}`,
    `Цена: ${formatPrice(alert.price)}`,
  ];

  const changesLine = formatChanges(alert.changes);
  if (changesLine) {
    lines.push(changesLine);
  }

  lines.push(buildTelegramListingUrl({
    url: alert.url,
    category: alert.category,
    citySlug: alert.citySlug,
  }));

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

  return (Object.keys(grouped) as TelegramEventType[])
    .map((eventType) => {
      const cards = grouped[eventType];
      if (cards.length === 0) return null;
      return [formatSectionTitle(eventType), ...cards.map((card) => formatListingCard(card))].join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}
