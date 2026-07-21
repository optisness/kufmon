import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import { prisma } from "./db.js";
import { fetchKufarMap, saveKufarAds } from "./kufar.js";
import { startCron } from "./cron.js";
import { sendTelegram } from "./telegram.js";
import { logger } from "./logger.js";
import { metrics, incMetric } from "./metrics.js";

const app = Fastify({
  logger,
});

app.get("/", async () => {
  const count = await prisma.listing.count();

  return {
    status: "ok",
    listings: count,
  };
});

app.get("/health", async () => {
  let dbOk = false;
  try {
    // lightweight DB check
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbOk = false;
  }

  const tgConfigured = !!process.env.TELEGRAM_TOKEN;

  return {
    status: "ok",
    db: dbOk,
    telegram: tgConfigured,
    uptime: process.uptime(),
  };
});

app.get("/metrics", async () => {
  const listings = await prisma.listing.count();
  const users = await prisma.user.count();

  return {
    uptime: process.uptime(),
    listings,
    users,
    metrics,
  };
});

app.register(fastifyFormbody);

app.get("/kufar", async () => {
  const data = await fetchKufarMap();
  return data;
});

app.get("/sync", async () => {
  incMetric("syncRuns");
  const count = await saveKufarAds();

  return {
    synced: count,
  };
});

app.get("/ui", async (req, reply) => {
  const listings = await prisma.listing.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
  });

  const users = await prisma.user.findMany();
  const subscriptions = await prisma.subscription.findMany({ take: 50, orderBy: { createdAt: 'desc' } });

  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Kufmon UI</title>

  <style>
    body { font-family: Arial; padding: 20px; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; }
    th { background: #f5f5f5; }
    tr:hover { background: #f9f9f9; }
    .price { font-weight: bold; }
    .new { color: green; }
    button { padding: 8px 12px; cursor: pointer; }
    input { margin: 4px; padding: 6px; }
  </style>
</head>

<body>
  <h1>Kufmon UI</h1>

  <h2>Синхронизация</h2>
  <button onclick="runSync()">Запустить sync</button>
  <div id="sync-result"></div>

  <h2>Создать пользователя</h2>
  <form method="POST" action="/users">
    <input name="chatId" placeholder="Telegram Chat ID" />
    <input name="maxPrice" placeholder="Max Price" />
    <input name="rooms" placeholder="Rooms (2,3)" />
    <button type="submit">Создать</button>
  </form>

<h2>Подписки</h2>
<p>Подписка привязана к пользователю и задаёт дополнительные пользовательские фильтры для уведомлений.</p>
<form method="POST" action="/subscriptions">
  <input name="name" placeholder="Название подписки" />
  <input name="userId" placeholder="User ID (optional)" />
  <input name="intervalMinutes" placeholder="Интервал (мин)" />
  <input name="filters" placeholder='Filters JSON (e.g. {"price_max":80000,"rooms":[2]})' />
  <button type="submit">Создать подписку</button>
</form>

<h3>Существующие подписки</h3>
<table>
  <tr>
    <th>ID</th>
    <th>Name</th>
    <th>Owner</th>
    <th>Interval</th>
    <th>Filters</th>
    <th>Enabled</th>
    <th></th>
  </tr>

  ${subscriptions.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${s.name}</td>
          <td>${s.userId ?? '-'}</td>
          <td>${s.intervalMinutes}</td>
          <td>${s.filters ? JSON.stringify(s.filters) : '-'}</td>
          <td>${s.enabled ? '✅' : '❌'}</td>
          <td>
            <form method="POST" action="/subscriptions/delete" onsubmit="return confirm('Удалить подписку?')">
              <input type="hidden" name="id" value="${s.id}" />
              <button type="submit" style="color:red">Удалить</button>
            </form>
          </td>
        </tr>
      `).join('')}
</table>

<h2>Пользователи</h2>
<table>
  <tr>
    <th>Chat ID</th>
    <th>Max Price</th>
    <th>Rooms</th>
    <th></th>
  </tr>

  ${users.map(u => `
    <tr>
      <td>${u.telegramChatId}</td>
      <td>${u.maxPrice ?? "-"}</td>
      <td>${u.rooms.join(", ")}</td>
      <td>
        <form method="POST" action="/users/delete" onsubmit="return confirm('Удалить пользователя?')">
          <input type="hidden" name="id" value="${u.id}" />
          <button type="submit" style="color:red">Удалить</button>
        </form>
      </td>
    </tr>
  `).join("")}
</table>

  <h2>Объявления</h2>

  <table>
    <tr>
      <th>ID</th>
      <th>Цена</th>
      <th>Комнаты</th>
      <th>Ссылка</th>
      <th>Активно</th>
    </tr>

    ${listings.map(l => `
      <tr>
        <td>${l.id}</td>
        <td class="price">${l.price}</td>
        <td>${l.rooms ?? "-"}</td>
        <td>
  <a href="${l.url}" target="_blank">открыть</a>
  <br/>
  <a href="/history/${l.id}" target="_blank">история</a>
</td>
        <td>${l.isActive ? "✅" : "❌"}</td>
      </tr>
    `).join("")}
  </table>

  <script>
    async function runSync() {
      const el = document.getElementById("sync-result");
      el.innerText = "Синхронизация...";

      try {
        const res = await fetch("/sync");
        const data = await res.json();

        el.innerText = "Готово: " + JSON.stringify(data);

        // автообновление страницы
        setTimeout(() => location.reload(), 1000);
      } catch (e) {
        el.innerText = "Ошибка";
      }
    }
  </script>
</body>
</html>
  `;

  reply.type("text/html; charset=utf-8").send(html);
});

app.post("/users", async (req: any, reply) => {
  const body = req.body;

  const rooms = body.rooms
    ? body.rooms.split(",").map((r: string) => Number(r))
    : [];

  await prisma.user.create({
    data: {
      telegramChatId: body.chatId,
      maxPrice: body.maxPrice ? Number(body.maxPrice) : null,
      rooms,
    },
  });

  reply.redirect("/ui");
});

app.post('/subscriptions', async (req: any, reply) => {
  const body = req.body;

  let filters = null;
  try { filters = body.filters ? JSON.parse(body.filters) : null; } catch { filters = null; }

  await prisma.subscription.create({
    data: {
      name: body.name || 'unnamed',
      userId: body.userId || null,
      filters,
      intervalMinutes: body.intervalMinutes ? Number(body.intervalMinutes) : 30,
    }
  });

  reply.redirect('/ui');
});

app.post('/subscriptions/delete', async (req: any, reply) => {
  const id = req.body.id;

  await prisma.subscription.delete({ where: { id } });

  reply.redirect('/ui');
});

app.post("/users/delete", async (req: any, reply) => {
  const id = req.body.id;

  await prisma.user.delete({
    where: { id },
  });

  reply.redirect("/ui");
});

app.get("/history/:id", async (req: any, reply) => {
  const id = req.params.id;

  const history = await prisma.priceHistory.findMany({
    where: { listingId: id },
    orderBy: { createdAt: "desc" },
  });

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
      </head>
      <body style="font-family: Arial; padding: 20px">
        <h2>История цен</h2>

        ${history
          .map(
            (h) => `
          <div>
            ${h.price} — ${new Date(h.createdAt).toLocaleString()}
          </div>
        `
          )
          .join("")}
      </body>
    </html>
  `;

  reply.type("text/html; charset=utf-8").send(html);
});

app.get("/test-tg", async () => {
  const users = await prisma.user.findMany();

  for (const user of users) {
    await sendTelegram(
      `TEST FROM RENDER`,
      user.telegramChatId
    );
  }

  return { ok: true, users: users.length };
});

// 3. запуск сервера (САМЫЙ НИЗ)
await app.listen({
  port: Number(process.env.PORT) || 3000,
  host: "0.0.0.0",
});

// 4. cron ПОСЛЕ listen
startCron();