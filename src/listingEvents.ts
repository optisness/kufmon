import { createHash } from "crypto";

export type ListingSnapshot = {
  title: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  rooms: number | null;
  category: string | null;
  sellerType: "company" | "private" | null;
  url: string;
  location: string | null;
  address?: string | null;
  fullDescription?: string | null;
  imageUrls?: string[];
};

export type ListingChangeField = "price" | "description" | "imageUrl" | "rooms";

export type ListingChange = {
  field: ListingChangeField;
  old: string | number | null;
  new: string | number | null;
};

const MIN_PRICE_CHANGE_USD = 50;

function normalizeText(value: any) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function extractFirstImageUrl(images: any) {
  if (!Array.isArray(images) || images.length === 0) return null;

  const first = images.find((item) => item && (item.path || item.url));
  if (!first) return null;

  if (typeof first === "string") {
    return normalizeText(first);
  }

  const raw = first.path || first.url || first.src || null;
  const text = normalizeText(raw);
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  return `https://rms.kufar.by/v1/gallery/${text.replace(/^\/+/, "")}`;
}

export function normalizeKufarListing(ad: any, fallbackCategory: string | null): ListingSnapshot {
  const title = normalizeText(ad?.subject) ?? "Unknown";
  const rawUsd = ad?.price_usd != null ? Number(ad.price_usd) / 100 : null;
  const rawByn = ad?.price_byn != null ? Number(ad.price_byn) / 100 : null;
  const price = Number.isFinite(rawUsd as number) ? (rawUsd as number) : Number.isFinite(rawByn as number) ? (rawByn as number) : 0;
  const roomsRaw = ad?.rooms ?? ad?.ad_parameters?.find?.((p: any) => p?.p === "rooms")?.v ?? null;
  const rooms = roomsRaw != null && Number.isFinite(Number(roomsRaw)) ? Number(roomsRaw) : null;
  const description = normalizeText(ad?.body ?? ad?.body_short ?? ad?.description ?? null);
  const imageUrl = extractFirstImageUrl(ad?.images);
  const category = ad?.category != null ? String(ad.category) : fallbackCategory;
  const sellerType = ad?.company_ad === true ? "company" : ad?.company_ad === false ? "private" : null;
  const coords = Array.isArray(ad?.c) && ad.c.length >= 2 ? [Number(ad.c[0]), Number(ad.c[1])] : null;
  const location = coords ? `${coords[1]}, ${coords[0]}` : null;
  const url = normalizeText(ad?.ad_link || ad?.url || (ad?.ad_id != null ? `https://re.kufar.by/vi/${String(ad.ad_id)}` : null)) ?? "";

  return {
    title,
    price,
    description,
    imageUrl,
    rooms,
    category,
    sellerType,
    url,
    location,
  };
}

export function buildContentHash(snapshot: Pick<ListingSnapshot, "price" | "description" | "imageUrl" | "rooms">) {
  const payload = JSON.stringify({
    price: snapshot.price,
    description: snapshot.description,
    imageUrl: snapshot.imageUrl,
    rooms: snapshot.rooms,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function diffListingSnapshots(previous: Pick<ListingSnapshot, "price" | "description" | "imageUrl" | "rooms">, next: Pick<ListingSnapshot, "price" | "description" | "imageUrl" | "rooms">) {
  const changes: ListingChange[] = [];

  const fields: ListingChangeField[] = ["price", "description", "imageUrl", "rooms"];

  for (const field of fields) {
    if (field === "price") {
      const previousPrice = Number(previous.price);
      const nextPrice = Number(next.price);
      if (Number.isFinite(previousPrice) && Number.isFinite(nextPrice) && Math.abs(previousPrice - nextPrice) < MIN_PRICE_CHANGE_USD) {
        continue;
      }
    }

    if (previous[field] !== next[field]) {
      changes.push({
        field,
        old: previous[field] ?? null,
        new: next[field] ?? null,
      });
    }
  }

  return changes;
}

export function buildNewEventPayload(snapshot: ListingSnapshot) {
  return {
    snapshot,
  };
}

export function buildChangedEventPayload(changes: ListingChange[]) {
  return {
    changes,
  };
}

export function buildRemovedEventPayload(snapshot: ListingSnapshot, missingCount: number) {
  return {
    snapshot,
    missingCount,
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

export function formatEventSummary(eventType: string, changesJson: any) {
  if (eventType === "NEW") {
    const snapshot = changesJson?.snapshot;
    if (!snapshot) return "Создано новое объявление";
    const parts = [
      `Создано: ${snapshot.title}`,
      `Цена: ${formatPrice(snapshot.price)}`,
      `Комнаты: ${formatValue(snapshot.rooms)}`,
    ];
    if (snapshot.address) parts.push(`Адрес: ${snapshot.address}`);
    if (snapshot.fullDescription) parts.push(`Полное описание: ${snapshot.fullDescription}`);
    if (snapshot.description) parts.push(`Описание: ${snapshot.description}`);
    const allPhotos = Array.isArray(snapshot.imageUrls) && snapshot.imageUrls.length > 0
      ? snapshot.imageUrls
      : snapshot.imageUrl
        ? [snapshot.imageUrl]
        : [];
    if (allPhotos.length > 0) {
      parts.push(`Все фото: ${allPhotos.join(", ")}`);
    }
    return parts.join("\n");
  }

  if (eventType === "CHANGED") {
    const changes = Array.isArray(changesJson?.changes) ? changesJson.changes : [];
    if (changes.length === 0) return "Изменения не указаны";
    return changes
      .map((change: ListingChange) => {
        const label = {
          price: "Цена",
          description: "Описание",
          imageUrl: "Фото",
          rooms: "Комнаты",
        }[change.field];
        if (change.field === "price") {
          return `${label}: ${formatPrice(change.old)} → ${formatPrice(change.new)}`;
        }
        return `${label}: ${formatValue(change.old)} → ${formatValue(change.new)}`;
      })
      .join("\n");
  }

  if (eventType === "REMOVED") {
    const missingCount = changesJson?.missingCount;
    const snapshot = changesJson?.snapshot;
    const title = snapshot?.title ? `Удалено: ${snapshot.title}` : "Удалено объявление";
    return `${title}\nПотеряно синхронизаций: ${formatValue(missingCount)}`;
  }

  return JSON.stringify(changesJson ?? {}, null, 2);
}
