export interface PaginationMeta {
  totalItems: number;
  pageSize: number;
  pageCount: number;
  page: number;
  offset: number;
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function parsePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function buildPaginationMeta(totalItems: number, requestedPage: number, pageSize: number): PaginationMeta {
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(Math.max(0, totalItems) / safePageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), pageCount);
  const offset = (page - 1) * safePageSize;
  const from = totalItems === 0 ? 0 : offset + 1;
  const to = totalItems === 0 ? 0 : Math.min(totalItems, offset + safePageSize);

  return {
    totalItems,
    pageSize: safePageSize,
    pageCount,
    page,
    offset,
    from,
    to,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}

export function buildPaginationUrl(
  basePath: string,
  query: Record<string, unknown>,
  page: number,
  pageSize: number,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (key === "page" || key === "limit" || value == null || value === "") continue;
    if (Array.isArray(value)) continue;
    params.set(key, String(value));
  }

  params.set("page", String(page));
  params.set("limit", String(pageSize));

  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

