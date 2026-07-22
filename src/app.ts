import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import { prisma } from "./db.js";
import { fetchKufarMap, saveKufarAds, KUFAR_CATEGORIES } from "./kufar.js";
import { startCron } from "./cron.js";
import { sendTelegram } from "./telegram.js";
import { logger } from "./logger.js";
import { metrics, incMetric } from "./metrics.js";

const app = Fastify({
  logger,
});

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getUserDisplayName(user: any) {
  const name = typeof user?.name === "string" ? user.name.trim() : "";
  return name || user?.telegramChatId || "—";
}

function compareStrings(a: string, b: string) {
  return a.localeCompare(b, "ru", { sensitivity: "base", numeric: true });
}

function sortUsers(users: any[]) {
  return [...users].sort((a, b) => {
    const nameA = typeof a?.name === "string" ? a.name.trim() : "";
    const nameB = typeof b?.name === "string" ? b.name.trim() : "";

    if (nameA && nameB) {
      const byName = compareStrings(nameA, nameB);
      if (byName !== 0) {
        return byName;
      }
    } else if (nameA || nameB) {
      return nameA ? -1 : 1;
    }

    return compareStrings(String(a?.telegramChatId ?? ""), String(b?.telegramChatId ?? ""));
  });
}

function sortSubscriptions(subscriptions: any[], usersById: Map<string, any>) {
  return [...subscriptions].sort((a, b) => {
    const byName = compareStrings(String(a?.name ?? ""), String(b?.name ?? ""));
    if (byName !== 0) {
      return byName;
    }

    const ownerA = a?.userId ? getUserDisplayName(usersById.get(a.userId)) : "";
    const ownerB = b?.userId ? getUserDisplayName(usersById.get(b.userId)) : "";
    if (ownerA || ownerB) {
      if (!ownerA) return 1;
      if (!ownerB) return -1;
      const byOwner = compareStrings(ownerA, ownerB);
      if (byOwner !== 0) {
        return byOwner;
      }
    }

    const byInterval = Number(a?.intervalMinutes ?? 0) - Number(b?.intervalMinutes ?? 0);
    if (byInterval !== 0) {
      return byInterval;
    }

    return compareStrings(String(a?.createdAt ?? ""), String(b?.createdAt ?? ""));
  });
}

app.get("/", async (req, reply) => {
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Kufmon Dashboard</title>
  <style>
    body { font-family: Arial; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-bottom: 30px; }
    .nav { display: flex; gap: 10px; margin-bottom: 30px; flex-wrap: wrap; }
    .nav a { padding: 10px 15px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
    .nav a:hover { background: #0056b3; }
    .card { background: #f9f9f9; padding: 15px; margin: 10px 0; border-left: 4px solid #007bff; border-radius: 4px; }
    .card h3 { margin-top: 0; color: #007bff; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏠 Kufmon Dashboard</h1>
    
    <div class="nav">
      <a href="/ui">📋 Admin UI</a>
      <a href="/health">💚 Health Check</a>
      <a href="/metrics">📊 Metrics</a>
      <a href="/kufar">🏠 Kufar API</a>
      <a href="/sync">🔄 Manual Sync</a>
    </div>

    <div class="card">
      <h3>Status</h3>
      <p><strong>Service:</strong> Running ✅</p>
      <p><strong>Endpoint:</strong> <code>https://kufmon.onrender.com</code></p>
    </div>

    <div class="card">
      <h3>Quick Links</h3>
      <ul>
        <li><a href="/ui">Go to Admin UI</a> - manage users, subscriptions, and listings</li>
        <li><a href="/health">Check health</a> - database and Telegram status</li>
        <li><a href="/metrics">View metrics</a> - sync stats and uptime</li>
      </ul>
    </div>

    <div class="card">
      <h3>API Documentation</h3>
      <p>See <code>/ui</code> for the admin interface or refer to API docs for programmatic access.</p>
    </div>
  </div>
</body>
</html>
  `;
  reply.type("text/html; charset=utf-8").send(html);
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

app.get("/kufar", async (req: any) => {
  // Optional category override: `/kufar?cat=1020`
  const cat = typeof req.query?.cat === "string" ? req.query.cat : undefined;
  const data = await fetchKufarMap(cat ? { category: cat } : undefined);
  return data;
});

app.get("/sync", async (req: any) => {
  incMetric("syncRuns");
  // Optional category override: `/sync?cat=1020`
  const cat = typeof req.query?.cat === "string" ? req.query.cat : undefined;
  const count = await saveKufarAds(cat ? { category: cat } : undefined);

  return {
    synced: count,
  };
});

app.get("/ui", async (req, reply) => {
  const listings = await prisma.listing.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
  });

  const users = sortUsers(await prisma.user.findMany());
  const usersById = new Map(users.map((user) => [user.id, user]));
  const subscriptions = sortSubscriptions(
    await prisma.subscription.findMany({ take: 50, orderBy: { createdAt: "desc" } }),
    usersById,
  );
  const categoryOptions = [
    { value: KUFAR_CATEGORIES.apartments, label: "Квартиры (1010)" },
    { value: KUFAR_CATEGORIES.houses, label: "Дома (1020)" },
    { value: KUFAR_CATEGORIES.commercial, label: "Коммерция (1050)" },
    { value: KUFAR_CATEGORIES.land, label: "Земля (1080)" },
  ];
  const categoryLabelByValue = Object.fromEntries(
    categoryOptions.map((option) => [option.value, option.label]),
  );
  const userOptions = users
    .map((user) => {
      const label = user.name?.trim()
        ? `${user.name.trim()} (${user.telegramChatId})`
        : user.telegramChatId;
      return `<option value="${escapeHtml(user.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  const categoryOptionMarkup = categoryOptions
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Kufmon Admin UI</title>

  <style>
    body { font-family: Arial; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .nav { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .nav a { padding: 8px 12px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; }
    .nav a:hover { background: #0056b3; }
    .section { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h2 { color: #333; margin-top: 0; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    h3 { color: #555; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; font-weight: bold; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable::after { content: " ↕"; color: #888; font-weight: normal; }
    th.sortable[data-sort-dir="asc"]::after { content: " ↑"; color: #007bff; }
    th.sortable[data-sort-dir="desc"]::after { content: " ↓"; color: #007bff; }
    tr:hover { background: #f9f9f9; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
    input, textarea, select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: Arial; width: 100%; box-sizing: border-box; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: #007bff; box-shadow: 0 0 4px rgba(0,123,255,0.25); }
    button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    button:hover { background: #0056b3; }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    .price { font-weight: bold; color: #28a745; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
  </style>
</head>

<body>
  <div class="container">
    <div class="header">
      <h1>Kufmon Admin UI</h1>
      <div class="nav">
        <a href="/">← Dashboard</a>
        <a href="/health">Health</a>
        <a href="/metrics">Metrics</a>
      </div>
    </div>

    <div class="section">
      <h2>Синхронизация</h2>
      <button onclick="runSync()">▶ Запустить sync</button>
      <span id="sync-result"></span>
    </div>

    <div class="section">
      <h2>Пользователи</h2>
      <h3>Создать пользователя</h3>
      <form method="POST" action="/users" style="max-width: 400px;">
        <div class="form-group">
          <label>Имя / название пользователя</label>
          <input name="name" placeholder="Например, Иван или Агентство А" />
        </div>
        <div class="form-group">
          <label>Telegram Chat ID</label>
          <input name="chatId" placeholder="e.g., 123456789" required />
        </div>
        <div class="form-group">
          <label>Max Price (optional)</label>
          <input name="maxPrice" placeholder="e.g., 100000" type="number" />
        </div>
        <div class="form-group">
          <label>Rooms (comma-separated, optional)</label>
          <input name="rooms" placeholder="e.g., 2,3" />
        </div>
        <button type="submit">Создать пользователя</button>
      </form>

      <h3>Существующие пользователи</h3>
      <table data-sort-table="users">
        <tr>
          <th>№</th>
          <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="name">Имя / название</th>
          <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="chatId">Chat ID</th>
          <th class="sortable" data-sortable="true" data-sort-type="number" data-sort-key="maxPrice">Max Price</th>
          <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="rooms">Rooms</th>
          <th></th>
        </tr>
        ${users.map((u, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(u.name?.trim() || "-")}</td>
            <td>${escapeHtml(u.telegramChatId)}</td>
            <td>${u.maxPrice ?? "-"}</td>
            <td>${escapeHtml((u.rooms || []).join(", ") || "-")}</td>
            <td>
              <form method="POST" action="/users/delete" onsubmit="return confirm('Удалить пользователя?')" style="display:inline;">
                <input type="hidden" name="id" value="${u.id}" />
                <button type="submit" class="btn-danger" style="padding:5px 10px;">Удалить</button>
              </form>
            </td>
          </tr>
        `).join("")}
      </table>
    </div>

    <div class="section">
      <h2>Подписки</h2>
      <p><em>Подписка привязана к пользователю и задаёт дополнительные фильтры для уведомлений.</em></p>
      <h3>Создать подписку</h3>
      <form method="POST" action="/subscriptions" style="max-width: 600px;">
        <div class="form-row">
          <div class="form-group">
            <label>Название подписки</label>
            <input name="name" placeholder="e.g., Minsk 2 rooms" required />
          </div>
          <div class="form-group">
            <label>User ID (optional)</label>
            <select name="userId">
              <option value="">Глобальная подписка</option>
              ${userOptions}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Интервал (минуты)</label>
            <input name="intervalMinutes" type="number" value="30" />
          </div>
          <div class="form-group">
            <label>Категория поиска</label>
            <select name="category" required>
              ${categoryOptionMarkup}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Filters (JSON)</label>
          <textarea name="filters" placeholder='{"price_max": 80000, "rooms": [2]}' rows="3"></textarea>
        </div>
        <button type="submit">Создать подписку</button>
      </form>

      <h3>Существующие подписки</h3>
      <table data-sort-table="subscriptions">
        <tr>
          <th>№</th>
          <th>ID</th>
          <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="name">Name</th>
          <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="owner">Owner</th>
          <th>Category</th>
          <th class="sortable" data-sortable="true" data-sort-type="number" data-sort-key="interval">Interval</th>
          <th>Filters</th>
          <th class="sortable" data-sortable="true" data-sort-type="boolean" data-sort-key="enabled">Enabled</th>
          <th></th>
        </tr>
        ${subscriptions.map((s, index) => `
          <tr>
            <td>${index + 1}</td>
            <td style="font-size:12px; max-width:100px; word-break:break-all;">${s.id}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.userId ? getUserDisplayName(usersById.get(s.userId)) : "-")}</td>
            <td>${escapeHtml(s.category ? `${s.category} ${categoryLabelByValue[s.category] ? `(${categoryLabelByValue[s.category]})` : ""}` : "-")}</td>
            <td>${s.intervalMinutes} мин</td>
            <td><code style="font-size:11px;">${s.filters ? escapeHtml(JSON.stringify(s.filters)) : '-'}</code></td>
            <td>${s.enabled ? '✅' : '❌'}</td>
            <td>
              <form method="POST" action="/subscriptions/delete" onsubmit="return confirm('Удалить подписку?')" style="display:inline;">
                <input type="hidden" name="id" value="${s.id}" />
                <button type="submit" class="btn-danger" style="padding:5px 10px;">Удалить</button>
              </form>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>

    <div class="section">
      <h2>Объявления</h2>
      <p>Последние 50 объявлений</p>
      <table data-sort-table="listings">
        <tr>
          <th>№</th>
          <th>ID</th>
          <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="title">Название</th>
          <th>Category</th>
          <th class="sortable" data-sortable="true" data-sort-type="number" data-sort-key="price">Цена</th>
          <th class="sortable" data-sortable="true" data-sort-type="number" data-sort-key="rooms">Комнаты</th>
          <th>Ссылка</th>
          <th class="sortable" data-sortable="true" data-sort-type="boolean" data-sort-key="active">Активно</th>
        </tr>
        ${listings.map((l, index) => `
          <tr>
            <td>${index + 1}</td>
            <td style="font-size:11px;">${l.id}</td>
            <td>${escapeHtml(l.title)}</td>
            <td>${escapeHtml(l.category ? `${l.category} ${categoryLabelByValue[l.category] ? `(${categoryLabelByValue[l.category]})` : ""}` : "-")}</td>
            <td class="price">${l.price}</td>
            <td>${l.rooms ?? "-"}</td>
            <td>
              <a href="${escapeHtml(l.url)}" target="_blank" style="color:#007bff; text-decoration:none;">открыть</a>
              <br/>
              <a href="/history/${l.id}" target="_blank" style="color:#666; text-decoration:none; font-size:12px;">история</a>
            </td>
            <td>${l.isActive ? "✅" : "❌"}</td>
          </tr>
        `).join("")}
      </table>
    </div>
  </div>

  <script>
    function normalizeSortValue(value, type) {
      const text = String(value ?? "").trim();

      if (type === "number") {
        const cleaned = text.replace(/[^\d,.-]/g, "").replace(",", ".");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
      }

      if (type === "boolean") {
        return /^(✅|true|yes|да|1)$/i.test(text) ? 1 : 0;
      }

      return text.toLocaleLowerCase("ru");
    }

    function renumberTable(table) {
      const rows = Array.from(table.querySelectorAll("tr")).slice(1);
      rows.forEach((row, index) => {
        const firstCell = row.cells[0];
        if (firstCell) {
          firstCell.textContent = String(index + 1);
        }
      });
    }

    function sortTableByHeader(th) {
      const table = th.closest("table");
      if (!table) return;

      const type = th.dataset.sortType || "string";
      const headers = Array.from(table.querySelectorAll("th"));
      const index = headers.indexOf(th);
      if (index < 0) return;

      const currentDir = th.dataset.sortDir === "asc" ? "asc" : th.dataset.sortDir === "desc" ? "desc" : "";
      const nextDir = currentDir === "asc" ? "desc" : "asc";

      headers.forEach((header) => {
        if (header !== th) {
          delete header.dataset.sortDir;
        }
      });
      th.dataset.sortDir = nextDir;

      const bodyRows = Array.from(table.querySelectorAll("tr")).slice(1);
      const sortedRows = bodyRows.sort((left, right) => {
        const leftCell = left.cells[index];
        const rightCell = right.cells[index];
        const leftValue = normalizeSortValue(leftCell ? leftCell.textContent : "", type);
        const rightValue = normalizeSortValue(rightCell ? rightCell.textContent : "", type);

        if (leftValue < rightValue) return nextDir === "asc" ? -1 : 1;
        if (leftValue > rightValue) return nextDir === "asc" ? 1 : -1;
        return 0;
      });

      sortedRows.forEach((row) => table.appendChild(row));
      renumberTable(table);
    }

    function initTableSorting() {
      document.querySelectorAll("th.sortable").forEach((th) => {
        th.addEventListener("click", () => sortTableByHeader(th));
      });
    }

    async function runSync() {
      const el = document.getElementById("sync-result");
      el.innerText = " Синхронизация...";

      try {
        const res = await fetch("/sync");
        const data = await res.json();
        el.innerText = " ✅ Готово: " + JSON.stringify(data);
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        el.innerText = " ❌ Ошибка";
      }
    }

    initTableSorting();
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
      name: body.name ? String(body.name).trim() || null : null,
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
      category: body.category || null,
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

  let html = "<html><head><meta charset='UTF-8' /></head>";
  html += "<body style='font-family: Arial; padding: 20px'>";
  html += "<h2>История цен</h2>";
  
  for (const h of history) {
    html += "<div>" + h.price + " — " + new Date(h.createdAt).toLocaleString() + "</div>";
  }
  
  html += "</body></html>";

  reply.type("text/html; charset=utf-8").send(html);
});

app.get("/test-tg", async () => {
  const users = await prisma.user.findMany();

  for (const user of users) {
    await sendTelegram(
      "TEST FROM RENDER",
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
