import { describe, expect, it } from "vitest";
import { buildPaginationMeta, buildPaginationUrl, parsePositiveInt } from "../src/adminPagination.js";

describe("admin pagination helpers", () => {
  it("clamps and describes pagination metadata", () => {
    const meta = buildPaginationMeta(123, 3, 50);

    expect(meta.page).toBe(3);
    expect(meta.pageCount).toBe(3);
    expect(meta.offset).toBe(100);
    expect(meta.from).toBe(101);
    expect(meta.to).toBe(123);
    expect(meta.hasPrevious).toBe(true);
    expect(meta.hasNext).toBe(false);
  });

  it("builds pagination urls while preserving existing query params", () => {
    const url = buildPaginationUrl("/ui/listings", { page: 1, limit: 50, sort: "price", cat: "1010" }, 2, 50);

    expect(url).toBe("/ui/listings?sort=price&cat=1010&page=2&limit=50");
  });

  it("parses positive page numbers safely", () => {
    expect(parsePositiveInt("4", 1)).toBe(4);
    expect(parsePositiveInt("0", 1)).toBe(1);
    expect(parsePositiveInt("-3", 1)).toBe(1);
    expect(parsePositiveInt("abc", 1)).toBe(1);
  });
});
