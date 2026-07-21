import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

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

beforeAll(async () => {
  const module = await import('../src/kufar.js');
  fetchKufarMap = module.fetchKufarMap;
  saveKufarAds = module.saveKufarAds;
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

  it('creates a new listing and sends a notification for new matching ads', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123', maxPrice: 500, rooms: [2] },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([]);
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
              i: '1',
              subject: 'Test listing',
              p: 400,
              rooms: 2,
              c: [27.5, 53.9],
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
      { id: 'user-1', telegramChatId: '123', maxPrice: 500, rooms: [2] },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([]);
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
              i: '1',
              subject: 'Test listing',
              p: 500,
              rooms: 2,
              c: [27.5, 53.9],
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

  it('uses a personal subscription filter when user preferences do not match', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', telegramChatId: '123', maxPrice: 100, rooms: [1] },
    ]);
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-1',
        filters: { price_max: 300, rooms: [2] },
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
              i: '1',
              subject: 'Test listing',
              p: 250,
              rooms: 2,
              c: [27.5, 53.9],
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
});
