import { prisma } from "./db.js";
import { sendTelegram } from "./telegram.js";
import { createLogger } from "./logger.js";
import { incMetric } from "./metrics.js";
import { matchesSubscriptionListing, normalizeSource } from "./subscriptions.js";
import { formatTelegramBatchMessage, splitTelegramMessageChunks, type TelegramEventType } from "./telegramMessage.js";
import { extractListingDetails, fetchKufarItem } from "./kufarItem.js";
import {
  buildChangedEventPayload,
  buildContentHash,
  buildNewEventPayload,
  buildRemovedEventPayload,
  diffListingSnapshots,
  normalizeKufarListing,
} from "./listingEvents.js";

const logger = createLogger({ module: "kufar" });
const KUFAR_FORMAT_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
let lastKufarFormatAlertSignature = "";
let lastKufarFormatAlertAt = 0;

const KUFAR_DEFAULT_GTSY = "country-belarus~province-grodnenskaja_oblast~locality-grodno";
const KUFAR_SOURCE = "kufar.by";

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
  cursor?: string;
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
  const limit = options?.limit ?? 100;
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
  if (options?.cursor) params.set("cursor", options.cursor);

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

function getAdminAlertChatId() {
  return String(process.env.ADMIN_TELEGRAM_CHAT_ID ?? "").trim() || null;
}

function validateKufarSearchResponse(data: any) {
  const issues: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    issues.push("root payload is not an object");
    return issues;
  }

  if (!Array.isArray(data.ads)) {
    issues.push("ads is not an array");
  }

  return issues;
}

async function notifyAdminAboutKufarFormatChange(issues: string[], sample: unknown) {
  const signature = issues.join(" | ");
  const now = Date.now();

  if (lastKufarFormatAlertSignature === signature && now - lastKufarFormatAlertAt < KUFAR_FORMAT_ALERT_COOLDOWN_MS) {
    return;
  }

  lastKufarFormatAlertSignature = signature;
  lastKufarFormatAlertAt = now;

  const chatId = getAdminAlertChatId();
  if (!chatId) {
    logger.warn({ issues }, "Kufar response format changed, but ADMIN_TELEGRAM_CHAT_ID is not configured");
    return;
  }

  await sendTelegram(
    [
      "⚠️ Kufar response format changed",
      `Issues: ${issues.join(", ")}`,
      `Sample: ${JSON.stringify(sample).slice(0, 1000)}`,
    ].join("\n"),
    chatId,
  );
}

export async function fetchKufarMap(options?: Parameters<typeof buildKufarSearchUrl>[0]) {
  const url = buildKufarSearchUrl(options);

  const res = await fetchWithRetry(url, {
    headers: {
      accept: "*/*",
    },
  });

  const data = await res.json();
  const issues = validateKufarSearchResponse(data);

  if (issues.length > 0) {
    await notifyAdminAboutKufarFormatChange(issues, data);
    throw new Error(`Unexpected Kufar response format: ${issues.join("; ")}`);
  }

  return data;
}

export { buildKufarSearchUrl };

async function resolveSyncCategories(options?: Parameters<typeof fetchKufarMap>[0]) {
  if (options?.category) {
    return [options.category];
  }

  const subscriptionCategories = await prisma.subscription.findMany({
    where: {
      enabled: true,
      source: { in: [KUFAR_SOURCE, "kufar"] },
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

function extractNextCursor(data: any) {
  const pages = Array.isArray(data?.pagination?.pages) ? data.pagination.pages : [];
  const nextPage = pages.find((page: any) => page?.label === "next" && page?.token);
  return typeof nextPage?.token === "string" && nextPage.token ? nextPage.token : null;
}

async function fetchKufarAdsPages(options: Parameters<typeof fetchKufarMap>[0], category: string) {
  const fetchedAds: Array<{
    id: string;
    snapshot: ReturnType<typeof normalizeKufarListing>;
  }> = [];

  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const requestOptions = { ...options, category, cursor } as Parameters<typeof fetchKufarMap>[0];
    const data = await fetchKufarMap(requestOptions);
    const ads = Array.isArray(data.ads) ? data.ads : [];

    incMetric("adsFetched", ads.length);

    for (const ad of ads) {
      const id = String(ad?.ad_id ?? ad?.list_id ?? "");
      if (!id) continue;

      const snapshot = normalizeKufarListing(ad, category);
      fetchedAds.push({ id, snapshot });
    }

    const nextCursor = extractNextCursor(data);
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return fetchedAds;
}

async function enrichNewListingSnapshot(
  id: string,
  snapshot: ReturnType<typeof normalizeKufarListing>,
) {
  try {
    const html = await fetchKufarItem(id);
    const details = extractListingDetails(html);

    return {
      ...snapshot,
      address: details.address ?? snapshot.address ?? null,
      fullDescription: details.fullDescription ?? snapshot.description,
      imageUrls: details.imageUrls.length > 0
        ? details.imageUrls
        : snapshot.imageUrl
          ? [snapshot.imageUrl]
          : [],
    };
  } catch (error) {
    logger.warn({ id, error }, "Failed to enrich new listing snapshot");

    return {
      ...snapshot,
      fullDescription: snapshot.description,
      imageUrls: snapshot.imageUrl ? [snapshot.imageUrl] : [],
    };
  }
}

function matchesUserSubscriptions(
  subscriptionsByUser: Record<string, any[]>,
  userId: string,
  ad: { price: number; rooms: number | null; category: string | null; sellerType: string | null; source?: string | null },
) {
  const userSubs = subscriptionsByUser[userId] || [];
  return userSubs.some((subscription) =>
    matchesSubscriptionListing(subscription, {
      price: ad.price,
      rooms: ad.rooms,
      category: ad.category,
      sellerType: ad.sellerType,
      source: ad.source,
    }),
  );
}

function getMatchingSubscriptionNames(
  subscriptionsByUser: Record<string, any[]>,
  userId: string,
  ad: { price: number; rooms: number | null; category: string | null; sellerType: string | null; source?: string | null },
  eventType: TelegramEventType,
) {
  const userSubs = subscriptionsByUser[userId] || [];
  return userSubs
    .filter((subscription) => {
      if (normalizeSource(subscription.source) !== KUFAR_SOURCE) {
        return false;
      }

      if (eventType === "CHANGED" && String(subscription.notificationMode ?? "new_and_changed") === "new_only") {
        return false;
      }

      return true;
    })
    .filter((subscription) =>
      matchesSubscriptionListing(subscription, {
        price: ad.price,
        rooms: ad.rooms,
        category: ad.category,
        sellerType: ad.sellerType,
        source: ad.source,
      }),
    )
    .map((subscription) => String(subscription.name ?? "").trim())
    .filter((name) => Boolean(name));
}

function normalizeSellerType(value: unknown): "company" | "private" | null {
  if (value === "company" || value === "private") {
    return value;
  }

  return null;
}

export async function saveKufarAds(options?: Parameters<typeof fetchKufarMap>[0]) {
  const users = await prisma.user.findMany();
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      source: { in: [KUFAR_SOURCE, "kufar"] },
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
    subscriptionName?: string;
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
    const adsForCategory = await fetchKufarAdsPages(options, category);

    for (const ad of adsForCategory) {
      currentIds.add(ad.id);
      fetchedAds.push(ad);
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
      source: { in: [KUFAR_SOURCE, "kufar"] },
      OR: [
        { category: { in: categoriesToSync } },
        { category: null },
      ],
    },
  });

  for (const ad of fetchedAds) {
    const existing = existingById.get(ad.id);
    const nextHash = buildContentHash(ad.snapshot);
    const baseData = {
      title: ad.snapshot.title,
      price: ad.snapshot.price,
      category: ad.snapshot.category,
      sellerType: ad.snapshot.sellerType,
      description: ad.snapshot.description,
      imageUrl: ad.snapshot.imageUrl,
      rooms: ad.snapshot.rooms,
      currency: "USD",
      url: ad.snapshot.url,
      location: ad.snapshot.location ?? existing?.location ?? null,
      source: KUFAR_SOURCE,
      contentHash: nextHash,
      missingCount: 0,
      lastSeenAt: syncTime,
      isActive: true,
    };

    if (!existing) {
      incMetric("newListings");
      logger.info({ id: ad.id, category: ad.snapshot.category, price: ad.snapshot.price }, "New listing");
      const newSnapshot = await enrichNewListingSnapshot(ad.id, ad.snapshot);

      await prisma.listing.create({
        data: {
          id: ad.id,
          ...baseData,
          firstSeenAt: syncTime,
        },
      });

      await prisma.adEvent.create({
        data: {
          listingId: ad.id,
          eventType: "NEW",
          changesJson: buildNewEventPayload(newSnapshot),
        },
      });

      for (const user of users) {
        const sellerType = normalizeSellerType(ad.snapshot.sellerType);
        const subscriptionNames = getMatchingSubscriptionNames(subscriptionsByUser, user.id, {
          price: ad.snapshot.price,
          rooms: ad.snapshot.rooms,
          category: ad.snapshot.category,
          sellerType,
          source: KUFAR_SOURCE,
        }, "NEW");

        if (subscriptionNames.length > 0) {
          userAlerts[user.id].NEW.push({
            category: ad.snapshot.category,
            title: ad.snapshot.title,
            rooms: ad.snapshot.rooms,
            price: ad.snapshot.price,
            url: ad.snapshot.url,
            subscriptionName: subscriptionNames.join(", "),
          });
        }
      }

      continue;
    }

    if (existing.isActive === false) {
      incMetric("newListings");
      logger.info({ id: ad.id, category: ad.snapshot.category, price: ad.snapshot.price }, "Listing restored");
      const newSnapshot = await enrichNewListingSnapshot(ad.id, ad.snapshot);

      await prisma.listing.update({
        where: { id: ad.id },
        data: {
          ...baseData,
          firstSeenAt: syncTime,
        },
      });

      await prisma.adEvent.create({
        data: {
          listingId: ad.id,
          eventType: "NEW",
          changesJson: buildNewEventPayload(newSnapshot),
        },
      });

      for (const user of users) {
        const subscriptionNames = getMatchingSubscriptionNames(subscriptionsByUser, user.id, {
          price: ad.snapshot.price,
          rooms: ad.snapshot.rooms,
          category: ad.snapshot.category,
          sellerType: ad.snapshot.sellerType,
          source: KUFAR_SOURCE,
        }, "NEW");

        if (subscriptionNames.length > 0) {
          userAlerts[user.id].NEW.push({
            category: ad.snapshot.category,
            title: ad.snapshot.title,
            rooms: ad.snapshot.rooms,
            price: ad.snapshot.price,
            url: ad.snapshot.url,
            subscriptionName: subscriptionNames.join(", "),
          });
        }
      }

      continue;
    }

    if (existing.contentHash == null) {
      await prisma.listing.update({
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

    await prisma.listing.update({
      where: { id: ad.id },
      data: baseData,
    });

    if (changes.length > 0) {
      incMetric("changedListings");
      if (changes.some((change) => change.field === "price")) {
        incMetric("priceChanges");
      }

      logger.info({ id: ad.id, category: ad.snapshot.category, changes }, "Listing changed");
      await prisma.adEvent.create({
        data: {
          listingId: ad.id,
          eventType: "CHANGED",
          changesJson: buildChangedEventPayload(changes),
        },
      });

      for (const user of users) {
        const subscriptionNames = getMatchingSubscriptionNames(subscriptionsByUser, user.id, {
          price: ad.snapshot.price,
          rooms: ad.snapshot.rooms,
          category: ad.snapshot.category,
          sellerType: ad.snapshot.sellerType,
          source: KUFAR_SOURCE,
        }, "CHANGED");

        if (subscriptionNames.length > 0) {
          userAlerts[user.id].CHANGED.push({
            category: ad.snapshot.category,
            title: ad.snapshot.title,
            rooms: ad.snapshot.rooms,
            price: ad.snapshot.price,
            url: ad.snapshot.url,
            subscriptionName: subscriptionNames.join(", "),
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

      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          missingCount,
          isActive: false,
        },
      });

      await prisma.adEvent.create({
        data: {
          listingId: listing.id,
          eventType: "REMOVED",
          changesJson: buildRemovedEventPayload(
            (() => {
              const sellerType = normalizeSellerType(listing.sellerType);
              return {
                title: listing.title,
                price: listing.price,
                description: listing.description ?? null,
                imageUrl: listing.imageUrl ?? null,
                rooms: listing.rooms ?? null,
                category: listing.category ?? null,
                sellerType,
                url: listing.url,
                location: listing.location ?? null,
              };
            })(),
            missingCount,
          ),
        },
      });

      for (const user of users) {
        const sellerType = normalizeSellerType(listing.sellerType);
        const subscriptionNames = getMatchingSubscriptionNames(subscriptionsByUser, user.id, {
          price: listing.price,
          rooms: listing.rooms ?? null,
          category: listing.category ?? null,
          sellerType,
          source: listing.source ?? KUFAR_SOURCE,
        }, "REMOVED");

        if (subscriptionNames.length > 0) {
          userAlerts[user.id].REMOVED.push({
            category: listing.category ?? null,
            title: listing.title,
            rooms: listing.rooms ?? null,
            price: listing.price,
            url: listing.url,
            subscriptionName: subscriptionNames.join(", "),
          });
        }
      }
    } else {
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          missingCount,
        },
      });
    }
  }

  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.listing.deleteMany({
    where: {
      isActive: false,
      source: { in: [KUFAR_SOURCE, "kufar"] },
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
    const chunks = splitTelegramMessageChunks(text);

    for (const chunk of chunks) {
      const ok = await sendTelegram(chunk, user.telegramChatId, { parseMode: "HTML" });
      if (ok) notificationsSent += 1;
    }
  }

  incMetric("alertsSent", notificationsSent);

  return currentIds.size;
}
