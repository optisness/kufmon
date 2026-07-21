import { prisma } from "./db.js";
import { sendTelegram } from "./telegram.js";
import { createLogger } from "./logger.js";
import { incMetric } from "./metrics.js";

const logger = createLogger({ module: "kufar" });

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

export async function fetchKufarMap() {
  const url =
    "https://api.kufar.by/search-api/v2/search/map/over?cat=1010&gbx=b%3A23.7700119033966%2C53.65650117650396%2C23.781320096603395%2C53.66093670625306&prn=1000&size=900&sort=lst.d&typ=sell";

  const res = await fetchWithRetry(url, {
    headers: {
      accept: "*/*",
    },
  });

  return res.json();
}

export async function saveKufarAds() {
  const data = await fetchKufarMap();
  const ads = data.ads ?? [];

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
    if (existing && existing.price !== price) {
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