import { describe, expect, it } from "vitest";
import {
  buildSortUrl,
  getListingsOrderBy,
  getSubscriptionsOrderBy,
  getUsersOrderBy,
  nextSortDirection,
  parseAdminSortState,
} from "../src/adminSorting.js";

describe("admin sorting helpers", () => {
  it("parses sort query state and falls back safely", () => {
    expect(parseAdminSortState({ sort: "price", dir: "desc" }, ["price", "title"])).toEqual({
      key: "price",
      direction: "desc",
    });

    expect(parseAdminSortState({ sort: "unknown" }, ["price", "title"])).toBeNull();
  });

  it("builds sort urls while resetting the page and preserving filters", () => {
    const url = buildSortUrl("/ui/listings", { page: 4, limit: 50, cat: "1010", foo: "bar" }, "price", "desc");

    expect(url).toBe("/ui/listings?limit=50&cat=1010&foo=bar&page=1&sort=price&dir=desc");
  });

  it("toggles sort direction predictably", () => {
    expect(nextSortDirection(null, "price")).toBe("asc");
    expect(nextSortDirection({ key: "price", direction: "asc" }, "price")).toBe("desc");
    expect(nextSortDirection({ key: "title", direction: "desc" }, "price")).toBe("asc");
  });

  it("maps admin sort state to stable order clauses", () => {
    expect(getUsersOrderBy({ key: "name", direction: "asc" } as any)).toEqual([
      { name: "asc" },
      { telegramChatId: "asc" },
    ]);

    expect(getUsersOrderBy({ key: "plan", direction: "desc" } as any)).toEqual([
      { plan: { name: "desc" } },
      { planExpiresAt: "desc" },
      { name: "asc" },
    ]);

    expect(getUsersOrderBy({ key: "expiresAt", direction: "asc" } as any)).toEqual([
      { planExpiresAt: "asc" },
      { name: "asc" },
    ]);

    expect(getSubscriptionsOrderBy({ key: "interval", direction: "desc" } as any)).toEqual([
      { intervalMinutes: "desc" },
      { name: "asc" },
    ]);

    expect(getListingsOrderBy({ key: "price", direction: "asc" } as any)).toEqual([
      { price: "asc" },
      { createdAt: "desc" },
    ]);

    expect(getListingsOrderBy({ key: "lastEventAt", direction: "desc" } as any)).toEqual([
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  });
});
