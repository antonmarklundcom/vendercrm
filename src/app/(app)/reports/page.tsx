import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { requireTenantContext } from "@/modules/tenancy/context";
import { getSalesReport, previousWindow } from "@/modules/reports/sales";
import { withComparison } from "@/modules/reports/compare";
import { listTenantUsers } from "@/modules/tenancy/users";
import { listPipelines } from "@/modules/crm/pipelines";
import { listSites } from "@/modules/sites/sites";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber } from "@/lib/i18n/format";
import { DAY_PRESETS, parseReportFilters, parseReportsWindow, type ReportsSearchParams } from "./query";
import { SortableTable, type SortableColumn } from "./SortableTable";

// Lead-to-sale reporting for the business (PLAN.md §10 1J, §17.3 P15 "v2").
// Open to agente as well as admin: the pipeline is shared (§1.2), so the
// numbers over it are too, and a rep who cannot see their own conversion
// rate cannot improve it.
//
// Not web analytics — pageviews and traffic funnels are deliberately not in
// this repo (§1.2). Everything here is something the CRM already owns.
//
// Every filter lives in the URL (§10 1R #1) — the CSV export
// (/api/exports/reports/[table]) reads the exact same params through the
// same parser, so "exportar" always means "what's on screen".

function buildHref(base: ReportsSearchParams, overrides: Partial<ReportsSearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `/reports?${qs}` : "/reports";
}

function toQueryString(params: ReportsSearchParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, String(value));
  }
  return search.toString();
}

function delta(current: number, previous: number): string | null {
  if (previous === 0) return current === 0 ? null : "+100%";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportsSearchParams>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.reports");
  const locale = await getLocale();
  const params = await searchParams;

  const window = parseReportsWindow(params);
  const filters = parseReportFilters(params);
  const previous = previousWindow(window);

  const [report, previousReport, users, pipelines, sites] = await Promise.all([
    getSalesReport(ctx, window, filters),
    getSalesReport(ctx, previous, filters),
    listTenantUsers(ctx),
    listPipelines(ctx),
    listSites(ctx),
  ]);

  const n = (value: number) => formatNumber(value, locale);
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  const { funnel, response } = report;
  const rate = (part: number, whole: number) =>
    whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

  const funnelSteps = [
    { key: "leads", value: funnel.leads, previous: previousReport.funnel.leads, hint: null },
    {
      key: "dealsOpened",
      value: funnel.dealsOpened,
      previous: previousReport.funnel.dealsOpened,
      hint: rate(funnel.leadsWithDeal, funnel.leads),
    },
    {
      key: "dealsWon",
      value: funnel.dealsWon,
      previous: previousReport.funnel.dealsWon,
      hint: rate(funnel.dealsWon, funnel.dealsOpened),
    },
    {
      key: "dealsLost",
      value: funnel.dealsLost,
      previous: previousReport.funnel.dealsLost,
      hint: null,
    },
  ] as const;

  const agentColumns: SortableColumn<(typeof report.byAgent)[number]>[] = [
    { key: "agent", label: t("table.agent"), value: (row) => userNames.get(row.userId) ?? row.userId },
    { key: "leads", label: t("table.leads"), align: "right", value: (row) => row.leads },
    { key: "opened", label: t("table.opened"), align: "right", value: (row) => row.dealsOpened },
    { key: "won", label: t("table.won"), align: "right", value: (row) => row.dealsWon },
    { key: "lost", label: t("table.lost"), align: "right", value: (row) => row.dealsLost },
    {
      key: "wonValue",
      label: t("table.wonValue"),
      align: "right",
      value: (row) => row.wonValue,
      format: (row) => formatMoney(row.wonValue, funnel.currency, locale),
    },
    {
      key: "response",
      label: t("table.responseMedian"),
      align: "right",
      value: (row) => row.responseMedianMinutes ?? -1,
      format: (row) => (row.responseMedianMinutes === null ? "—" : t("minutes", { count: Math.round(row.responseMedianMinutes) })),
    },
  ];

  const sourceRows = withComparison(report.bySource, previousReport.bySource, (r) => r.key, (r) => r.leads);
  const siteRows = withComparison(
    report.bySite.map((row) => ({ ...row, key: siteNames.get(row.key) ?? row.key })),
    previousReport.bySite.map((row) => ({ ...row, key: siteNames.get(row.key) ?? row.key })),
    (r) => r.key,
    (r) => r.leads,
  );

  function sourceColumns(labelKey: string): SortableColumn<(typeof sourceRows)[number]>[] {
    return [
      { key: "key", label: t(labelKey as "table.source"), value: (row) => row.key },
      { key: "leads", label: t("table.leads"), align: "right", value: (row) => row.leads },
      { key: "deals", label: t("table.deals"), align: "right", value: (row) => row.deals },
      { key: "won", label: t("table.won"), align: "right", value: (row) => row.won },
      {
        key: "wonValue",
        label: t("table.wonValue"),
        align: "right",
        value: (row) => row.wonValue,
        format: (row) => formatMoney(row.wonValue, funnel.currency, locale),
      },
      {
        key: "previous",
        label: t("vsPrevious"),
        align: "right",
        value: (row) => row.previous,
        format: (row) => delta(row.leads, row.previous) ?? "—",
      },
    ];
  }

  const stageColumns: SortableColumn<(typeof report.stageConversion)[number]>[] = [
    { key: "stage", label: t("table.stage"), value: (row) => row.position, format: (row) => row.name },
    {
      key: "reachedOrPast",
      label: t("table.reachedOrPast"),
      align: "right",
      value: (row) => row.reachedOrPast,
    },
  ];

  const responseColumns: SortableColumn<(typeof report.responseDistribution)[number]>[] = [
    {
      key: "bucket",
      label: t("table.bucket"),
      value: (row) => row.bucket,
      format: (row) => t(`responseBuckets.${row.bucket}` as "responseBuckets.under15m"),
    },
    { key: "count", label: t("table.conversations"), align: "right", value: (row) => row.count },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("customRange")}</span>
          <div className="flex gap-2">
            {DAY_PRESETS.map((preset) => (
              <Link
                key={preset}
                href={buildHref(params, { days: String(preset), from: undefined, to: undefined })}
                className={cn(
                  buttonVariants({
                    variant: !params.from && Number(params.days ?? 30) === preset ? "default" : "outline",
                    size: "sm",
                  }),
                )}
              >
                {t("period", { days: preset })}
              </Link>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("from")}
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className="h-8 rounded-md border bg-card px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("to")}
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className="h-8 rounded-md border bg-card px-2 text-sm text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("pipeline")}
          <Select name="pipelineId" defaultValue={params.pipelineId ?? ""} className="h-8">
            <option value="">{t("allPipelines")}</option>
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("agent")}
          <Select name="agentUserId" defaultValue={params.agentUserId ?? ""} className="h-8">
            <option value="">{t("allAgents")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </label>

        <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
          {t("apply")}
        </button>
      </form>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {funnelSteps.map((step) => (
          <Card key={step.key}>
            <span className="text-sm text-muted-foreground">
              {t(`funnel.${step.key}` as "funnel.leads")}
            </span>
            <span className="text-3xl font-semibold tabular-nums">{n(step.value)}</span>
            <span className="text-xs text-muted-foreground">
              {step.hint && `${t("conversion", { rate: step.hint })} · `}
              {delta(step.value, step.previous)
                ? `${delta(step.value, step.previous)} ${t("vsPrevious")}`
                : t("vsPrevious")}
            </span>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <span className="text-sm text-muted-foreground">{t("wonValue")}</span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatMoney(funnel.wonValue, funnel.currency, locale)}
          </span>
        </Card>
        <Card>
          <span className="text-sm text-muted-foreground">{t("responseTitle")}</span>
          <span className="text-2xl font-semibold tabular-nums">
            {response.medianMinutes === null
              ? "—"
              : t("minutes", { count: Math.round(response.medianMinutes) })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("responseHint", { answered: response.answered, unanswered: response.unanswered })}
          </span>
        </Card>
      </section>

      {report.byMonth.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("byMonthTitle")}</h2>
          <ul className="flex flex-col gap-2">
            {report.byMonth.map((month) => {
              const maxMonth = Math.max(1, ...report.byMonth.map((m) => m.won + m.lost));
              return (
                <li key={month.month} className="flex items-center gap-3 text-sm">
                  <span className="w-20 tabular-nums text-muted-foreground">{month.month}</span>
                  <span className="flex h-4 flex-1 overflow-hidden rounded-sm bg-muted">
                    <span className="bg-success" style={{ width: `${(month.won / maxMonth) * 100}%` }} />
                    <span
                      className="bg-destructive/60"
                      style={{ width: `${(month.lost / maxMonth) * 100}%` }}
                    />
                  </span>
                  <span className="w-32 text-right tabular-nums">
                    {t("wonLost", { won: month.won, lost: month.lost })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("bySourceTitle")}</h2>
            <a href={`/api/exports/reports/sources?${toQueryString(params)}`} className="text-sm underline underline-offset-4">
              {t("exportCsv")}
            </a>
          </div>
          <SortableTable
            rows={sourceRows}
            rowKey={(row) => row.key}
            columns={sourceColumns("table.source")}
            empty={t("table.empty")}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("bySiteTitle")}</h2>
            <a href={`/api/exports/reports/sites?${toQueryString(params)}`} className="text-sm underline underline-offset-4">
              {t("exportCsv")}
            </a>
          </div>
          <SortableTable
            rows={siteRows}
            rowKey={(row) => row.key}
            columns={sourceColumns("table.site")}
            empty={t("table.empty")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("byAgentTitle")}</h2>
          <a href={`/api/exports/reports/agents?${toQueryString(params)}`} className="text-sm underline underline-offset-4">
            {t("exportCsv")}
          </a>
        </div>
        <SortableTable
          rows={report.byAgent}
          rowKey={(row) => row.userId}
          columns={agentColumns}
          empty={t("table.empty")}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("stageConversionTitle")}</h2>
          {filters.pipelineId && (
            <a href={`/api/exports/reports/stages?${toQueryString(params)}`} className="text-sm underline underline-offset-4">
              {t("exportCsv")}
            </a>
          )}
        </div>
        {filters.pipelineId ? (
          <SortableTable
            rows={report.stageConversion}
            rowKey={(row) => row.stageId}
            columns={stageColumns}
            defaultSort={{ key: "stage", direction: "asc" }}
            empty={t("table.empty")}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("stageConversionHint")}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("responseDistributionTitle")}</h2>
          <a href={`/api/exports/reports/response?${toQueryString(params)}`} className="text-sm underline underline-offset-4">
            {t("exportCsv")}
          </a>
        </div>
        <SortableTable
          rows={report.responseDistribution}
          rowKey={(row) => row.bucket}
          columns={responseColumns}
          defaultSort={{ key: "bucket", direction: "asc" }}
          empty={t("table.empty")}
        />
      </section>
    </div>
  );
}
