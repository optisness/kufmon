import { prisma } from "./db.js";
import { sendTelegram } from "./telegram.js";
import { createLogger } from "./logger.js";
import { incMetric } from "./metrics.js";
import { matchesSubscriptionListing } from "./subscriptions.js";
import { formatTelegramBatchMessage, type TelegramEventType } from "./telegramMessage.js";
import {
  buildChangedEventPayload,
  buildContentHash,
  buildNewEventPayload,
  buildRemovedEventPayload,
  diffListingSnapshots,
  normalizeKufarListing,
} from "./listingEvents.js";

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
  regionCode?: string | number;
  areaCode?: string | number;
  rooms?: string;
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

async function resolveSyncCategories(options?: Parameters<typeof fetchKufarMap>[0]) {
  if (options?.category) {
    return [options.category];
  }

  const subscriptionCategories = await prisma.subscription.findMany({
    where: {
      enabled: true,
      category: { not: null },
    },
    select: { category: true },
  });

  const categories = new Set<string>();

  for (const subscription of subscriptionCategories) {
    if (subscription.category) {
      categories.add(subscription.category);
    }
  }

  categories.add(process.env.KUFAR_CATEGORY ?? KUFAR_CATEGORIES.apartments);

  return Array.from(categories);
}

function matchesUserSubscriptions(
  subscriptionsByUser: Record<string, any[]>,
  userId: string,
  ad: { price: number; rooms: number | null; category: string | null },
) {
  const userSubs = subscriptionsByUser[userId] || [];
  return userSubs.some((subscription) =>
    matchesSubscriptionListing(subscription, {
      price: ad.price,
      rooms: ad.rooms,
      category: ad.category,
    }),
  );
}

export async function saveKufarAds(options?: Parameters<typeof fetchKufarMap>[0]) {
  const users = await prisma.user.findMany();
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
    },
  });

  const categoriesToSync = await resolveSyncCategories(options);
  const currentIds = new Set<string>();

  const userAlerts: Record<string, Record<TelegramEventType, Array<{
    category: string | null;
    title: string;
    rooms: number | null;
    price: number;
    url: string;
    changes?: Array<{
      field: "price" | "description" | "imageUrl" | "rooms";
      old: string | number | null;
      new: string | number | null;
    }>;
  }>>> = {};
  const subscriptionsByUser: Record<string, any[]> = {};

  for (const user of users) {
    userAlerts[user.id] = {
      NEW: [],
      CHANGED: [],
      REMOVED: [],
    };
    subscriptionsByUser[user.id] = [];
  }

  for (const subscription of subscriptions) {
    if (subscription.userId && subscriptionsByUser[subscription.userId]) {
      subscriptionsByUser[subscription.userId].push(subscription);
    }
  }

  const fetchedAds: Array<{
    id: string;
    snapshot: ReturnType<typeof normalizeKufarListing>;
  }> = [];

  for (const category of categoriesToSync) {
    const data = await fetchKufarMap({ ...options, category });
    const ads = Array.isArray(data.ads) ? data.ads : [];

    incMetric("adsFetched", ads.length);

    for (const ad of ads) {
      const id = String(ad?.ad_id ?? ad?.list_id ?? "");
      if (!id) continue;

      const snapshot = normalizeKufarListing(ad, category);
      currentIds.add(id);
      fetchedAds.push({ id, snapshot });
    }
  }

  const syncTime = new Date();
  const fetchedIds = fetchedAds.map((item) => item.id);
  const existingListings = fetchedIds.length > 0
    ? await prisma.listing.findMany({
        where: {
          id: { in: fetchedIds },
        },
      })
    : [];
  const existingById = new Map(existingListings.map((listing) => [listing.id, listing]));

  const activeListings = await prisma.listing.findMany({
    where: {
      isActive: true,
      OR: [
        { category: { in: categoriesToSync } },
        { category: null },
      ],
    },
  });

  await prisma.$transaction(async (tx) => {
    for (const ad of fetchedAds) {
      const existing = existingById.get(ad.id);
      const nextHash = buildContentHash(ad.snapshot);
      const baseData = {
        title: ad.snapshot.title,
        price: ad.snapshot.price,
        category: ad.snapshot.category,
        description: ad.snapshot.description,
        imageUrl: ad.snapshot.imageUrl,
        rooms: ad.snapshot.rooms,
        currency: "BYN",
        url: ad.snapshot.url,
        location: ad.snapshot.location ?? existing?.location ?? null,
        source: "kufar",
        contentHash: nextHash,
        missingCount: 0,
        lastSeenAt: syncTime,
        isActive: true,
      };

      if (!existing) {
        incMetric("newListings");
        logger.info({ id: ad.id, category: ad.snapshot.category, price: ad.snapshot.price }, "New listing");

        await tx.listing.create({
          data: {
            id: ad.id,
            ...baseData,
            firstSeenAt: syncTime,
          },
        });

        await tx.adEvent.create({
          data: {
            listingId: ad.id,
            eventType: "NEW",
            changesJson: buildNewEventPayload(ad.snapshot),
          },
        });

        for (const user of users) {
          if (
            matchesUserSubscriptions(subscriptionsByUser, user.id, {
              price: ad.snapshot.price,
              rooms: ad.snapshot.rooms,
              category: ad.snapshot.category,
            })
          ) {
            userAlerts[user.id].NEW.push({
              category: ad.snapshot.category,
              title: ad.snapshot.title,
              rooms: ad.snapshot.rooms,
              price: ad.snapshot.price,
              url: ad.snapshot.url,
            });
          }
        }

        continue;
      }

      if (existing.isActive === false) {
        incMetric("newListings");
        logger.info({ id: ad.id, category: ad.snapshot.category, price: ad.snapshot.price }, "Listing restored");

        await tx.listing.update({
          where: { id: ad.id },
          data: {
            ...baseData,
            firstSeenAt: syncTime,
          },
        });

        await tx.adEvent.create({
          data: {
            listingId: ad.id,
            eventType: "NEW",
            changesJson: buildNewEventPayload(ad.snapshot),
          },
        });

        for (const user of users) {
          if (
            matchesUserSubscriptions(subscriptionsByUser, user.id, {
              price: ad.snapshot.price,
              rooms: ad.snapshot.rooms,
              category: ad.snapshot.category,
            })
          ) {
            userAlerts[user.id].NEW.push({
              category: ad.snapshot.category,
              title: ad.snapshot.title,
              rooms: ad.snapshot.rooms,
              price: ad.snapshot.price,
              url: ad.snapshot.url,
            });
          }
        }

        continue;
      }

      if (existing.contentHash == null) {
        await tx.listing.update({
          where: { id: ad.id },
          data: baseData,
        });
        continue;
      }

      const previousSnapshot = {
        price: existing.price,
        description: existing.description ?? null,
        imageUrl: existing.imageUrl ?? null,
        rooms: existing.rooms ?? null,
      };
      const nextSnapshot = {
        price: ad.snapshot.price,
        description: ad.snapshot.description,
        imageUrl: ad.snapshot.imageUrl,
        rooms: ad.snapshot.rooms,
      };
      const changes = diffListingSnapshots(previousSnapshot, nextSnapshot);

      await tx.listing.update({
        where: { id: ad.id },
        data: baseData,
      });

      if (changes.length > 0) {
        incMetric("changedListings");
        if (changes.some((change) => change.field === "price")) {
          incMetric("priceChanges");
        }

        logger.info({ id: ad.id, category: ad.snapshot.category, changes }, "Listing changed");
        await tx.adEvent.create({
          data: {
            listingId: ad.id,
            eventType: "CHANGED",
            changesJson: buildChangedEventPayload(changes),
          },
        });

        for (const user of users) {
          if (
            matchesUserSubscriptions(subscriptionsByUser, user.id, {
              price: ad.snapshot.price,
              rooms: ad.snapshot.rooms,
              category: ad.snapshot.category,
            })
          ) {
            userAlerts[user.id].CHANGED.push({
              category: ad.snapshot.category,
              title: ad.snapshot.title,
              rooms: ad.snapshot.rooms,
              price: ad.snapshot.price,
              url: ad.snapshot.url,
              changes,
            });
          }
        }
      }
    }

    for (const listing of activeListings) {
      if (currentIds.has(listing.id)) {
        continue;
      }

      const missingCount = Number(listing.missingCount ?? 0) + 1;

      if (missingCount >= 3) {
        incMetric("deactivations");

        await tx.listing.update({
          where: { id: listing.id },
          data: {
            missingCount,
            isActive: false,
          },
        });

        await tx.adEvent.create({
          data: {
            listingId: listing.id,
            eventType: "REMOVED",
            changesJson: buildRemovedEventPayload(
              {
                title: listing.title,
                price: listing.price,
                description: listing.description ?? null,
                imageUrl: listing.imageUrl ?? null,
                rooms: listing.rooms ?? null,
                category: listing.category ?? null,
                url: listing.url,
                location: listing.location ?? null,
              },
              missingCount,
            ),
          },
        });

        for (const user of users) {
          if (
            matchesUserSubscriptions(subscriptionsByUser, user.id, {
              price: listing.price,
              rooms: listing.rooms ?? null,
              category: listing.category ?? null,
            })
          ) {
            userAlerts[user.id].REMOVED.push({
              category: listing.category ?? null,
              title: listing.title,
              rooms: listing.rooms ?? null,
              price: listing.price,
              url: listing.url,
            });
          }
        }
      } else {
        await tx.listing.update({
          where: { id: listing.id },
          data: {
            missingCount,
          },
        });
      }
    }
  });

  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.listing.deleteMany({
    where: {
      isActive: false,
      lastSeenAt: { lt: staleCutoff },
    },
  });

  let notificationsSent = 0;

  for (const user of users) {
    const alerts = userAlerts[user.id];

    const flattened = [
      ...alerts.NEW.map((item) => ({ ...item, eventType: "NEW" as const })),
      ...alerts.CHANGED.map((item) => ({ ...item, eventType: "CHANGED" as const })),
      ...alerts.REMOVED.map((item) => ({ ...item, eventType: "REMOVED" as const })),
    ];

    if (flattened.length === 0) continue;

    const text = formatTelegramBatchMessage(flattened);
    const chunks = text.match(/[\s\S]{1,3500}/g) || [];

    for (const chunk of chunks) {
      const ok = await sendTelegram(chunk, user.telegramChatId);
      if (ok) notificationsSent += 1;
    }
  }

  incMetric("alertsSent", notificationsSent);

  return currentIds.size;
}
