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
    const priceMatch = html.match(/"price_byn":\s*(\d+)/);
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

export function extractJson(html: string) {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s);

  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}