"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";

// The business list, filtered in the browser: the whole platform is a few
// dozen to a few hundred rows, which is one query and no round trip per
// keystroke. Search matches name, slug and every site domain, because the
// domain is what the operator actually remembers ("the gruas one").

export type TenantTableRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "trial";
  createdAt: string;
  sites: Array<{ domain: string | null; slug: string; isActive: boolean }>;
  members: number;
  contacts: number;
  lastLeadAt: string | null;
};

type StatusFilter = "all" | "active" | "trial" | "suspended";

const STATUS_TONE: Record<TenantTableRow["status"], string> = {
  active: "bg-success-surface text-success",
  trial: "bg-muted text-muted-foreground",
  suspended: "bg-destructive-surface text-destructive",
};

/** `now` comes from the server render so relative times ("hace 3 días") read
 * the same on the server and in the browser. */
export function TenantTable({ rows, now }: { rows: TenantTableRow[]; now: string }) {
  const t = useTranslations("superadmin.tenants");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: rows.length, active: 0, trial: 0, suspended: 0 };
    for (const row of rows) c[row.status] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.slug.includes(q) ||
        row.sites.some((site) => (site.domain ?? site.slug).toLowerCase().includes(q))
      );
    });
  }, [rows, query, status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">{t("search")}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
          />
        </label>
        <div role="group" aria-label={t("status")} className="flex flex-wrap gap-1">
          {(["all", "active", "trial", "suspended"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                status === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {value === "all" ? t("filterAll") : t(`statusValues.${value}`)} · {counts[value]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("noMatches")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t("name")}</th>
                <th className="py-2 pr-4 font-medium">{t("sitesColumn")}</th>
                <th className="py-2 pr-4 text-right font-medium">{t("membersColumn")}</th>
                <th className="py-2 pr-4 text-right font-medium">{t("contactsColumn")}</th>
                <th className="py-2 pr-4 font-medium">{t("lastLeadColumn")}</th>
                <th className="py-2 font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b align-top hover:bg-accent/40">
                  <td className="py-2.5 pr-4">
                    <Link href={`/tenants/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.slug}</p>
                  </td>
                  <td className="py-2.5 pr-4">
                    {row.sites.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t("noSite")}</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {row.sites.map((site) => (
                          <li key={site.slug} className="flex items-center gap-1.5 text-xs">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                site.isActive ? "bg-success" : "bg-muted-foreground/40",
                              )}
                              aria-hidden="true"
                            />
                            <span>{site.domain ?? site.slug}</span>
                            {!site.isActive && (
                              <span className="text-muted-foreground">({t("siteInactive")})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{row.members}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{row.contacts}</td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                    {row.lastLeadAt
                      ? format.relativeTime(new Date(row.lastLeadAt), new Date(now))
                      : t("never")}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-xs",
                        STATUS_TONE[row.status],
                      )}
                    >
                      {t(`statusValues.${row.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
