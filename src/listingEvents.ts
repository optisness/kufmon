import { createHash } from "crypto";

export type ListingSnapshot = {
  title: string;
  price: number;
  currency: string | null;
  sourcePrice: number | null;
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

function getAdParameterValue(ad: any, key: string) {
  const groups = [ad?.account_parameters, ad?.ad_parameters];

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    const match = group.find((item: any) => item?.p === key);
    const value = normalizeText(match?.v);
    if (value) return value;
  }

  return null;
}

export function normalizeKufarListing(ad: any, fallbackCategory: string | null): ListingSnapshot {
  const title = normalizeText(ad?.subject) ?? "Unknown";
  const currency = normalizeText(ad?.currency)?.toUpperCase() ?? "USD";
  const rawUsd = ad?.price_usd != null ? Number(ad.price_usd) / 100 : null;
  const rawByn = ad?.price_byn != null ? Number(ad.price_byn) / 100 : null;
  const price = Number.isFinite(rawUsd as number) ? (rawUsd as number) : Number.isFinite(rawByn as number) ? (rawByn as number) : 0;
  const sourcePriceRaw = currency === "BYN"
    ? (ad?.price_byn ?? ad?.price_usd ?? null)
    : (ad?.price_usd ?? ad?.price_byn ?? null);
  const sourcePrice = sourcePriceRaw != null && Number.isFinite(Number(sourcePriceRaw)) ? Number(sourcePriceRaw) : null;
  const roomsRaw = ad?.rooms ?? ad?.ad_parameters?.find?.((p: any) => p?.p === "rooms")?.v ?? null;
  const rooms = roomsRaw != null && Number.isFinite(Number(roomsRaw)) ? Number(roomsRaw) : null;
  const description = normalizeText(ad?.body ?? ad?.body_short ?? ad?.description ?? null);
  const imageUrl = extractFirstImageUrl(ad?.images);
  const category = ad?.category != null ? String(ad.category) : fallbackCategory;
  const sellerType = ad?.company_ad === true ? "company" : ad?.company_ad === false ? "private" : null;
  const address = normalizeText(ad?.address ?? getAdParameterValue(ad, "address") ?? getAdParameterValue(ad, "location") ?? null);
  const coords = Array.isArray(ad?.c) && ad.c.length >= 2 ? [Number(ad.c[0]), Number(ad.c[1])] : null;
  const location = coords ? `${coords[1]}, ${coords[0]}` : null;
  const url = normalizeText(ad?.ad_link || ad?.url || (ad?.ad_id != null ? `https://re.kufar.by/vi/${String(ad.ad_id)}` : null)) ?? "";

  return {
    title,
    price,
    currency,
    sourcePrice,
    description,
    imageUrl,
    rooms,
    category,
    sellerType,
    url,
    location,
    address,
  };
}

export function buildContentHash(snapshot: Pick<ListingSnapshot, "currency" | "sourcePrice" | "description" | "imageUrl" | "rooms">) {
  const payload = JSON.stringify({
    currency: snapshot.currency ?? null,
    sourcePrice: snapshot.sourcePrice ?? null,
    description: snapshot.description,
    imageUrl: snapshot.imageUrl,
    rooms: snapshot.rooms,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function diffListingSnapshots(previous: Pick<ListingSnapshot, "price" | "currency" | "sourcePrice" | "description" | "imageUrl" | "rooms">, next: Pick<ListingSnapshot, "price" | "currency" | "sourcePrice" | "description" | "imageUrl" | "rooms">) {
  const changes: ListingChange[] = [];

  const fields: ListingChangeField[] = ["price", "description", "imageUrl", "rooms"];

  for (const field of fields) {
    if (field === "price") {
      const previousSourcePrice = previous.sourcePrice;
      const nextSourcePrice = next.sourcePrice;
      const previousCurrency = previous.currency ?? null;
      const nextCurrency = next.currency ?? null;
      const sourceChanged = previousCurrency !== nextCurrency || previousSourcePrice !== nextSourcePrice;
      const displayChanged = previous.price !== next.price;

      if (!sourceChanged && !displayChanged) {
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
