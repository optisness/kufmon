import { describe, expect, it } from "vitest";
import { renumberRows, sortRows } from "../src/adminTableSort.js";

function row(values: Array<string | number | null>, sortValues: Array<string | number | null> = []) {
  return {
    cells: values.map((value, index) => ({
      textContent: value == null ? "" : String(value),
      dataset: sortValues[index] == null ? undefined : { sortValue: sortValues[index] as any },
    })),
  };
}

describe("admin table sorting", () => {
  it("sorts users by name and renumbers rows", () => {
    const rows = [
      row(["1", "Zeta", "300"]),
      row(["2", "alpha", "100"]),
      row(["3", "Мир", "200"]),
    ];

    const sorted = renumberRows(sortRows(rows, 1, "string", "asc"));

    expect(sorted.map((r) => r.cells[1].textContent)).toEqual(["alpha", "Zeta", "Мир"]);
    expect(sorted.map((r) => r.cells[0].textContent)).toEqual(["1", "2", "3"]);
  });

  it("sorts subscriptions by owner, interval, and enabled state", () => {
    const rows = [
      row(["1", "Sub A", "Иван", "-", "Все", "-", "-", "30", "Disabled"], [null, null, null, null, null, null, null, 30, 0]),
      row(["2", "Sub B", "Алина", "-", "Все", "-", "-", "15", "Enabled"], [null, null, null, null, null, null, null, 15, 1]),
      row(["3", "Sub C", "Борис", "-", "Все", "-", "-", "60", "Disabled"], [null, null, null, null, null, null, null, 60, 0]),
    ];

    const byOwner = sortRows(rows, 2, "string", "asc");
    expect(byOwner.map((r) => r.cells[2].textContent)).toEqual(["Алина", "Борис", "Иван"]);

    const byInterval = sortRows(rows, 7, "number", "asc");
    expect(byInterval.map((r) => r.cells[7].textContent)).toEqual(["15", "30", "60"]);

    const byEnabledAsc = sortRows(rows, 8, "boolean", "asc");
    expect(byEnabledAsc.map((r) => r.cells[8].textContent)).toEqual(["Disabled", "Disabled", "Enabled"]);

    const byEnabledDesc = sortRows(rows, 8, "boolean", "desc");
    expect(byEnabledDesc.map((r) => r.cells[8].textContent)).toEqual(["Enabled", "Disabled", "Disabled"]);
  });

  it("sorts listings by title, price, and active state", () => {
    const rows = [
      row(["1", "10", "Zeta", "-", "-", "120000", "2", "-", "❌"], [null, null, null, null, null, 120000, 2, null, 0]),
      row(["2", "11", "alpha", "-", "-", "80000", "3", "-", "✅"], [null, null, null, null, null, 80000, 3, null, 1]),
      row(["3", "12", "Мир", "-", "-", "95000", "1", "-", "❌"], [null, null, null, null, null, 95000, 1, null, 0]),
    ];

    const byTitle = sortRows(rows, 2, "string", "asc");
    expect(byTitle.map((r) => r.cells[2].textContent)).toEqual(["alpha", "Zeta", "Мир"]);

    const byPrice = sortRows(rows, 5, "number", "asc");
    expect(byPrice.map((r) => r.cells[5].textContent)).toEqual(["80000", "95000", "120000"]);

    const byActive = sortRows(rows, 8, "boolean", "desc");
    expect(byActive.map((r) => r.cells[8].textContent)).toEqual(["✅", "❌", "❌"]);
  });
});
