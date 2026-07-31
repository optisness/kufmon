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

type KufarPhoneAuthHeaders = {
  authorization?: string;
  "x-app-name"?: string;
  "x-app-request-source"?: string;
  "x-pulse-environment-id"?: string;
  "x-rudder-anonymous-id"?: string;
};

const cachedKufarPhoneAuthHeaders: KufarPhoneAuthHeaders = {};
let hasCachedKufarPhoneAuthHeaders = false;

function normalizeHeaderValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeAuthorizationHeader(value: string | null) {
  if (!value) return null;
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
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

export function extractKufarPhoneAuthHeaders(html: string): KufarPhoneAuthHeaders | null {
  const authorization =
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

  return Object.keys(headers).length > 0 ? headers : null;
}

function readKufarPhoneAuthHeadersFromEnv() {
  const authorization = normalizeAuthorizationHeader(
    normalizeHeaderValue(process.env.KUFAR_PHONE_AUTHORIZATION),
  );
  const xAppName = normalizeHeaderValue(process.env.KUFAR_PHONE_X_APP_NAME);
  const xAppRequestSource = normalizeHeaderValue(process.env.KUFAR_PHONE_X_APP_REQUEST_SOURCE);
  const xPulseEnvironmentId = normalizeHeaderValue(process.env.KUFAR_PHONE_X_PULSE_ENVIRONMENT_ID);
  const xRudderAnonymousId = normalizeHeaderValue(process.env.KUFAR_PHONE_X_RUDDER_ANONYMOUS_ID);

  const headers: KufarPhoneAuthHeaders = {};

  if (authorization) headers.authorization = authorization;
  if (xAppName) headers["x-app-name"] = xAppName;
  if (xAppRequestSource) headers["x-app-request-source"] = xAppRequestSource;
  if (xPulseEnvironmentId) headers["x-pulse-environment-id"] = xPulseEnvironmentId;
  if (xRudderAnonymousId) headers["x-rudder-anonymous-id"] = xRudderAnonymousId;

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

function rememberKufarPhoneAuthHeaders(headers: KufarPhoneAuthHeaders | null) {
  if (!headers) return;

  Object.assign(cachedKufarPhoneAuthHeaders, headers);
  hasCachedKufarPhoneAuthHeaders = true;
}

function buildKufarPhoneRequestHeaders(id: string, authHeaders?: KufarPhoneAuthHeaders | null) {
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
    "x-requested-with": "XMLHttpRequest",
  };

  if (authHeaders?.authorization) headers.authorization = authHeaders.authorization;
  if (authHeaders?.["x-app-name"]) headers["x-app-name"] = authHeaders["x-app-name"];
  if (authHeaders?.["x-app-request-source"]) {
    headers["x-app-request-source"] = authHeaders["x-app-request-source"];
  }
  if (authHeaders?.["x-pulse-environment-id"]) {
    headers["x-pulse-environment-id"] = authHeaders["x-pulse-environment-id"];
  }
  if (authHeaders?.["x-rudder-anonymous-id"]) {
    headers["x-rudder-anonymous-id"] = authHeaders["x-rudder-anonymous-id"];
  }

  return headers;
}

async function resolveKufarPhoneAuthHeaders(id: string) {
  const envHeaders = readKufarPhoneAuthHeadersFromEnv();
  const cachedHeaders = hasCachedKufarPhoneAuthHeaders ? cachedKufarPhoneAuthHeaders : null;
  const merged = mergeKufarPhoneAuthHeaders(envHeaders, cachedHeaders);

  if (merged) {
    return merged;
  }

  const html = await fetchKufarItem(id);
  const extracted = extractKufarPhoneAuthHeaders(html);
  rememberKufarPhoneAuthHeaders(extracted);
  return extracted;
}

export async function fetchKufarPhone(id: string, authHeaders?: KufarPhoneAuthHeaders | null) {
  const url = `https://api.kufar.by/search-api/v2/item/${id}/phone`;
  let triedAuthDiscovery = false;

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

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: buildKufarPhoneRequestHeaders(
          id,
          mergeKufarPhoneAuthHeaders(
            readKufarPhoneAuthHeadersFromEnv(),
            hasCachedKufarPhoneAuthHeaders ? cachedKufarPhoneAuthHeaders : null,
            authHeaders,
          ),
        ),
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt === 2) {
        if (error instanceof Error && error.name === "AbortError") {
          return null;
        }
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) {
      const data = await res.json();
      return normalizePhoneList(data?.phone);
    }

    if (res.status === 401 && !triedAuthDiscovery) {
      triedAuthDiscovery = true;
      try {
        const resolvedAuthHeaders = await resolveKufarPhoneAuthHeaders(id);
        if (resolvedAuthHeaders) {
          rememberKufarPhoneAuthHeaders(resolvedAuthHeaders);
          authHeaders = mergeKufarPhoneAuthHeaders(authHeaders, resolvedAuthHeaders);
          if (authHeaders) {
            continue;
          }
        }
      } catch {
        // If auth discovery fails, fall through to the normal retry logic.
      }
    }

    if (res.status === 404 || res.status === 403 || res.status === 429) {
      if (attempt === 2) {
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }

    if (attempt === 2) {
      throw new Error(`Failed to fetch phone for item ${id}: HTTP ${res.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  return null;
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
