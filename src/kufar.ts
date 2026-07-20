import { prisma } from "./db.js";
import { sendTelegram } from "./telegram.js";

export async function fetchKufarMap() {
  const url =
    "https://api.kufar.by/search-api/v2/search/map/over?cat=1010&gbx=b%3A23.7700119033966%2C53.65650117650396%2C23.781320096603395%2C53.66093670625306&prn=1000&size=900&sort=lst.d&typ=sell";

  const res = await fetch(url, {
    headers: {
      accept: "*/*",
    },
  });

  return res.json();
}

export async function saveKufarAds() {
  const data = await fetchKufarMap();
  const ads = data.ads ?? [];

  const users = await prisma.user.findMany();

  const currentIds = new Set<string>(ads.map((ad: any) => String(ad.i)));

  const userAlerts: Record<string, string[]> = {};

  for (const user of users) {
    userAlerts[user.id] = [];
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

    // 👉 история цен для новых
    if (isNew) {
      await prisma.priceHistory.create({
        data: {
          listingId: id,
          price,
        },
      });
    }

    // 👉 изменение цены
    if (existing && existing.price !== price) {
  console.log(`PRICE CHANGED: ${id} ${existing.price} -> ${price}`);

  // сохраняем историю
  await prisma.priceHistory.create({
    data: {
      listingId: id,
      price,
    },
  });

  // 👉 АЛЕРТ: цена упала
  if (price < existing.price) {
    for (const user of users) {
      const matchesPrice =
        !user.maxPrice || (price > 0 && price <= user.maxPrice);

      const matchesRooms =
        !user.rooms || (rooms && user.rooms.includes(rooms));

      if (matchesPrice && matchesRooms) {
        userAlerts[user.id].push(
          `📉 Цена упала!\n${existing.price} → ${price}\nhttps://re.kufar.by/vi/${id}`
        );
      }
    }
  }
}

    // 👉 фильтры пользователей
    for (const user of users) {
      const matchesPrice =
        !user.maxPrice || (price > 0 && price <= user.maxPrice);

      const matchesRooms =
        !user.rooms || (rooms && user.rooms.includes(rooms));

      if (isNew && matchesPrice && matchesRooms) {
        userAlerts[user.id].push(
          `🔥 ${price} | ${rooms ?? "?"}к\nhttps://re.kufar.by/vi/${id}`
        );
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

  // деактивация
  await prisma.listing.updateMany({
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

  // 👉 отправка Telegram
  for (const user of users) {
    const alerts = userAlerts[user.id];

    if (alerts.length === 0) continue;

    const text = alerts.join("\n\n");
    const chunks = text.match(/[\s\S]{1,3500}/g) || [];

    for (const chunk of chunks) {
      await sendTelegram(chunk, user.telegramChatId);
    }
  }

  return ads.length;
}