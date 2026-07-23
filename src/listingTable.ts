const LISTING_EVENT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Minsk",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getDateParts(value: string | Date | null | undefined) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = LISTING_EVENT_DATE_FORMATTER.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    day: lookup.day ?? "00",
    month: lookup.month ?? "00",
    hour: lookup.hour ?? "00",
    minute: lookup.minute ?? "00",
  };
}

export function formatListingAttemptCount(value: unknown) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count <= 0) return "";
  return String(Math.trunc(count));
}

export function formatListingEventAt(value: string | Date | null | undefined) {
  const parts = getDateParts(value);
  if (!parts) return "—";

  return `${parts.day}-${parts.month} ${parts.hour}:${parts.minute}`;
}
