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
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  adEvent: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (cb) => cb(prismaMock)),
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
    prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
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
    prismaMock.listing.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.listing.create.mockResolvedValue({ id: '1' });
    prismaMock.adEvent.create.mockResolvedValue({});
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_usd: '40000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
              body_short: 'Cozy flat',
              images: [{ path: 'adim1/example.jpg' }],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();
    const message = sendTelegramMock.mock.calls[0]?.[0];

    expect(result).toBe(1);
    expect(prismaMock.listing.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.adEvent.create).toHaveBeenCalledTimes(1);
    expect(sendTelegramMock).toHaveBeenCalledTimes(1);
    expect(message).toContain('🆕 Новые');
    expect(message).toContain('🏢 <b>Test listing</b>');
    expect(message).toContain('Test listing');
    expect(message).toContain('Цена: <b>$400</b>');
    expect(message).toContain('Комнат: 2к');
    expect(message).toContain('https://re.kufar.by/vi/grodno/kupit/kvartiru/1');
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
    prismaMock.listing.findMany
      .mockResolvedValueOnce([
        { id: '1', price: 600, contentHash: 'old', description: 'Stable description', imageUrl: 'https://rms.kufar.by/v1/gallery/adim1/example.jpg', rooms: 2, isActive: true, category: '1010', title: 'Old title', url: 'https://re.kufar.by/vi/1', location: null, missingCount: 0 },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.listing.update.mockResolvedValue({ id: '1' });
    prismaMock.adEvent.create.mockResolvedValue({});
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_usd: '50000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
              body_short: 'Updated description',
              images: [{ path: 'adim1/updated.jpg' }],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();
    const message = sendTelegramMock.mock.calls[0]?.[0];

    expect(result).toBe(1);
    expect(prismaMock.listing.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.adEvent.create).toHaveBeenCalledTimes(1);
    expect(sendTelegramMock).toHaveBeenCalledTimes(1);
    expect(message).toContain('♻️ Измененные');
    expect(message).toContain('Test listing');
    expect(message).toContain('Цена: <b>$500</b>');
    expect(message).toContain('Изменено: цена <b>$600</b> → <b>$500</b>');
    expect(message).toContain('описание изменено');
    expect(message).toContain('фото изменено');
    expect(metrics.adsFetched).toBe(1);
    expect(metrics.changedListings).toBe(1);
    expect(metrics.priceChanges).toBe(1);
    expect(metrics.alertsSent).toBe(1);
  });

  it('ignores price-only changes below 50 USD when building change events', async () => {
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
    prismaMock.listing.findMany
      .mockResolvedValueOnce([
        { id: '1', price: 600, contentHash: 'old', description: 'Stable description', imageUrl: 'https://rms.kufar.by/v1/gallery/adim1/example.jpg', rooms: 2, isActive: true, category: '1010', title: 'Old title', url: 'https://re.kufar.by/vi/1', location: null, missingCount: 0 },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.listing.update.mockResolvedValue({ id: '1' });
    prismaMock.adEvent.create.mockResolvedValue({});
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_usd: '56000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
              body_short: 'Stable description',
              images: [{ path: 'adim1/example.jpg' }],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();

    expect(result).toBe(1);
    expect(prismaMock.listing.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.adEvent.create).not.toHaveBeenCalled();
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(metrics.changedListings).toBe(0);
    expect(metrics.priceChanges).toBe(0);
    expect(metrics.alertsSent).toBe(0);
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
    prismaMock.listing.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.listing.create.mockResolvedValue({ id: '1' });
    prismaMock.adEvent.create.mockResolvedValue({});
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_usd: '25000',
              ad_parameters: [
                { p: 'rooms', v: '2' },
                { p: 'coordinates', v: [27.5, 53.9] },
              ],
              body_short: 'Matching listing',
              images: [{ path: 'adim1/example.jpg' }],
            },
          ],
        }),
      },
    ]);

    const result = await saveKufarAds();

    expect(result).toBe(1);
    expect(prismaMock.adEvent.create).toHaveBeenCalledTimes(1);
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
    prismaMock.listing.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.listing.create.mockResolvedValue({ id: '1' });
    prismaMock.adEvent.create.mockResolvedValue({});
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
              price_usd: '25000',
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
    expect(prismaMock.adEvent.create).toHaveBeenCalledTimes(1);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(metrics.adsFetched).toBe(1);
    expect(metrics.newListings).toBe(1);
    expect(metrics.alertsSent).toBe(0);
  });

  it('restores a temporarily missing listing without logging an event when content is unchanged', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123' },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([]);
    prismaMock.listing.findMany
      .mockResolvedValueOnce([
        {
          id: '1',
          title: 'Test listing',
          price: 400,
          description: 'Stable description',
          imageUrl: 'https://rms.kufar.by/v1/gallery/adim1/example.jpg',
          rooms: 2,
          category: '1010',
          url: 'https://re.kufar.by/vi/1',
          location: null,
          source: 'kufar',
          contentHash: 'same',
          missingCount: 1,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '1',
          title: 'Test listing',
          price: 400,
          description: 'Stable description',
          imageUrl: 'https://rms.kufar.by/v1/gallery/adim1/example.jpg',
          rooms: 2,
          category: '1010',
          url: 'https://re.kufar.by/vi/1',
          location: null,
          source: 'kufar',
          contentHash: 'same',
          missingCount: 1,
          isActive: true,
        },
      ]);
    prismaMock.listing.update.mockResolvedValue({ id: '1' });
    prismaMock.adEvent.create.mockResolvedValue({});
    sendTelegramMock.mockResolvedValue(true);

    installFetchMock([
      {
        ok: true,
        json: async () => ({
          ads: [
            {
              ad_id: 1,
              subject: 'Test listing',
              price_usd: '40000',
              body_short: 'Stable description',
              images: [{ path: 'adim1/example.jpg' }],
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
    expect(prismaMock.adEvent.create).not.toHaveBeenCalled();
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(metrics.changedListings).toBe(0);
    expect(metrics.deactivations).toBe(0);
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

  it('matches 5+ room subscriptions against listings with five or more rooms', () => {
    expect(
      matchesSubscriptionListing(
        { category: '1010', rooms: ['5+'] },
        { category: '1010', price: 75000, rooms: 5 },
      ),
    ).toBe(true);

    expect(
      matchesSubscriptionListing(
        { category: '1010', rooms: ['5+'] },
        { category: '1010', price: 75000, rooms: 4 },
      ),
    ).toBe(false);
  });
});
