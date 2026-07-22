import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { matchesSubscriptionListing } from '../src/subscriptions.js';

const prismaMock = {
  user: {
    findMany: vi.fn(),
  },
  subscription: {
    findMany: vi.fn(),
  },
  listing: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  priceHistory: {
    create: vi.fn(),
  },
};

const sendTelegramMock = vi.fn();

vi.doMock('../src/db.js', () => ({ prisma: prismaMock }));
vi.doMock('../src/telegram.js', () => ({ sendTelegram: sendTelegramMock }));

import { metrics } from '../src/metrics.js';

let fetchKufarMap: any;
let saveKufarAds: any;
let buildKufarSearchUrl: any;

beforeAll(async () => {
  const module = await import('../src/kufar.js');
  fetchKufarMap = module.fetchKufarMap;
  saveKufarAds = module.saveKufarAds;
  buildKufarSearchUrl = module.buildKufarSearchUrl;
});

const installFetchMock = (responses: any[]) => {
  const fetchMock = vi.fn();

  responses.forEach((response, index) => {
    if (response instanceof Error) {
      fetchMock.mockRejectedValueOnce(response);
    } else {
      fetchMock.mockResolvedValueOnce(response);
    }
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('Kufar sync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.keys(metrics).forEach((key) => {
      metrics[key as keyof typeof metrics] = 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries fetch when Kufar API fails once and then succeeds', async () => {
    const response = {
      ok: true,
      json: async () => ({ ads: [] }),
    };

    const fetchMock = installFetchMock([new Error('network'), response]);

    const data = await fetchKufarMap();

    expect(data).toEqual({ ads: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('builds a search url with region filter (gtsy)', () => {
    const url = buildKufarSearchUrl({
      gtsy: 'country-belarus~province-grodnenskaja_oblast~locality-grodno',
      currency: 'USD',
      category: '1010',
      language: 'ru',
      limit: 30,
      type: 'sell',
    });

    expect(url).toContain('search/rendered-paginated?');
    expect(url).toContain('cat=1010');
    expect(url).toContain('cur=USD');
    expect(url).toContain('lang=ru');
    expect(url).toContain('size=30');
    expect(url).toContain('typ=sell');
    // URLSearchParams encodes `~` as `%7E`
    expect(decodeURIComponent(url)).toContain('gtsy=country-belarus~province-grodnenskaja_oblast~locality-grodno');
  });

  it('creates a new listing and sends a notification for new matching ads', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123' },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-1',
        maxPrice: 500,
        rooms: [2],
        enabled: true,
      },
    ]);
    prismaMock.listing.findUnique.mockResolvedValue(null);
    prismaMock.listing.upsert.mockResolvedValue({ id: '1' });
    prismaMock.priceHistory.create.mockResolvedValue({});
    prismaMock.listing.updateMany.mockResolvedValue({ count: 0 });
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_byn: '40000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();

    expect(result).toBe(1);
    expect(prismaMock.priceHistory.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.listing.upsert).toHaveBeenCalledTimes(1);
    expect(sendTelegramMock).toHaveBeenCalledTimes(1);
    expect(metrics.adsFetched).toBe(1);
    expect(metrics.newListings).toBe(1);
    expect(metrics.alertsSent).toBe(1);
    expect(metrics.deactivations).toBe(0);
  });

  it('records a price change and sends an alert when listing price drops', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123' },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-1',
        maxPrice: 500,
        rooms: [2],
        enabled: true,
      },
    ]);
    prismaMock.listing.findUnique.mockResolvedValue({ id: '1', price: 600 });
    prismaMock.listing.upsert.mockResolvedValue({ id: '1' });
    prismaMock.priceHistory.create.mockResolvedValue({});
    prismaMock.listing.updateMany.mockResolvedValue({ count: 0 });
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_byn: '50000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();

    expect(result).toBe(1);
    expect(prismaMock.priceHistory.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.listing.upsert).toHaveBeenCalledTimes(1);
    expect(sendTelegramMock).toHaveBeenCalledTimes(1);
    expect(metrics.adsFetched).toBe(1);
    expect(metrics.priceChanges).toBe(1);
    expect(metrics.alertsSent).toBe(1);
  });

  it('uses subscription filters when user preferences are absent', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123' },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-1',
        maxPrice: 300,
        rooms: [2],
        enabled: true,
      },
    ]);
    prismaMock.listing.findUnique.mockResolvedValue(null);
    prismaMock.listing.upsert.mockResolvedValue({ id: '1' });
    prismaMock.priceHistory.create.mockResolvedValue({});
    prismaMock.listing.updateMany.mockResolvedValue({ count: 0 });
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_byn: '25000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();

    expect(result).toBe(1);
    expect(sendTelegramMock).toHaveBeenCalledTimes(1);
    expect(metrics.adsFetched).toBe(1);
    expect(metrics.newListings).toBe(1);
    expect(metrics.alertsSent).toBe(1);
  });

  it('does not match a subscription from another category', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123' },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-1',
        category: '1050',
        maxPrice: 300,
        rooms: [2],
        enabled: true,
      },
    ]);
    prismaMock.listing.findUnique.mockResolvedValue(null);
    prismaMock.listing.upsert.mockResolvedValue({ id: '1' });
    prismaMock.priceHistory.create.mockResolvedValue({});
    prismaMock.listing.updateMany.mockResolvedValue({ count: 0 });
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({ ads: [] }),
      },
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_byn: '25000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();

    expect(result).toBe(1);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(metrics.adsFetched).toBe(1);
    expect(metrics.newListings).toBe(1);
    expect(metrics.alertsSent).toBe(0);
  });

  it('matches listings by subscription fields and category', () => {
    expect(
      matchesSubscriptionListing(
        { category: '1010', maxPrice: 80000, rooms: [1, 2] },
        { category: '1010', price: 75000, rooms: 2 },
      ),
    ).toBe(true);

    expect(
      matchesSubscriptionListing(
        { category: '1010', maxPrice: 80000, rooms: [1, 2] },
        { category: '1050', price: 75000, rooms: 2 },
      ),
    ).toBe(false);
  });
});
