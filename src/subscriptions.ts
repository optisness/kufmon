type SubscriptionLike = {
  source?: string | null;
  category?: string | null;
  sellerTypeFilter?: string | null;
  notificationMode?: string | null;
  maxPrice?: number | null;
  rooms?: unknown;
  filters?: unknown;
};

type ListingLike = {
  source?: string | null;
  price?: number | null;
  rooms?: number | null;
  category?: string | null;
  sellerType?: string | null;
};

export function normalizeSource(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text === "kufar" || text === "kufar.by") {
    return "kufar.by";
  }

  return text;
}

function parseMaybeJson(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function normalizeRoomsList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : value == null
        ? []
        : [value];

  return raw
    .map((room) => {
      const text = String(room).trim();
      if (!text) return null;
      if (text === "5+") return "5+";

      const parsed = Number(text);
      if (Number.isFinite(parsed) && parsed > 0) {
        return String(Math.trunc(parsed));
      }

      return null;
    })
    .filter((room): room is string => room != null);
}

function matchesRoomFilter(listingRooms: number | null, filterValue: string) {
  if (filterValue === "5+") {
    return listingRooms != null && listingRooms >= 5;
  }

  const parsed = Number(filterValue);
  return Number.isFinite(parsed) && listingRooms === parsed;
}

export function getSubscriptionFilters(subscription: SubscriptionLike) {
  const legacyFilters = parseMaybeJson(subscription.filters) as any;
  const legacyMaxPrice = legacyFilters?.price_max ?? legacyFilters?.maxPrice ?? null;
  const maxPrice =
    subscription.maxPrice != null
      ? Number(subscription.maxPrice)
      : legacyMaxPrice != null
        ? Number(legacyMaxPrice)
        : null;

  const roomsSource =
    subscription.rooms != null && normalizeRoomsList(subscription.rooms).length > 0
      ? subscription.rooms
      : legacyFilters?.rooms;

  const rooms = normalizeRoomsList(roomsSource);

  return {
    maxPrice: Number.isFinite(maxPrice as number) ? (maxPrice as number) : null,
    rooms,
  };
}

export function formatRoomsList(rooms: unknown) {
  const values = normalizeRoomsList(rooms);
  return values.length > 0 ? values.join(", ") : "-";
}

export function matchesSubscriptionListing(subscription: SubscriptionLike, listing: ListingLike) {
  if (normalizeSource(subscription.source) !== normalizeSource(listing.source)) {
    return false;
  }

  if (subscription.category && listing.category && subscription.category !== listing.category) {
    return false;
  }

  if (subscription.category && !listing.category) {
    return false;
  }

  if (subscription.sellerTypeFilter === "private" && listing.sellerType !== "private") {
    return false;
  }

  const filters = getSubscriptionFilters(subscription);

  if (filters.maxPrice != null) {
    if (!(listing.price != null && listing.price > 0 && listing.price <= filters.maxPrice)) {
      return false;
    }
  }

  if (filters.rooms.length > 0) {
    if (!filters.rooms.some((room) => matchesRoomFilter(listing.rooms ?? null, room))) return false;
  }

  return true;
}
