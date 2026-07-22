type SubscriptionLike = {
  category?: string | null;
  maxPrice?: number | null;
  rooms?: unknown;
  filters?: unknown;
};

type ListingLike = {
  price?: number | null;
  rooms?: number | null;
  category?: string | null;
};

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

function normalizeRoomsList(value: unknown): number[] {
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
    .map((room) => Number(room))
    .filter((room) => Number.isFinite(room) && room > 0);
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
  if (subscription.category && listing.category && subscription.category !== listing.category) {
    return false;
  }

  if (subscription.category && !listing.category) {
    return false;
  }

  const filters = getSubscriptionFilters(subscription);

  if (filters.maxPrice != null) {
    if (!(listing.price != null && listing.price > 0 && listing.price <= filters.maxPrice)) {
      return false;
    }
  }

  if (filters.rooms.length > 0) {
    if (!listing.rooms || !filters.rooms.includes(listing.rooms)) {
      return false;
    }
  }

  return true;
}
