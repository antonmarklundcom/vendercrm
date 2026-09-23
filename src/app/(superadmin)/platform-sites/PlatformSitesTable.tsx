"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Download, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import { downloadText, keysCsv, keysEnv } from "@/components/ops/key-export";
import { issueKeysForSitesAction, type BulkKeysState } from "./actions";

// Every site on the platform: which are broken, which went quiet, which have
// no key — and keys for many of them in one go. "Quiet" is an active site
// with no lead for QUIET_DAYS: a contact form on a live site that has gone a
// week without a single submission is far more often broken than unloved.

export type PlatformSiteView = {
  siteId: string;
  tenantId: string;
  tenantName: string;
  domain: string | null;
  slug: string;
  isActive: boolean;
  health: "ok" | "failing" | "idle";
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  /** Already translated on the server (app.sites.health.reasons). */
  lastErrorReason: string | null;
  activeKeys: number;
};

type Filter = "all" | "failing" | "quiet" | "inactive" | "noKey";

const QUIET_DAYS = 7;
const initial: BulkKeysState = { error: null, keys: [] };

export function PlatformSitesTable({
  sites,
  now,
  appUrl,
}: {
  sites: PlatformSiteView[];
  now: string;
  appUrl: string;
}) {
  const t = useTranslations("superadmin.platformSites");
  const format = useFormatter();
  const nowDate = useMemo(() => new Date(now), [now]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState(issueKeysForSitesAction, initial);

  const quietCutoff = nowDate.getTime() - QUIET_DAYS * 24 * 60 * 60 * 1000;
  const matches: Record<Filter, (s: PlatformSiteView) => boolean> = {
    all: () => true,
    failing: (s) => s.health === "failing",
    quiet: (s) =>
      s.isActive && (!s.lastSuccessAt || new Date(s.lastSuccessAt).getTime() < quietCutoff),
    inactive: (s) => !s.isActive,
    noKey: (s) => s.activeKeys === 0,
  };

  const counts = Object.fromEntries(
    (Object.keys(matches) as Filter[]).map((f) => [f, sites.filter(matches[f]).length]),
  ) as Record<Filter, number>;

  const visible = sites.filter((s) => {
    if (!matches[filter](s)) return false;
    const q = query.trim().toLowerCase();
    return !q || (s.domain ?? s.slug).includes(q) || s.tenantName.toLowerCase().includes(q);
  });

  // A finished run clears the selection: those sites have their keys now.
  useEffect(() => {
    if (state.keys.length > 0) setSelected(new Set());
  }, [state.keys]);

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.siteId));
  const issued = state.keys.flatMap((k) =>
    k.apiKey ? [{ domain: k.domain, name: k.tenantName, apiKey: k.apiKey }] : [],
  );
  const refused = state.keys.filter((k) => !k.apiKey);
  const stamp = now.slice(0, 10);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
          />
        </label>
        <div role="group" aria-label={t("filter")} className="flex flex-wrap gap-1">
          {(Object.keys(matches) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                filter === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {t(`filters.${f}`, { days: QUIET_DAYS })} · {counts[f]}
            </button>
          ))}
        </div>
      </div>

      {issued.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-surface p-3 text-sm text-warning">
          <p className="font-medium">{t("issued", { count: issued.length })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => downloadText(`vendercrm-keys-${stamp}.csv`, keysCsv(issued, appUrl), "text/csv")}
            >
              <Download className="size-4" aria-hidden="true" />
              CSV
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(`vendercrm-keys-${stamp}.env.txt`, keysEnv(issued, appUrl), "text/plain")
              }
            >
              <Download className="size-4" aria-hidden="true" />
              {t("downloadEnv")}
            </Button>
          </div>
        </div>
      )}
      {refused.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t("refused", {
            domains: refused
              .slice(0, 10)
              .map((k) => k.domain)
              .join(", "),
            more: Math.max(0, refused.length - 10),
          })}
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="siteId" value={id} />
        ))}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-accent/40 px-3 py-2 text-sm">
            <span>{t("selected", { count: selected.size })}</span>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="replace" />
              {t("replace")}
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              <KeyRound className="size-4" aria-hidden="true" />
              {t("issueKeys", { count: selected.size })}
            </Button>
          </div>
        )}
      </form>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("noMatches")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label={t("selectAll")}
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const s of visible) {
                          if (allVisibleSelected) next.delete(s.siteId);
                          else next.add(s.siteId);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="py-2 pr-4 font-medium">{t("site")}</th>
                <th className="py-2 pr-4 font-medium">{t("business")}</th>
                <th className="py-2 pr-4 font-medium">{t("health")}</th>
                <th className="py-2 pr-4 font-medium">{t("lastLead")}</th>
                <th className="py-2 pr-4 text-right font-medium">{t("keys")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.siteId} className="border-b align-top hover:bg-accent/40">
                  <td className="py-2.5">
                    <input
                      type="checkbox"
                      aria-label={s.domain ?? s.slug}
                      checked={selected.has(s.siteId)}
                      onChange={() => toggle(s.siteId)}
                    />
                  </td>
                  <td className="py-2.5 pr-4">
                    <p className="font-medium">{s.domain ?? s.slug}</p>
                    {!s.isActive && (
                      <p className="text-xs text-muted-foreground">{t("inactive")}</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Link href={`/tenants/${s.tenantId}`} className="hover:underline">
                      {s.tenantName}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        s.health === "ok" && "bg-success-surface text-success",
                        s.health === "failing" && "bg-destructive-surface text-destructive",
                        s.health === "idle" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {t(`healthValues.${s.health}`)}
                    </span>
                    {s.health === "failing" && s.lastErrorReason && (
                      <p className="mt-1 text-xs text-destructive">
                        {s.lastErrorReason}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                    {s.lastSuccessAt
                      ? format.relativeTime(new Date(s.lastSuccessAt), nowDate)
                      : t("never")}
                  </td>
                  <td
                    className={cn(
                      "py-2.5 pr-4 text-right tabular-nums",
                      s.activeKeys === 0 && "text-destructive",
                    )}
                  >
                    {s.activeKeys}
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
