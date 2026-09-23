import type { TenantTableRow } from "./TenantTable";

// Pure sort/paginate/CSV helpers for the business list — split out of
// TenantTable.tsx so the logic that decides row order and what a page holds
// is unit-testable without rendering React.

export type SortKey = "name" | "members" | "contacts" | "lastLead" | "createdAt";
export type SortDirection = "asc" | "desc";

function compareValues(a: TenantTableRow, b: TenantTableRow, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, "es");
    case "members":
      return a.members - b.members;
    case "contacts":
      return a.contacts - b.contacts;
    case "lastLead": {
      const av = a.lastLeadAt ? new Date(a.lastLeadAt).getTime() : -Infinity;
      const bv = b.lastLeadAt ? new Date(b.lastLeadAt).getTime() : -Infinity;
      return av - bv;
    }
    case "createdAt":
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }
}

/** Stable sort (ties keep their relative order) so re-sorting by the same
 * key never shuffles rows that compare equal. */
export function sortRows(
  rows: TenantTableRow[],
  key: SortKey,
  direction: SortDirection,
): TenantTableRow[] {
  const withIndex = rows.map((row, index) => ({ row, index }));
  withIndex.sort((a, b) => {
    const cmp = compareValues(a.row, b.row, key);
    if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
    return a.index - b.index;
  });
  return withIndex.map((entry) => entry.row);
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

const CSV_HEADER = [
  "Nombre",
  "Slug",
  "Estado",
  "Dominios",
  "Usuarios",
  "Contactos",
  "Último lead",
  "Creada",
];

function csvCell(value: string): string {
  // Excel/Sheets rule: a cell containing a comma, quote or newline must be
  // quoted, and an embedded quote doubled.
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** CSV of the given (already filtered+sorted) rows. UTF-8 with a BOM so
 * Excel — which otherwise guesses Latin-1 and mangles accents — reads it
 * correctly. */
export function rowsToCsv(rows: TenantTableRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.slug,
        row.status,
        row.sites.map((site) => site.domain ?? site.slug).join(" "),
        String(row.members),
        String(row.contacts),
        row.lastLeadAt ?? "",
        row.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}
