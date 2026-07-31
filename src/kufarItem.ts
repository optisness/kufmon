import { randomUUID } from "crypto";

export async function fetchKufarItem(id: string) {
  const url = `https://re.kufar.by/vi/${id}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru-RU,ru;q=0.9",
        "cache-control": "no-cache",
      },
      signal: controller.signal,
    });
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

type KufarPhoneAuthHeaders = Record<string, string>;

export type KufarPhoneFetchResult = {
  phone: string | null;
  blockedByIp: boolean;
};

const cachedKufarPhoneAuthHeaders: KufarPhoneAuthHeaders = {};
let hasCachedKufarPhoneAuthHeaders = false;
let fallbackKufarBrowserId: string | null = null;

function getFallbackKufarBrowserId() {
  if (!fallbackKufarBrowserId) {
    fallbackKufarBrowserId = randomUUID();
  }

  return fallbackKufarBrowserId;
}

export function resetKufarPhoneAuthHeadersCache() {
  for (const key of Object.keys(cachedKufarPhoneAuthHeaders)) {
    delete cachedKufarPhoneAuthHeaders[key as keyof KufarPhoneAuthHeaders];
  }
  hasCachedKufarPhoneAuthHeaders = false;
}

function normalizeHeaderValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeAuthorizationHeader(value: string | null) {
  if (!value) return null;
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function parseJsonHeaderOverrides(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const headers: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedKey = String(key).trim().toLowerCase();
      const normalizedValue = normalizeHeaderValue(rawValue);
      if (normalizedKey && normalizedValue) {
        headers[normalizedKey] = normalizedValue;
      }
    }

    return Object.keys(headers).length > 0 ? headers : null;
  } catch {
    return null;
  }
}

function readHeaderFromHtml(html: string, keyPattern: RegExp, valuePattern?: RegExp) {
  const directMatch = html.match(new RegExp(`["']${keyPattern.source}["']\\s*:\\s*["']([^"']+)["']`, "i"));
  if (directMatch?.[1]) {
    return normalizeHeaderValue(directMatch[1]);
  }

  if (valuePattern) {
    const valueMatch = html.match(valuePattern);
    if (valueMatch?.[1]) {
      return normalizeHeaderValue(valueMatch[1]);
    }
  }

  return null;
}

function extractNextDataJson(html: string) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function getNestedString(root: unknown, path: string[]) {
  let current: any = root;

  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = current[key];
  }

  return normalizeHeaderValue(current);
}

export function extractKufarPhoneAuthHeaders(html: string): KufarPhoneAuthHeaders | null {
  const nextData = extractNextDataJson(html);
  const authorizationFromNextData = nextData
    ? getNestedString(nextData, ["props", "initialState", "user", "login", "jwt"])
    : null;
  const buildIdFromNextData = nextData ? getNestedString(nextData, ["buildId"]) : null;
  const appVersionFromRuntimeConfig = nextData
    ? getNestedString(nextData, ["runtimeConfig", "deploy", "deployTag"])
    : null;
  const productTypeFromRuntimeConfig = nextData
    ? getNestedString(nextData, ["runtimeConfig", "application", "adview"])
    : null;

  const authorization =
    authorizationFromNextData ??
    readHeaderFromHtml(
      html,
      /authorization/i,
      /\bauthorization\b\s*[:=]\s*(Bearer\s+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+){2})/i,
    ) ?? readHeaderFromHtml(html, /authorization/i, /\bBearer\s+([A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+){2})/i);

  const headers: KufarPhoneAuthHeaders = {};

  const normalizedAuthorization = normalizeAuthorizationHeader(authorization);
  if (normalizedAuthorization) {
    headers.authorization = normalizedAuthorization;
  }

  const xAppName =
    readHeaderFromHtml(html, /x[-_]?app[-_]?name/i) ??
    readHeaderFromHtml(html, /xAppName/i);
  if (xAppName) headers["x-app-name"] = xAppName;

  const xAppRequestSource =
    readHeaderFromHtml(html, /x[-_]?app[-_]?request[-_]?source/i) ??
    readHeaderFromHtml(html, /xAppRequestSource/i);
  if (xAppRequestSource) headers["x-app-request-source"] = xAppRequestSource;

  const xPulseEnvironmentId =
    readHeaderFromHtml(html, /x[-_]?pulse[-_]?environment[-_]?id/i) ??
    readHeaderFromHtml(html, /xPulseEnvironmentId/i);
  if (xPulseEnvironmentId) headers["x-pulse-environment-id"] = xPulseEnvironmentId;

  const xRudderAnonymousId =
    readHeaderFromHtml(html, /x[-_]?rudder[-_]?anonymous[-_]?id/i) ??
    readHeaderFromHtml(html, /xRudderAnonymousId/i);
  if (xRudderAnonymousId) headers["x-rudder-anonymous-id"] = xRudderAnonymousId;

  const appVersion = buildIdFromNextData ?? appVersionFromRuntimeConfig;
  if (appVersion) headers["x-app-version"] = appVersion;

  const productType = productTypeFromRuntimeConfig;
  if (productType) headers["x-product-type"] = productType;

  return Object.keys(headers).length > 0 ? headers : null;
}

function readKufarPhoneAuthHeadersFromEnv() {
  const headers: KufarPhoneAuthHeaders = {};

  const jsonHeaders = parseJsonHeaderOverrides(
    normalizeHeaderValue(process.env.KUFAR_PHONE_REQUEST_HEADERS_JSON),
  );
  if (jsonHeaders) {
    Object.assign(headers, jsonHeaders);
  }

  const authorization = normalizeAuthorizationHeader(
    normalizeHeaderValue(process.env.KUFAR_PHONE_AUTHORIZATION),
  );
  const xAppName = normalizeHeaderValue(process.env.KUFAR_PHONE_X_APP_NAME);
  const xAppRequestSource = normalizeHeaderValue(process.env.KUFAR_PHONE_X_APP_REQUEST_SOURCE);
  const xAppVersion = normalizeHeaderValue(process.env.KUFAR_PHONE_X_APP_VERSION);
  const xProductType = normalizeHeaderValue(process.env.KUFAR_PHONE_X_PRODUCT_TYPE);
  const xPulseEnvironmentId = normalizeHeaderValue(process.env.KUFAR_PHONE_X_PULSE_ENVIRONMENT_ID);
  const xRudderAnonymousId = normalizeHeaderValue(process.env.KUFAR_PHONE_X_RUDDER_ANONYMOUS_ID);
  const xDeviceId = normalizeHeaderValue(process.env.KUFAR_PHONE_X_DEVICE_ID);
  const xSearchId = normalizeHeaderValue(process.env.KUFAR_PHONE_X_SEARCH_ID);

  if (authorization) headers.authorization = authorization;
  if (xAppName) headers["x-app-name"] = xAppName;
  if (xAppRequestSource) headers["x-app-request-source"] = xAppRequestSource;
  if (xAppVersion) headers["x-app-version"] = xAppVersion;
  if (xProductType) headers["x-product-type"] = xProductType;
  if (xPulseEnvironmentId) headers["x-pulse-environment-id"] = xPulseEnvironmentId;
  if (xRudderAnonymousId) headers["x-rudder-anonymous-id"] = xRudderAnonymousId;
  if (xDeviceId) headers["x-device-id"] = xDeviceId;
  if (xSearchId) headers["x-searchid"] = xSearchId;

  return Object.keys(headers).length > 0 ? headers : null;
}

function mergeKufarPhoneAuthHeaders(
  ...sources: Array<KufarPhoneAuthHeaders | null | undefined>
): KufarPhoneAuthHeaders | null {
  const merged: KufarPhoneAuthHeaders = {};

  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      const headerValue = normalizeHeaderValue(value);
      if (headerValue) {
        merged[key as keyof KufarPhoneAuthHeaders] = headerValue;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

function hasKufarPhoneAuthorization(headers: KufarPhoneAuthHeaders | null) {
  return Boolean(headers?.authorization && String(headers.authorization).trim().length > 0);
}

function rememberKufarPhoneAuthHeaders(headers: KufarPhoneAuthHeaders | null) {
  if (!headers) return;

  Object.assign(cachedKufarPhoneAuthHeaders, headers);
  hasCachedKufarPhoneAuthHeaders = true;
}

function buildKufarPhoneRequestHeaders(id: string, authHeaders?: KufarPhoneAuthHeaders | null) {
  const fallbackBrowserId = getFallbackKufarBrowserId();
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "ru-RU,ru;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/json",
    dnt: "1",
    origin: "https://re.kufar.by",
    referer: `https://re.kufar.by/vi/${id}`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "x-app-name": "Web Kufar",
    "x-app-request-source": "ad_view",
    "x-app-version": "kufar-web-pro",
    "x-product-type": "ad_view",
    "x-device-id": fallbackBrowserId,
    "x-pulse-environment-id": fallbackBrowserId,
    "x-rudder-anonymous-id": fallbackBrowserId,
    "x-requested-with": "XMLHttpRequest",
  };

  for (const [key, value] of Object.entries(authHeaders ?? {})) {
    headers[key] = value;
  }

  return headers;
}

async function resolveKufarPhoneAuthHeaders(id: string) {
  const envHeaders = readKufarPhoneAuthHeadersFromEnv();
  const cachedHeaders = hasCachedKufarPhoneAuthHeaders ? cachedKufarPhoneAuthHeaders : null;
  const merged = mergeKufarPhoneAuthHeaders(envHeaders, cachedHeaders);

  if (hasKufarPhoneAuthorization(merged)) {
    return merged;
  }

  const html = await fetchKufarItem(id);
  const extracted = extractKufarPhoneAuthHeaders(html);
  const combined = mergeKufarPhoneAuthHeaders(merged, extracted);
  rememberKufarPhoneAuthHeaders(combined);
  return combined;
}

export async function fetchKufarPhone(id: string, authHeaders?: KufarPhoneAuthHeaders | null) {
  const result = await fetchKufarPhoneResult(id, authHeaders);
  return result.phone;
}

function isBlockedByIpResponse(status: number, responseBody: string) {
  if (status !== 400) return false;
  return /ad phone is hidden by ip/i.test(responseBody) || /"code"\s*:\s*"ASR0009"/i.test(responseBody);
}

export async function fetchKufarPhoneResult(
  id: string,
  authHeaders?: KufarPhoneAuthHeaders | null,
): Promise<KufarPhoneFetchResult> {
  const url = `https://api.kufar.by/search-api/v2/item/${id}/phone`;
  function normalizePhoneList(value: unknown) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    const phones = raw
      .split(/\s*,\s*/)
      .map((phone) => phone.replace(/[^\d+]/g, ""))
      .filter(Boolean);

    if (phones.length === 0) return null;

    return Array.from(new Set(phones)).join(", ");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  const mergedAuthHeaders = mergeKufarPhoneAuthHeaders(
    readKufarPhoneAuthHeadersFromEnv(),
    hasCachedKufarPhoneAuthHeaders ? cachedKufarPhoneAuthHeaders : null,
    authHeaders,
  );

  try {
    const performRequest = async (headers: KufarPhoneAuthHeaders | null) => fetch(url, {
      headers: buildKufarPhoneRequestHeaders(id, headers),
      signal: controller.signal,
    });

    let res: Response;
    try {
      res = await performRequest(mergedAuthHeaders);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { phone: null, blockedByIp: false };
      }
      throw error;
    }

    if (res.ok) {
      const data = await res.json();
      return { phone: normalizePhoneList(data?.phone), blockedByIp: false };
    }

    const responseBody = await res.text().catch(() => "");

    if (isBlockedByIpResponse(res.status, responseBody)) {
      return { phone: null, blockedByIp: true };
    }

    if (res.status === 401) {
      try {
        const resolvedAuthHeaders = await resolveKufarPhoneAuthHeaders(id);
        const nextHeaders = mergeKufarPhoneAuthHeaders(mergedAuthHeaders, resolvedAuthHeaders);
        if (nextHeaders && nextHeaders.authorization) {
          try {
            const retryRes = await performRequest(nextHeaders);
            if (retryRes.ok) {
              const data = await retryRes.json();
              return { phone: normalizePhoneList(data?.phone), blockedByIp: false };
            }

            const retryBody = await retryRes.text().catch(() => "");
            if (isBlockedByIpResponse(retryRes.status, retryBody)) {
              return { phone: null, blockedByIp: true };
            }
          } catch (retryError) {
            if (retryError instanceof Error && retryError.name === "AbortError") {
              return { phone: null, blockedByIp: false };
            }
            throw retryError;
          }
        }
      } catch {
        // If auth discovery fails, fall through to null below.
      }
    }

    if (res.status === 403 || res.status === 404 || res.status === 429 || res.status === 401) {
      return { phone: null, blockedByIp: false };
    }

    const responseSummary = responseBody.trim().slice(0, 300);
    const summarySuffix = responseSummary ? `; body: ${responseSummary}` : "";
    throw new Error(`Failed to fetch phone for item ${id}: HTTP ${res.status}${summarySuffix}`);
  } finally {
    clearTimeout(timeout);
  }
}

export type KufarListingDetails = {
  address: string | null;
  fullDescription: string | null;
  imageUrls: string[];
};

export type KufarSellerDetails = {
  sellerName: string | null;
};

export function parseTitle(html: string) {
  const match = html.match(/<title>(.*?)<\/title>/);

  if (!match) return null;

  return match[1];
}

export function parseListingData(html: string) {
  try {
    // title
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch?.[1]?.trim();

    // price
    const priceMatch = html.match(/"price_usd":\s*(\d+)/) || html.match(/"price_byn":\s*(\d+)/);
    const price = priceMatch ? Number(priceMatch[1]) : null;

    // rooms
    const roomsMatch = html.match(/"rooms":\s*(\d+)/);
    const rooms = roomsMatch ? Number(roomsMatch[1]) : null;

    // area
    const areaMatch = html.match(/"area":\s*(\d+(\.\d+)?)/);
    const area = areaMatch ? Number(areaMatch[1]) : null;

    return {
      title,
      price,
      rooms,
      area,
    };
  } catch {
    return null;
  }
}

export function parseSellerType(html: string) {
  const match =
    html.match(/"company_ad"\s*:\s*(true|false)/i) ||
    html.match(/"company_ad"\s*:\s*(1|0)/);

  if (!match) return null;

  return /true|1/i.test(match[1]) ? "company" : "private";
}

export function extractJson(html: string) {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s);

  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function normalizeText(value: any) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function normalizeMultilineText(value: any) {
  if (value == null) return null;
  const text = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return text.length > 0 ? text : null;
}

function normalizeImageUrl(value: string) {
  const text = normalizeText(value);
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  const stripped = text.replace(/^\/+/, "");
  if (!stripped) return null;

  return `https://rms.kufar.by/v1/gallery/${stripped}`;
}

function findParameterValue(root: any, key: string): string | null {
  if (!root || typeof root !== "object") return null;

  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findParameterValue(item, key);
      if (found) return found;
    }
    return null;
  }

  if (typeof root.p === "string" && root.p === key) {
    return normalizeText(root.v);
  }

  for (const value of Object.values(root)) {
    const found = findParameterValue(value, key);
    if (found) return found;
  }

  return null;
}

function walkJson(node: any, visitor: (key: string, value: any) => void) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      walkJson(item, visitor);
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    visitor(key, value);
    walkJson(value, visitor);
  }
}

function collectStringsFromSubtree(node: any) {
  const values: string[] = [];

  function walk(value: any) {
    if (value == null) return;
    if (typeof value === "string") {
      const text = normalizeMultilineText(value);
      if (text) values.push(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (typeof value === "object") {
      for (const child of Object.values(value)) {
        walk(child);
      }
    }
  }

  walk(node);
  return values;
}

function collectValuesByKeyPattern(root: any, pattern: RegExp) {
  const values: string[] = [];

  walkJson(root, (key, value) => {
    if (!pattern.test(key)) return;

    values.push(...collectStringsFromSubtree(value));
  });

  return values;
}

function collectAllStrings(root: any) {
  const values: string[] = [];

  walkJson(root, (_key, value) => {
    values.push(...collectStringsFromSubtree(value));
  });

  return values;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractHtmlDescription(html: string) {
  const match = html.match(/<div[^>]*itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!match?.[1]) return null;

  const text = decodeHtmlEntities(match[1])
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > 0 ? text : null;
}

function pickBestDescription(values: string[]) {
  const filtered = values
    .map((value) => normalizeMultilineText(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.length > 0)
    .filter((value) => !/^https?:\/\//i.test(value));

  if (filtered.length === 0) {
    return null;
  }

  filtered.sort((a, b) => b.length - a.length);
  return filtered[0] ?? null;
}

export function extractListingDetails(html: string): KufarListingDetails {
  const json = extractJson(html);

  const addressCandidates = uniqueStrings([
    ...collectValuesByKeyPattern(json, /address|addr|street|location_text|address_text|address_label/i),
  ]);
  const descriptionCandidates = uniqueStrings([
    ...collectValuesByKeyPattern(json, /body|description|text|content|details|about|summary/i),
    ...collectAllStrings(json)
      .filter((value) => value.length >= 40)
      .filter((value) => !/^https?:\/\//i.test(value))
  ]);
  const htmlDescription = extractHtmlDescription(html);
  const imageCandidates = uniqueStrings([
    ...collectValuesByKeyPattern(json, /image|photo|gallery|media|picture/i),
    ...Array.from(
      html.matchAll(/https?:\/\/rms\.kufar\.by\/v1\/gallery\/[^\s"'<>)+\]]+/gi),
      (match) => match[0],
    ),
  ]);

  const imageUrls = uniqueStrings(
    imageCandidates
      .map((candidate) => normalizeImageUrl(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );

  return {
    address: addressCandidates[0] ?? null,
    fullDescription: htmlDescription ?? pickBestDescription(descriptionCandidates),
    imageUrls,
  };
}

export function extractSellerDetails(html: string): KufarSellerDetails {
  const json = extractJson(html);
  if (!json) {
    return { sellerName: null };
  }

  const sellerName = findParameterValue(json, "name");
  const contactPerson = findParameterValue(json, "contact_person");

  if (sellerName && contactPerson) {
    return { sellerName: `${sellerName}, ${contactPerson}` };
  }

  return { sellerName };
}
