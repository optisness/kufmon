export type SortType = "string" | "number" | "boolean";
export type SortDirection = "asc" | "desc";

export interface SortCell {
  textContent?: string | null;
  dataset?: {
    sortValue?: string | number | null;
  };
}

export interface SortRow {
  cells: SortCell[];
}

export function normalizeSortValue(value: unknown, type: SortType) {
  const text = String(value ?? "").trim();

  if (type === "number") {
    const cleaned = text.replace(/[^\d,.-]/g, "").replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  if (type === "boolean") {
    return /^(✅|enabled|disabled|true|yes|да|1)$/i.test(text) && !/^(disabled|false|no|нет|0)$/i.test(text)
      ? 1
      : 0;
  }

  return text.toLocaleLowerCase("ru");
}

export function getSortValue(cell: SortCell | undefined, type: SortType) {
  if (!cell) return type === "number" ? Number.NEGATIVE_INFINITY : "";

  if (cell.dataset && cell.dataset.sortValue != null) {
    return normalizeSortValue(cell.dataset.sortValue, type);
  }

  return normalizeSortValue(cell.textContent, type);
}

export function sortRows(rows: SortRow[], columnIndex: number, type: SortType, direction: SortDirection) {
  return [...rows].sort((left, right) => {
    const leftValue = getSortValue(left.cells[columnIndex], type);
    const rightValue = getSortValue(right.cells[columnIndex], type);

    if (leftValue < rightValue) return direction === "asc" ? -1 : 1;
    if (leftValue > rightValue) return direction === "asc" ? 1 : -1;
    return 0;
  });
}

export function renumberRows(rows: SortRow[]) {
  rows.forEach((row, index) => {
    if (row.cells[0]) {
      row.cells[0].textContent = String(index + 1);
    }
  });

  return rows;
}
