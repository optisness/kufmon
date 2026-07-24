import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import { prisma } from "./db.js";
import { fetchKufarMap, saveKufarAds, KUFAR_CATEGORIES } from "./kufar.js";
import { startCron } from "./cron.js";
import { sendTelegram } from "./telegram.js";
import { logger } from "./logger.js";
import { metrics, incMetric } from "./metrics.js";
import { formatRoomsList, getSubscriptionFilters, matchesSubscriptionListing, normalizeSource } from "./subscriptions.js";
import { formatEventSummary } from "./listingEvents.js";
import { formatListingAttemptCount, formatListingEventAt } from "./listingTable.js";
import {
  ADMIN_LOGIN_LOCK_MS,
  ADMIN_SESSION_COOKIE,
  buildAdminSessionCookie,
  buildClearedAdminSessionCookie,
  clearAdminLoginState,
  getAdminLoginLockState,
  getAdminPasswordConfigured,
  isAdminAuthenticated,
  recordAdminLoginFailure,
} from "./adminAuth.js";
import {
  BILLING_PLANS,
  enforceSearchSubscriptionLimits,
  formatBillingPlanLabel,
  getBillingPlan,
  getBillingPlanOptions,
  getDefaultBillingExpiresAt,
  persistUserBillingState,
} from "./billing.js";
import { formatTelegramBatchMessage } from "./telegramMessage.js";
import { buildTelegramListingUrl } from "./telegramMessage.js";
import {
  buildPaginationMeta,
  buildPaginationUrl,
  getDisplayRowNumber,
  parsePositiveInt,
} from "./adminPagination.js";
import {
  buildSortUrl,
  getListingsOrderBy,
  getSubscriptionsOrderBy,
  getUsersOrderBy,
  nextSortDirection,
  parseAdminSortState,
} from "./adminSorting.js";

const app = Fastify({
  logger,
});

app.addHook("onRequest", async (request, reply) => {
  const path = String(request.raw.url ?? "/").split("?")[0];
  const publicPaths = new Set(["/", "/login", "/logout", "/health", "/apply"]);
  if (publicPaths.has(path)) return;

  const isAuthenticated = isAdminAuthenticated(request.headers.cookie);
  if (isAuthenticated) return;

  const apiPaths = ["/metrics", "/kufar", "/sync", "/test-tg"];
  if (apiPaths.includes(path) || path.startsWith("/api/")) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }

  reply.redirect("/");
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

const ADMIN_PAGE_SIZE = 50;

const CATEGORY_LABEL_BY_VALUE: Record<string, string> = {
  [KUFAR_CATEGORIES.apartments]: "Квартира",
  [KUFAR_CATEGORIES.houses]: "Дом",
  [KUFAR_CATEGORIES.commercial]: "Коммерция",
  [KUFAR_CATEGORIES.land]: "Участок",
};

const SOURCE_LABEL_BY_VALUE: Record<string, string> = {
  "kufar.by": "kufar.by",
};

const SOURCE_OPTIONS = [
  { value: "kufar.by", label: "kufar.by" },
];

const NOTIFICATION_MODE_OPTIONS = [
  { value: "new_and_changed", label: "Новые и изменения" },
  { value: "new_only", label: "Только новые" },
];

function parseOptionalNumber(value: any) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseListingsFilterState(query: Record<string, unknown>) {
  const seller = query.seller === "private" || query.seller === "company" ? query.seller : "all";
  const status = query.status === "active" || query.status === "inactive" ? query.status : "all";

  return {
    seller,
    status,
    priceMin: parseOptionalNumber(query.priceMin),
    priceMax: parseOptionalNumber(query.priceMax),
  };
}

function buildListingsWhere(filters: ReturnType<typeof parseListingsFilterState>, cutoff: Date) {
  const andConditions: any[] = [
    {
      OR: [
        { isActive: true },
        { lastSeenAt: { gte: cutoff } },
      ],
    },
  ];

  if (filters.seller === "private" || filters.seller === "company") {
    andConditions.push({ sellerType: filters.seller });
  }

  if (filters.status === "active") {
    andConditions.push({ isActive: true });
  } else if (filters.status === "inactive") {
    andConditions.push({ isActive: false });
  }

  if (filters.priceMin != null) {
    andConditions.push({ price: { gte: filters.priceMin } });
  }

  if (filters.priceMax != null) {
    andConditions.push({ price: { lte: filters.priceMax } });
  }

  return andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
}

function renderPaginationControls(options: {
  basePath: string;
  query: Record<string, unknown>;
  meta: ReturnType<typeof buildPaginationMeta>;
  itemLabel: string;
}) {
  if (options.meta.pageCount <= 1) return "";

  const previousUrl = options.meta.hasPrevious
    ? buildPaginationUrl(options.basePath, options.query, options.meta.page - 1, options.meta.pageSize)
    : "#";
  const nextUrl = options.meta.hasNext
    ? buildPaginationUrl(options.basePath, options.query, options.meta.page + 1, options.meta.pageSize)
    : "#";

  return `
    <div class="pagination">
      <div class="pagination-summary">
        Показаны ${options.meta.from}-${options.meta.to} из ${options.meta.totalItems} ${options.itemLabel}
      </div>
      <div class="pagination-links">
        <a class="pagination-link${options.meta.hasPrevious ? "" : " disabled"}" href="${escapeHtml(previousUrl)}">← Предыдущая</a>
        <span class="pagination-current">Страница ${options.meta.page} из ${options.meta.pageCount}</span>
        <a class="pagination-link${options.meta.hasNext ? "" : " disabled"}" href="${escapeHtml(nextUrl)}">Следующая →</a>
      </div>
    </div>
  `;
}

function renderSortableHeader(
  label: string,
  key: string,
  type: "string" | "number" | "boolean",
  currentSort: { key: string; direction: "asc" | "desc" } | null,
  className = "",
) {
  const sortDir = currentSort?.key === key ? currentSort.direction : undefined;
  return `<th class="sortable${className ? ` ${className}` : ""}" data-sortable="true" data-sort-type="${type}" data-sort-key="${escapeHtml(key)}"${sortDir ? ` data-sort-dir="${sortDir}"` : ""}>${escapeHtml(label)}</th>`;
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

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
}

function formatDateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatLastEventLabel(event: { eventType: string; createdAt: string | Date } | null | undefined) {
  if (!event) return "—";
  return formatListingEventAt(event.createdAt);
}

function getLastEventColor(eventType: string | undefined | null) {
  if (eventType === "NEW") return "#2563eb";
  if (eventType === "CHANGED") return "#d97706";
  if (eventType === "REMOVED") return "#dc2626";
  return "#6b7280";
}

function renderLastEventCell(event: { eventType: string; createdAt: string | Date } | null | undefined) {
  if (!event) return "<span style=\"color:#9ca3af;\">—</span>";
  return `<span style="color:${getLastEventColor(event.eventType)}; font-weight:600;">${escapeHtml(formatListingEventAt(event.createdAt))}</span>`;
}

function renderHistorySummaryHtml(summary: string) {
  const escaped = escapeHtml(summary);
  return escaped
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/\n/g, "<br />");
}

function compareLastEventDates(
  a: { id: string; createdAt: Date; lastSeenAt: Date; isActive: boolean },
  b: { id: string; createdAt: Date; lastSeenAt: Date; isActive: boolean },
  latestEventByListingId: Map<string, { createdAt: Date }>,
  direction: "asc" | "desc",
) {
  const eventA = latestEventByListingId.get(a.id)?.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const eventB = latestEventByListingId.get(b.id)?.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (eventA !== eventB) {
    return direction === "asc" ? eventA - eventB : eventB - eventA;
  }

  const createdA = a.createdAt.getTime();
  const createdB = b.createdAt.getTime();
  if (createdA !== createdB) {
    return createdB - createdA;
  }

  return a.id.localeCompare(b.id);
}

function buildPlanOptionMarkup(selectedPlanId?: string | null) {
  return getBillingPlanOptions()
    .map((plan) => {
      const selected = selectedPlanId === plan.value ? " selected" : "";
      return `<option value="${escapeHtml(plan.value)}"${selected}>${escapeHtml(plan.label)}</option>`;
    })
    .join("");
}

function buildOptionsMarkup(options: Array<{ value: string; label: string }>, selectedValue?: string | null) {
  return options
    .map((option) => {
      const selected = selectedValue === option.value ? " selected" : "";
      return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
}

function splitMessageChunks(text: string, chunkSize = 3500) {
  return text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, "g")) || [];
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
    { href: "/ui/users", label: "Пользователи" },
    { href: "/ui/subscriptions", label: "Подписки" },
    { href: "/ui/listings", label: "Объявления" },
    { href: "/health", label: "Health" },
    { href: "/sync", label: "Sync" },
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
    .btn-success { background: #28a745; }
    .btn-success:hover { background: #218838; }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    .price { font-weight: bold; color: #28a745; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    .compact-form { display: grid; gap: 10px; }
    .compact-form .form-group { margin-bottom: 0; }
    .filters-form { gap: 8px; }
    .filters-form .form-row { gap: 10px; }
    .filters-form .form-group { margin-bottom: 0; }
    .filters-form label { margin-bottom: 4px; font-size: 12px; }
    .filters-form input, .filters-form select { padding: 6px 8px; font-size: 13px; }
    .filters-form button, .filters-form a { padding: 8px 14px; font-size: 13px; }
    .rooms-options { display:flex; gap:12px; flex-wrap:wrap; padding-top:6px; }
    .rooms-options label { display:flex; align-items:center; gap:6px; font-weight:normal; margin-bottom:0; }
    .page-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .page-card { background:#f9f9f9; border:1px solid #e6e6e6; border-radius:10px; padding:16px; }
    .page-card h3 { margin-top:0; }
    .page-card a { color:#007bff; text-decoration:none; }
    .page-card a:hover { text-decoration:underline; }
    .pagination { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid #e6e6e6; flex-wrap:wrap; }
    .pagination-summary { color:#666; font-size:14px; }
    .pagination-links { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .pagination-link { display:inline-flex; align-items:center; justify-content:center; padding:8px 12px; border:1px solid #ddd; border-radius:6px; color:#007bff; text-decoration:none; background:#fff; }
    .pagination-link:hover { background:#f5f9ff; }
    .pagination-link.disabled { pointer-events:none; color:#999; background:#f7f7f7; }
    .pagination-current { font-weight:bold; color:#333; }
    .listing-row.inactive td { background:#ffe9e9; }
    .listing-row.inactive:hover td { background:#ffdede; }
    .attempt-column { width:64px; text-align:center; }
    .center-column, th.center-column { text-align:center; }
    .event-column { white-space:nowrap; }
    .id-column { font-family: monospace; font-size:11px; color:#8a8a8a; white-space:nowrap; }
    .compact-badge { display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1.2; background:#f3f4f6; color:#222; }
    .compact-badge.category { background:#eef2ff; color:#3730a3; }
    .compact-badge.private { background:#fbe7e7; color:#9b1c1c; }
    .compact-badge.company { background:#e7f0fb; color:#1d4ed8; }
    .compact-badge.unknown { background:#f4f4f4; color:#666; }
    .link-icons { display:flex; gap:10px; align-items:center; }
    .link-icons a { text-decoration:none; font-size:16px; line-height:1; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Kufmon Admin UI</h1>
      <div class="nav">
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

    function sortTableByHeader(th) {
      const key = th.dataset.sortKey;
      if (!key) return;

      const url = new URL(window.location.href);
      const currentKey = url.searchParams.get("sort");
      const currentDir = url.searchParams.get("dir") || "";
      const nextDir = currentKey === key && currentDir === "asc" ? "desc" : "asc";

      url.searchParams.set("sort", key);
      url.searchParams.set("dir", nextDir);
      url.searchParams.set("page", "1");

      window.location.href = url.toString();
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

async function getServiceStatus() {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (_error) {
    dbOk = false;
  }

  return {
    db: dbOk,
    telegram: !!process.env.TELEGRAM_TOKEN,
    adminPassword: getAdminPasswordConfigured(),
    uptime: process.uptime(),
  };
}

function renderLandingPage(options: {
  status: Awaited<ReturnType<typeof getServiceStatus>>;
  error?: string | null;
  lockedUntil?: number;
  authenticated?: boolean;
}) {
  const now = Date.now();
  const lockedUntil = options.lockedUntil ?? 0;
  const remainingMs = Math.max(0, lockedUntil - now);
  const lockedMinutes = remainingMs > 0 ? Math.ceil(remainingMs / 60_000) : 0;
  const authenticated = Boolean(options.authenticated);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Kufmon Admin Login</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; min-height: 100vh; background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 40px 20px 60px; }
    .hero { display:grid; gap:20px; grid-template-columns: 1.2fr 0.8fr; align-items:stretch; }
    .panel { background: rgba(15, 23, 42, 0.88); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.3); backdrop-filter: blur(10px); }
    h1 { margin: 0 0 8px; font-size: 40px; line-height: 1.05; }
    h2 { margin: 0 0 12px; font-size: 22px; color: #f8fafc; }
    p { margin: 0; color: #cbd5e1; line-height: 1.55; }
    .status-list { display:grid; gap:10px; margin-top: 18px; }
    .status-item { display:flex; justify-content:space-between; gap:16px; padding:12px 14px; border-radius: 12px; background: rgba(30, 41, 59, 0.75); }
    .status-item strong { color:#fff; }
    .pill { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background: rgba(59, 130, 246, 0.15); color: #bfdbfe; font-size: 13px; }
    .pill.ok { background: rgba(34, 197, 94, 0.18); color: #bbf7d0; }
    .pill.bad { background: rgba(239, 68, 68, 0.18); color: #fecaca; }
    .login-box { display:grid; gap:14px; }
    label { display:block; margin-bottom:8px; color:#e2e8f0; font-weight:600; }
    input { width:100%; box-sizing:border-box; padding:12px 14px; border-radius:12px; border:1px solid rgba(148, 163, 184, 0.28); background: rgba(15, 23, 42, 0.95); color:#fff; font-size:16px; }
    input:focus { outline:none; border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56, 189, 248, 0.15); }
    button { width:100%; padding:12px 14px; border:none; border-radius:12px; background:#38bdf8; color:#082f49; font-weight:700; font-size:16px; cursor:pointer; }
    button:hover { background:#0ea5e9; }
    button:disabled, input:disabled { opacity:0.55; cursor:not-allowed; }
    .hint { font-size: 13px; color: #94a3b8; }
    .error { padding: 12px 14px; border-radius: 12px; background: rgba(239, 68, 68, 0.14); color: #fecaca; border: 1px solid rgba(239, 68, 68, 0.28); }
    .success { padding: 12px 14px; border-radius: 12px; background: rgba(34, 197, 94, 0.14); color: #bbf7d0; border: 1px solid rgba(34, 197, 94, 0.25); }
    .footer { margin-top: 18px; font-size: 13px; color: #94a3b8; }
    @media (max-width: 760px) { .hero { grid-template-columns: 1fr; } h1 { font-size: 32px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="panel">
        <div class="pill ${options.status.db ? "ok" : "bad"}">DB ${options.status.db ? "готова" : "недоступна"}</div>
        <h1>Kufmon</h1>
        <p>Статус сервиса и вход в админку владельца. После успешного пароля вы перейдёте сразу к пользователям.</p>
        <div class="status-list">
          <div class="status-item"><span>Сервис</span><strong>Running</strong></div>
          <div class="status-item"><span>База</span><strong>${options.status.db ? "OK" : "Error"}</strong></div>
          <div class="status-item"><span>Telegram</span><strong>${options.status.telegram ? "OK" : "Not configured"}</strong></div>
          <div class="status-item"><span>Пароль</span><strong>${options.status.adminPassword ? "Configured" : "Missing"}</strong></div>
          <div class="status-item"><span>Uptime</span><strong>${Math.floor(options.status.uptime)}s</strong></div>
        </div>
      </div>
      <div class="panel">
        <h2>${authenticated ? "Вход выполнен" : "Вход администратора"}</h2>
        ${options.error ? `<div class="error">${escapeHtml(options.error)}</div>` : ""}
        ${lockedUntil > now ? `<div class="error">Ввод пароля заблокирован на ${lockedMinutes} мин.</div>` : ""}
        ${authenticated ? `<div class="success">Сессия активна. Можно перейти в админку.</div>` : ""}
        <form method="POST" action="/login" class="login-box" ${lockedUntil > now ? "aria-disabled=\"true\"" : ""}>
          <div>
            <label for="password">Пароль</label>
            <input id="password" name="password" type="password" placeholder="Введите пароль администратора" ${lockedUntil > now ? "disabled" : ""} required />
          </div>
          <button type="submit" ${lockedUntil > now ? "disabled" : ""}>Войти</button>
        </form>
        ${authenticated ? `<div class="footer"><a href="/ui/users" style="color:#7dd3fc; text-decoration:none;">Перейти к пользователям →</a></div>` : `<div class="footer">После 3 неверных попыток вход блокируется на 5 минут.</div>`}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderHealthPage(options: {
  status: Awaited<ReturnType<typeof getServiceStatus>>;
}) {
  const statusLabel = options.status.db ? "OK" : "Error";
  const telegramLabel = options.status.telegram ? "Configured" : "Not configured";
  const adminPasswordLabel = options.status.adminPassword ? "Configured" : "Missing";

  return renderAdminLayout({
    title: "Health",
    activePath: "/health",
    body: `
    <div class="section">
      <h2>Состояние сервиса</h2>
      <p>Публичная проверка для Render и удобная ручная диагностика.</p>
      <div class="page-grid" style="margin-top:16px;">
        <div class="page-card">
          <h3>Сервис</h3>
          <p><strong>Running</strong></p>
        </div>
        <div class="page-card">
          <h3>База</h3>
          <p><strong>${statusLabel}</strong></p>
        </div>
        <div class="page-card">
          <h3>Telegram</h3>
          <p><strong>${telegramLabel}</strong></p>
        </div>
        <div class="page-card">
          <h3>Пароль</h3>
          <p><strong>${adminPasswordLabel}</strong></p>
        </div>
        <div class="page-card">
          <h3>Uptime</h3>
          <p><strong>${Math.floor(options.status.uptime)}s</strong></p>
        </div>
      </div>
      <div style="margin-top:16px; color:#666;">
        <p><strong>Public:</strong> <code>/health</code></p>
        <p><strong>Protected debug:</strong> <code>/metrics</code>, <code>/kufar</code>, <code>/sync</code></p>
      </div>
    </div>
    `,
  });
}

function renderApplicationFormPage() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kufmon Application Form</title>
  <style>
    body { margin: 0; min-height: 100vh; font-family: Arial, sans-serif; background: linear-gradient(180deg, #111827 0%, #1f2937 100%); color: #f8fafc; }
    .wrap { max-width: 820px; margin: 0 auto; padding: 28px 16px 40px; }
    .panel { background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 20px; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 18px; color: #cbd5e1; line-height: 1.5; }
    .form-shell { overflow: hidden; border-radius: 16px; background: #fff; min-height: 1020px; }
    iframe { display:block; width:100%; min-height: 1020px; border:0; }
    .footer { margin-top: 14px; font-size: 13px; color: #94a3b8; }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <h1>Заявка</h1>
      <p>Заполните форму ниже. Если страница открыта из Telegram, можно отправить её сразу в ответ боту.</p>
      <div class="form-shell">
        <script src="https://forms.yandex.ru/_static/embed.js"></script>
        <iframe src="https://forms.yandex.ru/u/6a620e874936395b9dc66a9a?iframe=1" frameborder="0" name="ya-form-6a620e874936395b9dc66a9a"></iframe>
      </div>
      <div class="footer">Если форма не загрузилась, откройте страницу заново или проверьте блокировщик контента.</div>
    </div>
  </div>
</body>
</html>`;
}

function renderUsersPage(options: {
  users: any[];
  selectedUser: any | null;
  returnTo: string;
  planOptionMarkup: string;
  pagination: ReturnType<typeof buildPaginationMeta>;
  query: Record<string, unknown>;
  currentSort: { key: string; direction: "asc" | "desc" } | null;
}) {
  const isEditing = Boolean(options.selectedUser);
  const defaultPlanId = options.selectedUser?.planId ?? "single";
  const planExpiresAtValue = formatDateInputValue(options.selectedUser?.planExpiresAt ?? getDefaultBillingExpiresAt(defaultPlanId));
  return renderAdminLayout({
    title: "Пользователи",
    activePath: "/ui/users",
    body: `
    <div class="section">
      <h2>Пользователи</h2>
      <h3>${isEditing ? "Редактировать пользователя" : "Создать пользователя"}</h3>
      <form method="POST" action="${isEditing ? "/users/update" : "/users"}" class="compact-form" style="grid-template-columns: 1fr 1fr 1.2fr 1fr 1fr auto; align-items:end;">
        <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo)}" />
        ${isEditing ? `<input type="hidden" name="id" value="${escapeHtml(options.selectedUser.id)}" />` : ""}
        <div class="form-group">
          <label>Имя / название пользователя</label>
          <input name="name" value="${escapeHtml(options.selectedUser?.name ?? "")}" placeholder="Например, Иван или Агентство А" required />
        </div>
        <div class="form-group">
          <label>Telegram Chat ID</label>
          <input name="chatId" value="${escapeHtml(options.selectedUser?.telegramChatId ?? "")}" placeholder="e.g., 123456789" required />
        </div>
        <div class="form-group">
          <label>Тариф</label>
          <select name="planId" required>
            ${options.planOptionMarkup}
          </select>
        </div>
        <div class="form-group">
          <label>Оплачено до</label>
          <input name="planExpiresAt" type="date" value="${escapeHtml(planExpiresAtValue)}" required />
        </div>
        <div class="form-group">
          <label>&nbsp;</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <button type="submit">${isEditing ? "Сохранить изменения" : "Создать пользователя"}</button>
            ${isEditing ? `<a href="/ui/users" style="color:#007bff; text-decoration:none;">Отменить</a>` : ""}
          </div>
        </div>
      </form>

      <h3>Существующие пользователи</h3>
      <table data-sort-table="users">
        <thead>
          <tr>
            <th>№</th>
            ${renderSortableHeader("Имя / название", "name", "string", options.currentSort)}
            ${renderSortableHeader("Chat ID", "chatId", "string", options.currentSort)}
            ${renderSortableHeader("Тариф", "plan", "string", options.currentSort)}
            ${renderSortableHeader("Оплачено до", "expiresAt", "string", options.currentSort)}
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${options.users.map((u, index) => `
            <tr>
              <td>${getDisplayRowNumber(options.pagination, index)}</td>
              <td>${escapeHtml(u.name?.trim() || "-")}</td>
              <td>${escapeHtml(u.telegramChatId)}</td>
              <td>${escapeHtml(u.plan?.name ?? formatBillingPlanLabel(u.planId))}</td>
              <td>${escapeHtml(formatDateTime(u.planExpiresAt))}</td>
              <td>
                <a href="/ui/users?edit=${encodeURIComponent(u.id)}" style="color:#007bff; text-decoration:none; margin-right:10px;">Редактировать</a>
                <form method="POST" action="/users/delete" onsubmit="return confirm('Удалить пользователя?')" style="display:inline;">
                  <input type="hidden" name="id" value="${u.id}" />
                  <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo)}" />
                  <button type="submit" class="btn-danger" style="padding:5px 10px;">Удалить</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${renderPaginationControls({
        basePath: "/ui/users",
        query: options.query,
        meta: options.pagination,
        itemLabel: "пользователей",
      })}
    </div>
    `,
  });
}

function renderSubscriptionFormMarkup(options: {
  userOptions: string;
  sourceOptionMarkup: string;
  notificationModeOptionMarkup: string;
  categoryOptionMarkup: string;
  returnTo: string;
}) {
  return `
      <h3>Создать подписку</h3>
      <form method="POST" action="/subscriptions" class="compact-form subscriptions-form" style="max-width: 1200px;">
        <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo)}" />
        <div class="form-row" style="grid-template-columns: 1.2fr 1fr 0.9fr 0.8fr;">
          <div class="form-group">
            <label>Название подписки</label>
            <input name="name" placeholder="Например, Minsk 2 rooms" required />
          </div>
          <div class="form-group">
            <label>User ID</label>
            <select name="userId" required>
              ${options.userOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Источник</label>
            <select name="source" required>
              ${options.sourceOptionMarkup}
            </select>
          </div>
          <div class="form-group">
            <label>Интервал (минуты)</label>
            <input name="intervalMinutes" type="number" value="30" required />
          </div>
        </div>
        <div class="form-row" style="grid-template-columns: 1fr 0.9fr 0.9fr 1fr 1.8fr auto; align-items:end;">
          <div class="form-group">
            <label>Категория поиска</label>
            <select name="category" required>
              ${options.categoryOptionMarkup}
            </select>
          </div>
          <div class="form-group">
            <label>Продавец</label>
            <select name="sellerTypeFilter" required>
              <option value="all">Все</option>
              <option value="private">Только физлица</option>
            </select>
          </div>
          <div class="form-group">
            <label>Уведомления</label>
            <select name="notificationMode" required>
              ${options.notificationModeOptionMarkup}
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
  sourceOptionMarkup: string;
  notificationModeOptionMarkup: string;
  categoryOptionMarkup: string;
  returnTo: string;
  pagination: ReturnType<typeof buildPaginationMeta>;
  query: Record<string, unknown>;
  currentSort: { key: string; direction: "asc" | "desc" } | null;
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
        sourceOptionMarkup: options.sourceOptionMarkup,
        notificationModeOptionMarkup: options.notificationModeOptionMarkup,
        categoryOptionMarkup: options.categoryOptionMarkup,
        returnTo: options.returnTo,
      })}

      <h3>Существующие подписки</h3>
      <table data-sort-table="subscriptions">
        <thead>
          <tr>
            <th>№</th>
            ${renderSortableHeader("Name", "name", "string", options.currentSort)}
            ${renderSortableHeader("Owner", "owner", "string", options.currentSort)}
            <th>Источник</th>
            <th>Category</th>
            ${renderSortableHeader("Seller", "seller", "string", options.currentSort)}
            <th>Notify</th>
            <th>Max price</th>
            <th>Rooms</th>
            ${renderSortableHeader("Interval", "interval", "number", options.currentSort)}
            ${renderSortableHeader("Enabled", "enabled", "boolean", options.currentSort)}
            <th>Delete</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          ${options.subscriptions.map((s, index) => `
            <tr>
              <td>${getDisplayRowNumber(options.pagination, index)}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.userId ? getUserDisplayName(options.usersById.get(s.userId)) : "-")}</td>
              <td>${escapeHtml(SOURCE_LABEL_BY_VALUE[normalizeSource(s.source)] ?? normalizeSource(s.source))}</td>
              <td>${escapeHtml(s.category ? (options.categoryLabelByValue[s.category] ?? "-") : "-")}</td>
              <td>${escapeHtml(s.sellerTypeFilter === "private" ? "Только физлица" : "Все")}</td>
              <td>${escapeHtml(s.notificationMode === "new_only" ? "Только новые" : "Новые + изменения")}</td>
              <td>${options.subscriptionFiltersById.get(s.id)?.maxPrice != null ? `$${options.subscriptionFiltersById.get(s.id)?.maxPrice}` : "-"}</td>
              <td>${escapeHtml(formatRoomsList(options.subscriptionFiltersById.get(s.id)?.rooms))}</td>
              <td>${s.intervalMinutes} мин</td>
              <td data-sort-value="${s.enabled ? 1 : 0}">
                <form method="POST" action="/subscriptions/toggle" style="display:inline;">
                  <input type="hidden" name="id" value="${s.id}" />
                  <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo)}" />
                  <button type="submit" class="${s.enabled ? "btn-success" : "btn-danger"}" style="padding:5px 10px;">${s.enabled ? "Enabled" : "Disabled"}</button>
                </form>
              </td>
              <td>
                <form method="POST" action="/subscriptions/delete" onsubmit="return confirm('Удалить подписку?')" style="display:inline;">
                  <input type="hidden" name="id" value="${s.id}" />
                  <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo)}" />
                  <button type="submit" class="btn-danger" style="padding:5px 10px;">Удалить</button>
                </form>
              </td>
              <td style="font-size:12px; max-width:100px; word-break:break-all;">${s.id}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${renderPaginationControls({
        basePath: "/ui/subscriptions",
        query: options.query,
        meta: options.pagination,
        itemLabel: "подписок",
      })}
    </div>
    `,
  });
}

function renderListingsPage(options: {
  listings: any[];
  categoryLabelByValue: Record<string, string>;
  latestEventByListingId: Map<string, { eventType: string; createdAt: Date }>;
  pagination: ReturnType<typeof buildPaginationMeta>;
  query: Record<string, unknown>;
  filters: ReturnType<typeof parseListingsFilterState>;
  currentSort: { key: string; direction: "asc" | "desc" } | null;
}) {
  return renderAdminLayout({
    title: "Объявления",
    activePath: "/ui/listings",
    body: `
    <div class="section">
      <h2>Объявления</h2>
      <form method="GET" action="/ui/listings" class="compact-form filters-form" style="margin-bottom:14px;">
        ${options.currentSort ? `
          <input type="hidden" name="sort" value="${escapeHtml(options.currentSort.key)}" />
          <input type="hidden" name="dir" value="${escapeHtml(options.currentSort.direction)}" />
        ` : ""}
        <div class="form-row" style="grid-template-columns: 0.9fr 0.9fr 0.8fr 0.8fr 0.75fr auto; align-items:end;">
          <div class="form-group">
            <label>Продавец</label>
            <select name="seller">
              <option value="all"${options.filters.seller === "all" ? " selected" : ""}>Все</option>
              <option value="company"${options.filters.seller === "company" ? " selected" : ""}>Агентство</option>
              <option value="private"${options.filters.seller === "private" ? " selected" : ""}>Физлица</option>
            </select>
          </div>
          <div class="form-group">
            <label>Статус</label>
            <select name="status">
              <option value="all"${options.filters.status === "all" ? " selected" : ""}>Все</option>
              <option value="active"${options.filters.status === "active" ? " selected" : ""}>Активные</option>
              <option value="inactive"${options.filters.status === "inactive" ? " selected" : ""}>Неактивные</option>
            </select>
          </div>
          <div class="form-group">
            <label>Цена от</label>
            <input name="priceMin" type="number" value="${escapeHtml(options.filters.priceMin ?? "")}" />
          </div>
          <div class="form-group">
            <label>Цена до</label>
            <input name="priceMax" type="number" value="${escapeHtml(options.filters.priceMax ?? "")}" />
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <button type="submit">Фильтр</button>
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <a href="/ui/listings" style="display:inline-flex; align-items:center; justify-content:center; padding:8px 14px; background:#f3f4f6; color:#333; text-decoration:none; border-radius:4px; border:1px solid #ddd;">Сбросить</a>
          </div>
        </div>
      </form>
      <table data-sort-table="listings">
        <thead>
          <tr>
            <th>№</th>
            ${renderSortableHeader("Название", "title", "string", options.currentSort)}
            ${renderSortableHeader("Кат", "category", "string", options.currentSort)}
            ${renderSortableHeader("Продав", "seller", "string", options.currentSort)}
            ${renderSortableHeader("Цена", "price", "number", options.currentSort)}
            ${renderSortableHeader("Room", "rooms", "number", options.currentSort, "center-column")}
            <th class="sortable attempt-column" data-sortable="true" data-sort-type="number" data-sort-key="missingCount"${options.currentSort?.key === "missingCount" ? ` data-sort-dir="${options.currentSort.direction}"` : ""}>Err</th>
            ${renderSortableHeader("Изм", "lastEventAt", "string", options.currentSort, "center-column")}
            ${renderSortableHeader("Стат", "active", "boolean", options.currentSort, "center-column")}
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          ${options.listings.map((l, index) => `
            <tr class="${l.isActive ? "" : "listing-row inactive"}">
              <td>${getDisplayRowNumber(options.pagination, index)}</td>
              <td>
                <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                  <a href="${escapeHtml(buildTelegramListingUrl({ url: l.url, category: l.category ?? null }))}" target="_blank" title="Открыть объявление" style="display:inline-flex; align-items:center; flex:0 0 auto;">
                    <img src="https://pbs.twimg.com/profile_images/829644122202001408/wkcfnIa9.jpg" alt="Kufar" width="18" height="18" style="display:block; object-fit:cover; object-position:center; border-radius:4px;" />
                  </a>
                  <a href="/history/${l.id}" style="color:#007bff; text-decoration:none; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(l.title)}</a>
                </div>
              </td>
              <td><span class="compact-badge category">${escapeHtml(l.category ? (options.categoryLabelByValue[l.category] ?? "-") : "-")}</span></td>
              <td><span class="compact-badge ${escapeHtml(l.sellerType === "company" ? "company" : l.sellerType === "private" ? "private" : "unknown")}">${escapeHtml(l.sellerType === "company" ? "Агентство" : l.sellerType === "private" ? "Физлицо" : "-")}</span></td>
              <td class="price" data-sort-value="${escapeHtml(l.price)}">$${l.price}</td>
              <td class="center-column">${l.rooms ?? "-"}</td>
              <td class="attempt-column">${escapeHtml(formatListingAttemptCount(l.missingCount))}</td>
              <td class="event-column">${renderLastEventCell(options.latestEventByListingId.get(l.id))}</td>
              <td class="center-column" data-sort-value="${l.isActive ? 1 : 0}">
                <span style="color:${l.isActive ? "#28a745" : "#dc3545"}; font-weight:bold;" title="${l.isActive ? "Активно" : "Неактивно"}">${l.isActive ? "＋" : "×"}</span>
              </td>
              <td class="id-column">${l.id}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${renderPaginationControls({
        basePath: "/ui/listings",
        query: options.query,
        meta: options.pagination,
        itemLabel: "объявлений",
      })}
    </div>
    `,
  });
}

app.get("/", async (req: any, reply) => {
  const status = await getServiceStatus();
  const lockState = getAdminLoginLockState();
  const error = typeof req.query?.error === "string"
    ? req.query.error === "locked"
      ? "Ввод пароля временно заблокирован."
      : req.query.error === "config"
        ? "Пароль администратора не настроен."
        : "Неверный пароль."
    : null;

  reply.type("text/html; charset=utf-8").send(renderLandingPage({
    status,
    error,
    lockedUntil: lockState.lockedUntil,
    authenticated: isAdminAuthenticated(req.headers.cookie),
  }));
});

app.get("/health", async (req: any, reply) => {
  const status = await getServiceStatus();
  const wantsJson = typeof req.query?.format === "string" && req.query.format === "json"
    || String(req.headers.accept ?? "").includes("application/json");

  if (wantsJson) {
    return {
      status: "ok",
      db: status.db,
      telegram: status.telegram,
      uptime: status.uptime,
    };
  }

  reply.type("text/html; charset=utf-8").send(renderHealthPage({ status }));
});

app.get("/apply", async (_req, reply) => {
  reply.type("text/html; charset=utf-8").send(renderApplicationFormPage());
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

app.post("/login", async (req: any, reply) => {
  const password = String(req.body?.password ?? "").trim();
  const now = Date.now();
  const lockState = getAdminLoginLockState(now);

  if (lockState.locked) {
    reply.redirect("/?error=locked");
    return;
  }

  if (!getAdminPasswordConfigured()) {
    reply.redirect("/?error=config");
    return;
  }

  if (password && password === String(process.env.ADMIN_PASSWORD ?? "").trim()) {
    clearAdminLoginState();
    const cookie = buildAdminSessionCookie(now);
    if (cookie) {
      reply.header("Set-Cookie", cookie);
    }
    reply.redirect("/ui/users");
    return;
  }

  const failure = recordAdminLoginFailure(now);
  if (failure.shouldNotify) {
    const chatId = String(process.env.ADMIN_TELEGRAM_CHAT_ID ?? "").trim();
    if (chatId) {
      await sendTelegram(
        `⚠️ Kufmon admin login locked for ${Math.round(ADMIN_LOGIN_LOCK_MS / 60000)} minutes after ${3} failed attempts.`,
        chatId,
      );
    } else {
      logger.warn("ADMIN_TELEGRAM_CHAT_ID is not configured; skipping login lock notification");
    }
  }

  reply.redirect(failure.locked ? "/?error=locked" : "/?error=bad");
});

app.get("/logout", async (_req, reply) => {
  clearAdminLoginState();
  reply.header("Set-Cookie", buildClearedAdminSessionCookie());
  reply.redirect("/");
});

app.get("/ui", async (_req, reply) => {
  reply.redirect("/ui/users");
});

app.get("/ui/users", async (req: any, reply) => {
  await cleanupStaleListings();
  const page = parsePositiveInt(req.query?.page, 1);
  const totalItems = await prisma.user.count();
  const pagination = buildPaginationMeta(totalItems, page, ADMIN_PAGE_SIZE);
  const sortState = parseAdminSortState(req.query ?? {}, ["name", "chatId", "plan", "expiresAt"]);
  const users = await prisma.user.findMany({
    skip: pagination.offset,
    take: pagination.pageSize,
    include: {
      plan: true,
    },
    orderBy: getUsersOrderBy(sortState),
  });
  const selectedUserId = typeof req.query?.edit === "string" ? req.query.edit : null;
  const selectedUser = selectedUserId
    ? await prisma.user.findUnique({
        where: { id: selectedUserId },
        include: {
          plan: true,
        },
      })
    : null;
  const planOptionMarkup = buildPlanOptionMarkup(selectedUser?.planId ?? "single");
  const userQuery = { ...(req.query ?? {}) };
  delete userQuery.edit;
  const returnTo = buildPaginationUrl("/ui/users", userQuery, pagination.page, pagination.pageSize);

  reply.type("text/html; charset=utf-8").send(renderUsersPage({
    users,
    selectedUser,
    returnTo,
    planOptionMarkup,
    pagination,
    query: req.query ?? {},
    currentSort: sortState,
  }));
});

app.get("/ui/subscriptions", async (req: any, reply) => {
  await cleanupStaleListings();
  const page = parsePositiveInt(req.query?.page, 1);
  const users = sortUsers(await prisma.user.findMany());
  const usersById = new Map(users.map((user) => [user.id, user]));
  const totalItems = await prisma.subscription.count();
  const pagination = buildPaginationMeta(totalItems, page, ADMIN_PAGE_SIZE);
  const sortState = parseAdminSortState(req.query ?? {}, ["name", "owner", "seller", "interval", "enabled"]);
  const subscriptions = await prisma.subscription.findMany({
    skip: pagination.offset,
    take: pagination.pageSize,
    orderBy: getSubscriptionsOrderBy(sortState),
  });
  const subscriptionFiltersById = new Map(
    subscriptions.map((subscription) => [subscription.id, getSubscriptionFilters(subscription)]),
  );
  const categoryOptions = [
    { value: KUFAR_CATEGORIES.apartments, label: "Квартира" },
    { value: KUFAR_CATEGORIES.houses, label: "Дом" },
    { value: KUFAR_CATEGORIES.commercial, label: "Коммерция" },
    { value: KUFAR_CATEGORIES.land, label: "Участок" },
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
  const categoryOptionMarkup = buildOptionsMarkup(categoryOptions, KUFAR_CATEGORIES.apartments);
  const sourceOptionMarkup = buildOptionsMarkup(SOURCE_OPTIONS, "kufar.by");
  const notificationModeOptionMarkup = buildOptionsMarkup(NOTIFICATION_MODE_OPTIONS, "new_and_changed");

  reply.type("text/html; charset=utf-8").send(renderSubscriptionsPage({
    subscriptions,
    usersById,
    subscriptionFiltersById,
    categoryLabelByValue,
    userOptions,
    sourceOptionMarkup,
    notificationModeOptionMarkup,
    categoryOptionMarkup,
    returnTo: buildPaginationUrl("/ui/subscriptions", req.query ?? {}, pagination.page, pagination.pageSize),
    pagination,
    query: req.query ?? {},
    currentSort: sortState,
  }));
});

app.get("/ui/listings", async (req: any, reply) => {
  await cleanupStaleListings();
  const page = parsePositiveInt(req.query?.page, 1);
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const filters = parseListingsFilterState(req.query ?? {});
  const listingWhere = buildListingsWhere(filters, cutoff);
  const totalItems = await prisma.listing.count({ where: listingWhere });
  const pagination = buildPaginationMeta(totalItems, page, ADMIN_PAGE_SIZE);
  const sortState = parseAdminSortState(req.query ?? {}, ["title", "category", "seller", "price", "rooms", "missingCount", "lastEventAt", "active"]);
  const shouldSortByLastEvent = sortState?.key === "lastEventAt";
  const allListings = shouldSortByLastEvent
    ? await prisma.listing.findMany({
        where: listingWhere,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      })
    : await prisma.listing.findMany({
        skip: pagination.offset,
        take: pagination.pageSize,
        where: listingWhere,
        orderBy: getListingsOrderBy(sortState),
      });
  const latestEvents = allListings.length > 0
    ? await prisma.adEvent.findMany({
        where: { listingId: { in: allListings.map((listing) => listing.id) } },
        orderBy: [
          { listingId: "asc" },
          { createdAt: "desc" },
        ],
        select: {
          listingId: true,
          eventType: true,
          createdAt: true,
        },
      })
    : [];
  const latestEventByListingId = new Map<string, { eventType: string; createdAt: Date }>();

  for (const event of latestEvents) {
    if (!latestEventByListingId.has(event.listingId)) {
      latestEventByListingId.set(event.listingId, {
        eventType: event.eventType,
        createdAt: event.createdAt,
      });
    }
  }
  const listings = shouldSortByLastEvent
    ? allListings
        .slice()
        .sort((a, b) => compareLastEventDates(a, b, latestEventByListingId, sortState?.direction ?? "asc"))
        .slice(pagination.offset, pagination.offset + pagination.pageSize)
    : allListings;
  const categoryOptions = [
    { value: KUFAR_CATEGORIES.apartments, label: "Квартира" },
    { value: KUFAR_CATEGORIES.houses, label: "Дом" },
    { value: KUFAR_CATEGORIES.commercial, label: "Коммерция" },
    { value: KUFAR_CATEGORIES.land, label: "Участок" },
  ];
  const categoryLabelByValue = Object.fromEntries(
    categoryOptions.map((option) => [option.value, option.label]),
  );

  reply.type("text/html; charset=utf-8").send(renderListingsPage({
    listings,
    categoryLabelByValue,
    latestEventByListingId,
    pagination,
    query: req.query ?? {},
    filters,
    currentSort: sortState,
  }));
});

app.post("/users", async (req: any, reply) => {
  const body = req.body;
  const returnTo = typeof body.returnTo === "string" && body.returnTo ? body.returnTo : "/ui/users";
  const createdUser = await prisma.user.create({
    data: {
      name: body.name ? String(body.name).trim() || null : null,
      telegramChatId: body.chatId,
    },
  });

  await persistUserBillingState(prisma, {
    userId: createdUser.id,
    planId: body.planId,
    expiresAt: body.planExpiresAt,
  });

  await enforceSearchSubscriptionLimits(prisma, createdUser.id);

  reply.redirect(returnTo);
});

app.post("/users/update", async (req: any, reply) => {
  const body = req.body;
  const returnTo = typeof body.returnTo === "string" && body.returnTo ? body.returnTo : "/ui/users";
  const userId = body.id;

  await prisma.user.update({
    where: { id: userId },
    data: {
      name: body.name ? String(body.name).trim() || null : null,
      telegramChatId: body.chatId,
    },
  });

  await persistUserBillingState(prisma, {
    userId,
    planId: body.planId,
    expiresAt: body.planExpiresAt,
  });

  await enforceSearchSubscriptionLimits(prisma, userId);

  reply.redirect(returnTo);
});

app.post("/subscriptions", async (req: any, reply) => {
  const body = req.body;
  const returnTo = typeof body.returnTo === "string" && body.returnTo ? body.returnTo : "/ui/subscriptions";
  const userId = body.userId || null;
  const source = normalizeSource(body.source);
  const sellerTypeFilter = body.sellerTypeFilter === "private" ? "private" : "all";
  const notificationMode = body.notificationMode === "new_only" ? "new_only" : "new_and_changed";
  const maxPrice = parseOptionalNumber(body.maxPrice);
  const rooms = parseRoomsSelection(body.rooms);
  const requestedIntervalMinutes = parseOptionalNumber(body.intervalMinutes) ?? 30;
  const owner = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { planId: true },
      })
    : null;
  const intervalMinutes = userId
    ? Math.max(requestedIntervalMinutes, getBillingPlan(owner?.planId).minimumIntervalMinutes)
    : requestedIntervalMinutes;

  const subscription = await prisma.subscription.create({
    data: {
      name: body.name || "unnamed",
      userId,
      source,
      category: body.category || null,
      sellerTypeFilter,
      notificationMode,
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
      await enforceSearchSubscriptionLimits(prisma, user.id);
      const cutoff = new Date(Date.now() - subscription.intervalMinutes * 60_000);
      const recentListings = await prisma.listing.findMany({
        where: {
          lastSeenAt: { gte: cutoff },
          isActive: true,
          source: { in: ["kufar.by", "kufar"] },
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
          source: listing.source,
        }),
      );

      if (matchingListings.length > 0) {
        const chunks = splitMessageChunks(formatTelegramBatchMessage(
          matchingListings.map((listing) => ({
            eventType: "NEW" as const,
            category: listing.category ?? null,
            title: listing.title,
            rooms: listing.rooms ?? null,
            price: listing.price,
            url: listing.url,
            subscriptionName: subscription.name,
          })),
        ));

        for (const chunk of chunks) {
          await sendTelegram(chunk, user.telegramChatId);
        }
      }
    }
  }

  reply.redirect(returnTo);
});

app.post("/subscriptions/toggle", async (req: any, reply) => {
  const id = req.body.id;
  const returnTo = typeof req.body.returnTo === "string" && req.body.returnTo ? req.body.returnTo : "/ui/subscriptions";

  const subscription = await prisma.subscription.findUnique({
    where: { id },
    select: { id: true, enabled: true },
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { id },
      data: {
        enabled: !subscription.enabled,
      },
    });
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
  html += "<div style='display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;'>";
  html += "<h2 style='margin:0;'>История изменений</h2>";
  html += "<a href='/ui/listings' style='display:inline-flex; align-items:center; padding:8px 12px; background:#007bff; color:#fff; text-decoration:none; border-radius:6px; font-size:14px;'>Все объявления</a>";
  html += "</div>";
  
  if (history.length === 0) {
    html += "<div>Нет событий</div>";
  }

  for (const event of history) {
    html += "<div style='margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #ddd;'>";
    html += "<div><strong>" + escapeHtml(event.eventType) + "</strong> — " + new Date(event.createdAt).toLocaleString() + "</div>";
    html += "<div style='margin:8px 0 0; white-space:pre-wrap; font-family:inherit; line-height:1.45;'>" + renderHistorySummaryHtml(formatEventSummary(event.eventType, event.changesJson)) + "</div>";
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

