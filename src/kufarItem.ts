export async function fetchKufarItem(id: string) {
  const url = `https://re.kufar.by/vi/${id}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ru-RU,ru;q=0.9",
      "cache-control": "no-cache",
    },
  });

  return await res.text();
}

export type KufarListingDetails = {
  address: string | null;
  fullDescription: string | null;
  imageUrls: string[];
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
    fullDescription: pickBestDescription(descriptionCandidates),
    imageUrls,
  };
}
