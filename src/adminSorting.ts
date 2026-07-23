export type AdminSortDirection = "asc" | "desc";

export interface AdminSortState {
  key: string;
  direction: AdminSortDirection;
}

export function parseAdminSortState(
  query: Record<string, unknown>,
  allowedKeys: string[],
  defaultState?: AdminSortState,
): AdminSortState | null {
  const key = typeof query.sort === "string" ? query.sort : "";
  if (!key || !allowedKeys.includes(key)) {
    return defaultState ?? null;
  }

  const direction: AdminSortDirection = query.dir === "desc" ? "desc" : "asc";
  return { key, direction };
}

export function buildSortUrl(
  basePath: string,
  query: Record<string, unknown>,
  key: string,
  direction: AdminSortDirection,
  page = 1,
) {
  const params = new URLSearchParams();

  for (const [queryKey, value] of Object.entries(query)) {
    if (queryKey === "page" || queryKey === "sort" || queryKey === "dir" || value == null || value === "") continue;
    if (Array.isArray(value)) continue;
    params.set(queryKey, String(value));
  }

  params.set("page", String(page));
  params.set("sort", key);
  params.set("dir", direction);

  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function nextSortDirection(
  currentState: AdminSortState | null,
  key: string,
) {
  if (!currentState || currentState.key !== key) {
    return "asc" as const;
  }

  return currentState.direction === "asc" ? "desc" : "asc";
}

export function getUsersOrderBy(sortState: AdminSortState | null): any[] {
  if (!sortState) {
    return [{ name: "asc" }, { telegramChatId: "asc" }];
  }

  if (sortState.key === "chatId") {
    return [{ telegramChatId: sortState.direction }, { name: "asc" }];
  }

  if (sortState.key === "plan") {
    return [{ plan: { name: sortState.direction } }, { planExpiresAt: "desc" }, { name: "asc" }];
  }

  if (sortState.key === "expiresAt") {
    return [{ planExpiresAt: sortState.direction }, { name: "asc" }];
  }

  return [{ name: sortState.direction }, { telegramChatId: "asc" }];
}

export function getSubscriptionsOrderBy(sortState: AdminSortState | null): any[] {
  if (!sortState) {
    return [{ createdAt: "desc" }];
  }

  switch (sortState.key) {
    case "name":
      return [{ name: sortState.direction }, { createdAt: "desc" }];
    case "owner":
      return [{ user: { name: sortState.direction } }, { user: { telegramChatId: sortState.direction } }, { name: "asc" }];
    case "seller":
      return [{ sellerTypeFilter: sortState.direction }, { name: "asc" }];
    case "interval":
      return [{ intervalMinutes: sortState.direction }, { name: "asc" }];
    case "enabled":
      return [{ enabled: sortState.direction }, { name: "asc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}

export function getListingsOrderBy(sortState: AdminSortState | null): any[] {
  if (!sortState) {
    return [{ createdAt: "desc" }];
  }

  switch (sortState.key) {
    case "title":
      return [{ title: sortState.direction }, { createdAt: "desc" }];
    case "category":
      return [{ category: sortState.direction }, { createdAt: "desc" }];
    case "seller":
      return [{ sellerType: sortState.direction }, { createdAt: "desc" }];
    case "price":
      return [{ price: sortState.direction }, { createdAt: "desc" }];
    case "rooms":
      return [{ rooms: sortState.direction }, { createdAt: "desc" }];
    case "missingCount":
      return [{ missingCount: sortState.direction }, { createdAt: "desc" }];
    case "lastEventAt":
      return [{ events: { _max: { createdAt: sortState.direction } } }, { createdAt: "desc" }];
    case "active":
      return [{ isActive: sortState.direction }, { createdAt: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}
