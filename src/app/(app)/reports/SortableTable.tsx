"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Client-side sortable table (PLAN.md §17.3 P15 "every table sortable").
// Deliberately not URL state like the contacts list's filters (§10 1R #1) —
// that rule is about a page being bookmarkable and re-shareable by its
// *filters*; which column a rep last clicked to sort a report table by is
// throwaway UI state, not something a link needs to reproduce.

export type SortableColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  value: (row: T) => number | string;
  format?: (row: T) => React.ReactNode;
};

export function SortableTable<T>({
  rows,
  rowKey,
  columns,
  defaultSort,
  empty,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: SortableColumn<T>[];
  defaultSort?: { key: string; direction: "asc" | "desc" };
  empty: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? { key: columns[0]!.key, direction: "desc" as const });

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.value(a);
      const bv = column.value(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;

  function toggle(key: string) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn("py-2 pr-4 font-medium", column.align === "right" && "text-right")}
              >
                <button
                  type="button"
                  onClick={() => toggle(column.key)}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  {column.label}
                  {sort.key === column.key ? (
                    sort.direction === "asc" ? (
                      <ArrowUp className="size-3" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="size-3" aria-hidden="true" />
                    )
                  ) : (
                    <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="border-b">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn("py-2 pr-4 tabular-nums", column.align === "right" && "text-right")}
                >
                  {column.format ? column.format(row) : column.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
