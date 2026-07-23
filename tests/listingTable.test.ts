import { describe, expect, it } from "vitest";
import { formatListingAttemptCount, formatListingEventAt } from "../src/listingTable.js";

describe("listing table helpers", () => {
  it("hides zero attempt counts", () => {
    expect(formatListingAttemptCount(0)).toBe("");
    expect(formatListingAttemptCount(null)).toBe("");
    expect(formatListingAttemptCount(3)).toBe("3");
  });

  it("formats the last event timestamp as DD-MM HH:MM", () => {
    const formatted = formatListingEventAt("2026-07-23T07:29:25.000Z");

    expect(formatted).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
