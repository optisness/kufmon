import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import { prisma } from "./db.js";
import { fetchKufarMap, saveKufarAds, KUFAR_CATEGORIES } from "./kufar.js";
import { startCron } from "./cron.js";
import { sendTelegram } from "./telegram.js";
import { logger } from "./logger.js";
import { metrics, incMetric } from "./metrics.js";
import { formatRoomsList, getSubscriptionFilters, matchesSubscriptionListing } from "./subscriptions.js";
import { formatEventSummary } from "./listingEvents.js";
import { buildTelegramListingUrl } from "./telegramMessage.js";

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

const CATEGORY_LABEL_BY_VALUE: Record<string, string> = {
  [KUFAR_CATEGORIES.apartments]: "Квартиры (1010)",
  [KUFAR_CATEGORIES.houses]: "Дома (1020)",
  [KUFAR_CATEGORIES.commercial]: "Коммерция (1050)",
  [KUFAR_CATEGORIES.land]: "Земля (1080)",
};

function parseOptionalNumber(value: any) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRoomsSelection(value: any) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  return source
    .flatMap((item) => String(item).split(","))
    .map((item) => {
      const text = item.trim();
      if (!text) return null;
      if (text === "5+") return "5+";
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed > 0 ? String(Math.trunc(parsed)) : null;
    })
    .filter((room): room is string => room != null);
}

function formatPrice(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  return `$${String(value)}`;
}

function splitMessageChunks(text: string, chunkSize = 3500) {
  return text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, "g")) || [];
}

function buildListingPreview(listing: any, categoryLabelByValue: Record<string, string>) {
  const categoryLabel = listing.category
    ? `${listing.category}${categoryLabelByValue[listing.category] ? ` (${categoryLabelByValue[listing.category]})` : ""}`
    : "-";
  const canonicalUrl = buildTelegramListingUrl({
    url: listing.url,
    category: listing.category ?? null,
  });

  return [
    `${listing.title}`,
    `Цена: ${formatPrice(listing.price)}`,
    `Комнаты: ${listing.rooms ?? "-"}`,
    `Категория: ${categoryLabel}`,
    `Ссылка: ${canonicalUrl}`,
  ].join("\n");
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

async function cleanupStaleListings() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  await prisma.listing.deleteMany({
    where: {
      isActive: false,
      lastSeenAt: { lt: cutoff },
    },
  });
}

function buildAdminNav(activePath: string) {
  const items = [
    { href: "/ui", label: "Обзор" },
    { href: "/ui/users", label: "Пользователи" },
    { href: "/ui/subscriptions", label: "Подписки" },
    { href: "/ui/listings", label: "Объявления" },
  ];

  return items.map((item) => {
    const isActive = activePath === item.href;
    return `<a href="${item.href}"${isActive ? ' style="background:#0056b3;"' : ""}>${item.label}</a>`;
  }).join("");
}

function renderAdminLayout(options: {
  title: string;
  activePath: string;
  body: string;
}) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(options.title)}</title>
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
    .compact-form { display: grid; gap: 10px; }
    .compact-form .form-group { margin-bottom: 0; }
    .rooms-options { display:flex; gap:12px; flex-wrap:wrap; padding-top:6px; }
    .rooms-options label { display:flex; align-items:center; gap:6px; font-weight:normal; margin-bottom:0; }
    .page-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .page-card { background:#f9f9f9; border:1px solid #e6e6e6; border-radius:10px; padding:16px; }
    .page-card h3 { margin-top:0; }
    .page-card a { color:#007bff; text-decoration:none; }
    .page-card a:hover { text-decoration:underline; }
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
        ${buildAdminNav(options.activePath)}
      </div>
    </div>
    ${options.body}
  </div>
  <script>
    function normalizeSortValue(value, type) {
      const text = String(value ?? "").trim();

      if (type === "number") {
        const cleaned = text.replace(/[^\\d,.-]/g, "").replace(",", ".");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
      }

      if (type === "boolean") {
        return /^(✅|true|yes|да|1)$/i.test(text) ? 1 : 0;
      }

      return text.toLocaleLowerCase("ru");
    }

    function getSortValue(cell, type) {
      if (!cell) return type === "number" ? Number.NEGATIVE_INFINITY : "";

      if (cell.dataset && cell.dataset.sortValue != null) {
        return normalizeSortValue(cell.dataset.sortValue, type);
      }

      return normalizeSortValue(cell.textContent, type);
    }

    function renumberTable(table) {
      const body = table.tBodies[0] || table;
      const rows = Array.from(body.rows || body.querySelectorAll("tr"));
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

      const body = table.tBodies[0] || table.createTBody();
      const bodyRows = Array.from(body.rows);
      const sortedRows = bodyRows.sort((left, right) => {
        const leftCell = left.cells[index];
        const rightCell = right.cells[index];
        const leftValue = getSortValue(leftCell, type);
        const rightValue = getSortValue(rightCell, type);

        if (leftValue < rightValue) return nextDir === "asc" ? -1 : 1;
        if (leftValue > rightValue) return nextDir === "asc" ? 1 : -1;
        return 0;
      });

      sortedRows.forEach((row) => body.appendChild(row));
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
</html>`;
}

function renderOverviewPage() {
  return renderAdminLayout({
    title: "Kufmon Admin UI",
    activePath: "/ui",
    body: `
    <div class="section">
      <h2>Обзор</h2>
      <div class="page-grid">
        <div class="page-card">
          <h3>Пользователи</h3>
          <p>Отдельная страница для списка и добавления пользователей.</p>
          <a href="/ui/users">Открыть пользователей</a>
        </div>
        <div class="page-card">
          <h3>Подписки</h3>
          <p>Отдельная страница для фильтров и списка подписок.</p>
          <a href="/ui/subscriptions">Открыть подписки</a>
        </div>
        <div class="page-card">
          <h3>Объявления</h3>
          <p>Отдельная страница для таблицы объявлений и истории.</p>
          <a href="/ui/listings">Открыть объявления</a>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Синхронизация</h2>
      <button onclick="runSync()">▶ Запустить sync</button>
      <span id="sync-result"></span>
    </div>
    `,
  });
}

function renderUsersPage(users: any[]) {
  return renderAdminLayout({
    title: "Пользователи",
    activePath: "/ui/users",
    body: `
    <div class="section">
      <h2>Пользователи</h2>
      <h3>Создать пользователя</h3>
      <form method="POST" action="/users" class="compact-form" style="grid-template-columns: 1fr 1fr auto; align-items:end;">
        <input type="hidden" name="returnTo" value="/ui/users" />
        <div class="form-group">
          <label>Имя / название пользователя</label>
          <input name="name" placeholder="Например, Иван или Агентство А" required />
        </div>
        <div class="form-group">
          <label>Telegram Chat ID</label>
          <input name="chatId" placeholder="e.g., 123456789" required />
        </div>
        <button type="submit">Создать пользователя</button>
      </form>

      <h3>Существующие пользователи</h3>
      <table data-sort-table="users">
        <thead>
          <tr>
            <th>№</th>
            <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="name">Имя / название</th>
            <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="chatId">Chat ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map((u, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(u.name?.trim() || "-")}</td>
              <td>${escapeHtml(u.telegramChatId)}</td>
              <td>
                <form method="POST" action="/users/delete" onsubmit="return confirm('Удалить пользователя?')" style="display:inline;">
                  <input type="hidden" name="id" value="${u.id}" />
                  <input type="hidden" name="returnTo" value="/ui/users" />
                  <button type="submit" class="btn-danger" style="padding:5px 10px;">Удалить</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    `,
  });
}

function renderSubscriptionFormMarkup(options: {
  userOptions: string;
  categoryOptionMarkup: string;
}) {
  return `
      <h3>Создать подписку</h3>
      <form method="POST" action="/subscriptions" class="compact-form subscriptions-form" style="max-width: 1200px;">
        <input type="hidden" name="returnTo" value="/ui/subscriptions" />
        <div class="form-row" style="grid-template-columns: 1.2fr 1fr 0.8fr;">
          <div class="form-group">
            <label>Название подписки</label>
            <input name="name" placeholder="e.g., Minsk 2 rooms" />
          </div>
          <div class="form-group">
            <label>User ID</label>
            <select name="userId" required>
              ${options.userOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Интервал (минуты)</label>
            <input name="intervalMinutes" type="number" value="30" required />
          </div>
        </div>
        <div class="form-row" style="grid-template-columns: 1fr 1fr 1.8fr auto; align-items:end;">
          <div class="form-group">
            <label>Категория поиска</label>
            <select name="category" required>
              ${options.categoryOptionMarkup}
            </select>
          </div>
          <div class="form-group">
            <label>Max price (optional)</label>
            <input name="maxPrice" type="number" list="price-presets" placeholder="Например, 80000" />
            <datalist id="price-presets">
              <option value="30000"></option>
              <option value="50000"></option>
              <option value="70000"></option>
              <option value="100000"></option>
              <option value="150000"></option>
              <option value="200000"></option>
            </datalist>
          </div>
          <div class="form-group">
            <label>Rooms (optional)</label>
            <div class="rooms-options">
              ${[1, 2, 3, 4, "5+"].map((room) => `
                <label>
                  <input type="checkbox" name="rooms" value="${room}" />
                  ${room}
                </label>
              `).join("")}
            </div>
            <small style="color:#666;">Можно выбрать несколько вариантов.</small>
          </div>
          <div class="form-group" style="display:flex; align-items:end;">
            <button type="submit">Создать подписку</button>
          </div>
        </div>
      </form>
  `;
}

function renderSubscriptionsPage(options: {
  subscriptions: any[];
  usersById: Map<string, any>;
  subscriptionFiltersById: Map<string, ReturnType<typeof getSubscriptionFilters>>;
  categoryLabelByValue: Record<string, string>;
  userOptions: string;
  categoryOptionMarkup: string;
}) {
  return renderAdminLayout({
    title: "Подписки",
    activePath: "/ui/subscriptions",
    body: `
    <div class="section">
      <h2>Подписки</h2>
      <p><em>Подписка привязана к пользователю и задаёт дополнительные фильтры для уведомлений.</em></p>
      ${renderSubscriptionFormMarkup({
        userOptions: options.userOptions,
        categoryOptionMarkup: options.categoryOptionMarkup,
      })}

      <h3>Существующие подписки</h3>
      <table data-sort-table="subscriptions">
        <thead>
          <tr>
            <th>№</th>
            <th>ID</th>
            <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="name">Name</th>
            <th class="sortable" data-sortable="true" data-sort-type="string" data-sort-key="owner">Owner</th>
            <th>Category</th>
            <th>Max price</th>
            <th>Rooms</th>
            <th class="sortable" data-sortable="true" data-sort-type="number" data-sort-key="interval">Interval</th>
            <th class="sortable" data-sortable="true" data-sort-type="boolean" data-sort-key="enabled">Enabled</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${options.subscriptions.map((s, index) => `
            <tr>
              <td>${index + 1}</td>
              <td style="font-size:12px; max-width:100px; word-break:break-all;">${s.id}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.userId ? getUserDisplayName(options.usersById.get(s.userId)) : "-")}</td>
              <td>${escapeHtml(s.category ? `${s.category} ${options.categoryLabelByValue[s.category] ? `(${options.categoryLabelByValue[s.category]})` : ""}` : "-")}</td>
              <td>${options.subscriptionFiltersById.get(s.id)?.maxPrice != null ? `$${options.subscriptionFiltersById.get(s.id)?.maxPrice}` : "-"}</td>
              <td>${escapeHtml(formatRoomsList(options.subscriptionFiltersById.get(s.id)?.rooms))}</td>
              <td>${s.intervalMinutes} мин</td>
              <td>${s.enabled ? '✅' : '❌'}</td>
              <td>
                <form method="POST" action="/subscriptions/delete" onsubmit="return confirm('Удалить подписку?')" style="display:inline;">
                  <input type="hidden" name="id" value="${s.id}" />
                  <input type="hidden" name="returnTo" value="/ui/subscriptions" />
                  <button type="submit" class="btn-danger" style="padding:5px 10px;">Удалить</button>
                </form>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `,
  });
}

function renderListingsPage(options: {
  listings: any[];
  categoryLabelByValue: Record<string, string>;
}) {
  return renderAdminLayout({
    title: "Объявления",
    activePath: "/ui/listings",
    body: `
    <div class="section">
      <h2>Объявления</h2>
      <p>Последние 50 объявлений</p>
      <table data-sort-table="listings">
        <thead>
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
        </thead>
        <tbody>
          ${options.listings.map((l, index) => `
            <tr>
              <td>${index + 1}</td>
              <td style="font-size:11px;">${l.id}</td>
              <td>${escapeHtml(l.title)}</td>
              <td>${escapeHtml(l.category ? `${l.category} ${options.categoryLabelByValue[l.category] ? `(${options.categoryLabelByValue[l.category]})` : ""}` : "-")}</td>
              <td class="price" data-sort-value="${escapeHtml(l.price)}">$${l.price}</td>
              <td>${l.rooms ?? "-"}</td>
              <td>
                <a href="${escapeHtml(buildTelegramListingUrl({ url: l.url, category: l.category ?? null }))}" target="_blank" style="color:#007bff; text-decoration:none;">открыть</a>
                <br/>
                <a href="/history/${l.id}" target="_blank" style="color:#666; text-decoration:none; font-size:12px;">история</a>
              </td>
              <td>${l.isActive ? "✅" : "❌"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    `,
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

app.get("/ui", async (_req, reply) => {
  reply.type("text/html; charset=utf-8").send(renderOverviewPage());
});

app.get("/ui/users", async (_req, reply) => {
  await cleanupStaleListings();
  const users = sortUsers(await prisma.user.findMany());
  reply.type("text/html; charset=utf-8").send(renderUsersPage(users));
});

app.get("/ui/subscriptions", async (_req, reply) => {
  await cleanupStaleListings();
  const users = sortUsers(await prisma.user.findMany());
  const usersById = new Map(users.map((user) => [user.id, user]));
  const subscriptions = sortSubscriptions(
    await prisma.subscription.findMany({ take: 50, orderBy: { createdAt: "desc" } }),
    usersById,
  );
  const subscriptionFiltersById = new Map(
    subscriptions.map((subscription) => [subscription.id, getSubscriptionFilters(subscription)]),
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

  reply.type("text/html; charset=utf-8").send(renderSubscriptionsPage({
    subscriptions,
    usersById,
    subscriptionFiltersById,
    categoryLabelByValue,
    userOptions,
    categoryOptionMarkup,
  }));
});

app.get("/ui/listings", async (_req, reply) => {
  await cleanupStaleListings();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const listings = await prisma.listing.findMany({
    take: 50,
    where: {
      OR: [
        { isActive: true },
        { lastSeenAt: { gte: cutoff } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const categoryOptions = [
    { value: KUFAR_CATEGORIES.apartments, label: "Квартиры (1010)" },
    { value: KUFAR_CATEGORIES.houses, label: "Дома (1020)" },
    { value: KUFAR_CATEGORIES.commercial, label: "Коммерция (1050)" },
    { value: KUFAR_CATEGORIES.land, label: "Земля (1080)" },
  ];
  const categoryLabelByValue = Object.fromEntries(
    categoryOptions.map((option) => [option.value, option.label]),
  );

  reply.type("text/html; charset=utf-8").send(renderListingsPage({ listings, categoryLabelByValue }));
});

app.post("/users", async (req: any, reply) => {
  const body = req.body;
  const returnTo = typeof body.returnTo === "string" && body.returnTo ? body.returnTo : "/ui/users";

  await prisma.user.create({
    data: {
      name: body.name ? String(body.name).trim() || null : null,
      telegramChatId: body.chatId,
    },
  });

  reply.redirect(returnTo);
});

app.post("/subscriptions", async (req: any, reply) => {
  const body = req.body;
  const returnTo = typeof body.returnTo === "string" && body.returnTo ? body.returnTo : "/ui/subscriptions";
  const userId = body.userId || null;
  const maxPrice = parseOptionalNumber(body.maxPrice);
  const rooms = parseRoomsSelection(body.rooms);
  const intervalMinutes = parseOptionalNumber(body.intervalMinutes) ?? 30;

  const subscription = await prisma.subscription.create({
    data: {
      name: body.name || "unnamed",
      userId,
      category: body.category || null,
      maxPrice,
      rooms,
      intervalMinutes,
    },
  });

  if (subscription.userId) {
    const user = await prisma.user.findUnique({
      where: { id: subscription.userId },
    });

    if (user) {
      const cutoff = new Date(Date.now() - subscription.intervalMinutes * 60_000);
      const recentListings = await prisma.listing.findMany({
        where: {
          lastSeenAt: { gte: cutoff },
          isActive: true,
        },
        orderBy: [
          { lastSeenAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 50,
      });

      const matchingListings = recentListings.filter((listing) =>
        matchesSubscriptionListing(subscription, {
          price: listing.price,
          rooms: listing.rooms,
          category: listing.category,
        }),
      );

      if (matchingListings.length > 0) {
        const chunks = splitMessageChunks(
          matchingListings
            .map((listing) => buildListingPreview(listing, CATEGORY_LABEL_BY_VALUE))
            .join("\n\n"),
        );

        for (const chunk of chunks) {
          await sendTelegram(chunk, user.telegramChatId);
        }
      }
    }
  }

  reply.redirect(returnTo);
});

app.post('/subscriptions/delete', async (req: any, reply) => {
  const id = req.body.id;
  const returnTo = typeof req.body.returnTo === "string" && req.body.returnTo ? req.body.returnTo : "/ui/subscriptions";

  await prisma.subscription.delete({ where: { id } });

  reply.redirect(returnTo);
});

app.post("/users/delete", async (req: any, reply) => {
  const id = req.body.id;
  const returnTo = typeof req.body.returnTo === "string" && req.body.returnTo ? req.body.returnTo : "/ui/users";

  await prisma.user.delete({
    where: { id },
  });

  reply.redirect(returnTo);
});

app.get("/history/:id", async (req: any, reply) => {
  const id = req.params.id;

  const history = await prisma.adEvent.findMany({
    where: { listingId: id },
    orderBy: { createdAt: "asc" },
  });

  let html = "<html><head><meta charset='UTF-8' /></head>";
  html += "<body style='font-family: Arial; padding: 20px'>";
  html += "<h2>История изменений</h2>";
  
  if (history.length === 0) {
    html += "<div>Нет событий</div>";
  }

  for (const event of history) {
    html += "<div style='margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #ddd;'>";
    html += "<div><strong>" + escapeHtml(event.eventType) + "</strong> — " + new Date(event.createdAt).toLocaleString() + "</div>";
    html += "<pre style='margin:8px 0 0; white-space:pre-wrap; font-family:inherit;'>" + escapeHtml(formatEventSummary(event.eventType, event.changesJson)) + "</pre>";
    html += "</div>";
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
