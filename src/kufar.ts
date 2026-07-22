import { prisma } from "./db.js";
import { sendTelegram } from "./telegram.js";
import { createLogger } from "./logger.js";
import { incMetric } from "./metrics.js";

const logger = createLogger({ module: "kufar" });

const KUFAR_DEFAULT_GTSY = "country-belarus~province-grodnenskaja_oblast~locality-grodno";

export const KUFAR_CATEGORIES = {
  apartments: "1010",
  houses: "1020",
  land: "1080",
  commercial: "1050",
} as const;

export type KufarCategory = (typeof KUFAR_CATEGORIES)[keyof typeof KUFAR_CATEGORIES];

function buildKufarSearchUrl(options?: {
  category?: string;
  currency?: string;
  gtsy?: string;
  language?: string;
  limit?: number;
  type?: string;
  // Optional explicit numeric codes (Kufar uses these in `pu` for some params)
  regionCode?: string | number; // `rgn`
  areaCode?: string | number; // `ar`
  // Rooms filter (e.g. `v.or:3`); leave undefined to not filter by rooms.
  rooms?: string; // `rms`
}) {
  const category =
    options?.category ??
    process.env.KUFAR_CATEGORY ??
    KUFAR_CATEGORIES.apartments;
  const currency = options?.currency ?? "USD";
  const gtsy = options?.gtsy ?? KUFAR_DEFAULT_GTSY;
  const language = options?.language ?? "ru";
  const limit = options?.limit ?? 30;
  const type = options?.type ?? "sell";

  const params = new URLSearchParams({
    cat: category,
    cur: currency,
    gtsy,
    lang: language,
    size: String(limit),
    typ: type,
  });

  if (options?.regionCode != null) params.set("rgn", String(options.regionCode));
  if (options?.areaCode != null) params.set("ar", String(options.areaCode));
  if (options?.rooms) params.set("rms", options.rooms);

  return `https://api.kufar.by/search-api/v2/search/rendered-paginated?${params.toString()}`;
}

async function fetchWithRetry(url: string, options: any = {}, retries = 3, backoff = 500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options as any);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, backoff * (attempt + 1)));
    }
  }
}

export async function fetchKufarMap(options?: Parameters<typeof buildKufarSearchUrl>[0]) {
  const url = buildKufarSearchUrl(options);

  const res = await fetchWithRetry(url, {
    headers: {
      accept: "*/*",
    },
  });

  return res.json();
}

export { buildKufarSearchUrl };

function findAdParamValue(ad: any, key: string) {
  const params = ad?.ad_parameters;
  if (!Array.isArray(params)) return null;
  const item = params.find((p: any) => p?.p === key);
  return item?.v ?? null;
}

function minorUnitsToNumber(value: any) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

function normalizeRenderedAd(ad: any) {
  // Normalize rendered-paginated response into the legacy shape
  // expected by the rest of this file (`i`, `subject`, `p`, `rooms`, `c`).
  const id = String(ad?.ad_id ?? ad?.list_id ?? "");
  const subject = ad?.subject ?? "Unknown";
  const roomsRaw = findAdParamValue(ad, "rooms");
  const rooms = roomsRaw != null ? Number(roomsRaw) : null;

  const coords = findAdParamValue(ad, "coordinates");
  const c =
    Array.isArray(coords) && coords.length >= 2
      ? [Number(coords[0]), Number(coords[1])]
      : null;

  const priceBynMinor = ad?.price_byn ?? null;
  const price = priceBynMinor != null ? minorUnitsToNumber(priceBynMinor) : 0;

  return {
    i: id,
    subject,
    p: price,
    rooms,
    c,
  };
}

export async function saveKufarAds(options?: Parameters<typeof fetchKufarMap>[0]) {
  const data = await fetchKufarMap(options);
  const ads = Array.isArray(data.ads) ? data.ads.map(normalizeRenderedAd) : [];

  incMetric("adsFetched", ads.length);

  const users = await prisma.user.findMany();
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      userId: { not: null },
    },
  });

  const currentIds = new Set<string>(ads.map((ad: any) => String(ad.i)));

  const userAlerts: Record<string, string[]> = {};
  const subscriptionsByUser: Record<string, any[]> = {};

  for (const user of users) {
    userAlerts[user.id] = [];
    subscriptionsByUser[user.id] = [];
  }

  for (const subscription of subscriptions) {
    if (subscription.userId && subscriptionsByUser[subscription.userId]) {
      subscriptionsByUser[subscription.userId].push(subscription);
    }
  }

  function parseFilters(filters: any) {
    if (!filters) return null;
    if (typeof filters === "string") {
      try {
        return JSON.parse(filters);
      } catch {
        return null;
      }
    }
    return filters;
  }

  function matchesFilter(filter: any, ad: any) {
    if (!filter) return true;

    const price = ad.p ?? 0;
    const rooms = ad.rooms ?? null;

    if (filter.price_max != null) {
      if (!(price > 0 && price <= filter.price_max)) return false;
    }

    if (filter.maxPrice != null) {
      if (!(price > 0 && price <= filter.maxPrice)) return false;
    }

    if (filter.rooms != null) {
      if (!rooms || !filter.rooms.includes(rooms)) return false;
    }

    return true;
  }

  function matchesUserPrefs(user: any, ad: any) {
    const price = ad.p ?? 0;
    const rooms = ad.rooms ?? null;

    const matchesPrice = !user.maxPrice || (price > 0 && price <= user.maxPrice);
    const matchesRooms = !user.rooms || (rooms && user.rooms.includes(rooms));

    return matchesPrice && matchesRooms;
  }

  function matchesSubscription(user: any, ad: any) {
    const userSubs = subscriptionsByUser[user.id] || [];
    return userSubs.some((subscription) => {
      const filter = parseFilters(subscription.filters);
      return matchesFilter(filter, ad);
    });
  }

  for (const ad of ads) {
    const id = String(ad.i);

    const title = ad.subject ?? "Unknown";
    const price = ad.p ?? 0;
    const rooms = ad.rooms ?? null;

    const existing = await prisma.listing.findUnique({
      where: { id },
    });

    const isNew = !existing;
    const priceChanged = !!(existing && existing.price !== price);

    // Ensure the listing row exists before writing any dependent rows (price history has FK).
    await prisma.listing.upsert({
      where: { id },
      update: {
        title,
        price,
        lastSeenAt: new Date(),
        isActive: true,
      },
      create: {
        id,
        title,
        price,
        currency: "BYN",
        url: `https://re.kufar.by/vi/${id}`,
        location: `${ad.c?.[1]}, ${ad.c?.[0]}`,
        source: "kufar",
      },
    });

    // history for new
    if (isNew) {
      incMetric("newListings");
      await prisma.priceHistory.create({
        data: {
          listingId: id,
          price,
        },
      });
    }

    // price changed
    if (priceChanged) {
      incMetric("priceChanges");
      logger.info({ id, oldPrice: existing.price, newPrice: price }, "Price changed");

      await prisma.priceHistory.create({
        data: {
          listingId: id,
          price,
        },
      });

      // price drop alerts
      if (price < existing.price) {
        for (const user of users) {
          const userMatch = matchesSubscription(user, ad) || matchesUserPrefs(user, ad);

          if (userMatch) {
            userAlerts[user.id].push(
              `📉 Цена упала!\n${existing.price} → ${price}\nhttps://re.kufar.by/vi/${id}`
            );
          }
        }
      }
    }

    // new ad alerts
    for (const user of users) {
      const userMatch = matchesSubscription(user, ad) || matchesUserPrefs(user, ad);

      if (isNew && userMatch) {
        userAlerts[user.id].push(`🔥 ${price} | ${rooms ?? "?"}к\nhttps://re.kufar.by/vi/${id}`);
      }
    }
  }

  // deactivate missing
  const deactivated = await prisma.listing.updateMany({
    where: {
      id: {
        notIn: Array.from(currentIds) as string[],
      },
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });

  incMetric("deactivations", deactivated.count ?? 0);

  // send Telegram alerts
  let notificationsSent = 0;

  for (const user of users) {
    const alerts = userAlerts[user.id];

    if (!alerts || alerts.length === 0) continue;

    const text = alerts.join("\n\n");
    const chunks = text.match(/[\s\S]{1,3500}/g) || [];

    for (const chunk of chunks) {
      const ok = await sendTelegram(chunk, user.telegramChatId);
      if (ok) notificationsSent += 1;
    }
  }

  incMetric("alertsSent", notificationsSent);

  return ads.length;
}
