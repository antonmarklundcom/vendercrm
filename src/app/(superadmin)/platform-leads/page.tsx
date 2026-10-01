import Link from "next/link";
import { Download, Inbox } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { listTenants } from "@/modules/tenancy/tenants";
import { listPlatformSites } from "@/modules/tenancy/console-sites";
import {
  listPlatformContacts,
  listPlatformDeals,
  listPlatformLeads,
  PLATFORM_CRM_DATE_PRESETS,
  PLATFORM_CRM_DEFAULT_DAYS,
  PLATFORM_CRM_EXPORT_MAX_ROWS,
  type PlatformCrmPage,
} from "@/modules/tenancy/platform-crm";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import {
  parsePlatformLeadsParams,
  platformLeadsExportHref,
  platformLeadsHref,
  PLATFORM_LEADS_VIEWS,
  type ParsedPlatformLeadsParams,
} from "./filters";
import {
  buildPlatformLeadsLabels,
  ContactsTable,
  DealsTable,
  LeadsTable,
} from "./platform-leads-tables";

// Leads, deals and contacts of every account in one list (PLAN.md §19.4).
// A read-only window: it never builds a tenant context and writes nothing but
// the audit row the reader records.
//
// Defense in depth (§3.3): the layout redirects a non-superadmin, but a layout
// is not an authorization boundary — this page checks for itself, before
// anything is read. It calls exactly one reader per render, so one view is
// one `platform.crm.viewed` audit row. The "Exportar CSV" link goes to
// ./export/route.ts, which checks again for itself and audits its own row.
export default async function PlatformLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sa = await requireSuperadminContext();
  const t = await getTranslations("superadmin.platformLeads");
  const locale = await getLocale();
  const parsed = parsePlatformLeadsParams(await searchParams);
  const labels = buildPlatformLeadsLabels((key, values) => t(key as "title", values));

  const [result, tenants, sites] = await Promise.all([
    parsed.view === "deals"
      ? listPlatformDeals(sa, parsed.filters, parsed.page)
      : parsed.view === "contacts"
        ? listPlatformContacts(sa, parsed.filters, parsed.page)
        : listPlatformLeads(sa, parsed.filters, parsed.page),
    listTenants(),
    listPlatformSites(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasFilters = Boolean(
    parsed.values.tenantIds.length ||
      parsed.values.days !== null ||
      parsed.values.from ||
      parsed.values.status ||
      parsed.values.source ||
      parsed.values.utmSource ||
      parsed.values.q,
  );

  const sitesByTenant = new Map<string, typeof sites>();
  for (const site of sites) {
    sitesByTenant.set(site.tenantId, [...(sitesByTenant.get(site.tenantId) ?? []), site]);
  }
  const activeDays = parsed.values.days ?? PLATFORM_CRM_DEFAULT_DAYS;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />

      <nav className="flex flex-wrap gap-1 border-b" aria-label={t("title")}>
        {PLATFORM_LEADS_VIEWS.map((view) => (
          <Link
            key={view}
            href={platformLeadsHref(parsed, { view, page: 1 })}
            aria-current={parsed.view === view ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              parsed.view === view
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${view}`)}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3">
        {parsed.view !== "leads" && <input type="hidden" name="view" value={parsed.view} />}
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.account")}
          <Select
            name="tenant"
            multiple
            size={4}
            defaultValue={parsed.values.tenantIds}
            className="w-full min-w-0 sm:w-56"
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </Select>
          <span>{t("filters.accountHint")}</span>
        </label>
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.period")}
            <Select name="days" defaultValue={String(activeDays)}>
              {PLATFORM_CRM_DATE_PRESETS.map((days) => (
                <option key={days} value={days}>
                  {t("filters.days", { days })}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              {t("filters.from")}
              <Input type="date" name="from" defaultValue={parsed.values.from} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              {t("filters.to")}
              <Input type="date" name="to" defaultValue={parsed.values.to} />
            </label>
          </div>
          <span className="text-xs text-muted-foreground">{t("filters.customHint")}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.status")}
            <Select name="status" defaultValue={parsed.values.status}>
              <option value="">{t("filters.anyStatus")}</option>
              <option value="open">{t("filters.open")}</option>
              <option value="won">{t("filters.won")}</option>
              <option value="lost">{t("filters.lost")}</option>
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.source")}
            <Select name="source" defaultValue={parsed.values.source}>
              <option value="">{t("filters.anySource")}</option>
              <option value="form">{t("filters.form")}</option>
              <option value="booking">{t("filters.booking")}</option>
              <option value="chat">{t("filters.chat")}</option>
              {[...sitesByTenant.entries()].map(([tenantId, list]) => (
                <optgroup key={tenantId} label={list[0].tenantName}>
                  {list.map((site) => (
                    <option key={site.siteId} value={`site:${site.siteId}`}>
                      {site.domain ?? site.slug}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.utm")}
            <Input name="utm" maxLength={200} defaultValue={parsed.values.utmSource} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.search")}
            <Input
              name="q"
              maxLength={100}
              defaultValue={parsed.values.q}
              placeholder={t("filters.searchPlaceholder")}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" size="sm">
            {t("filters.apply")}
          </Button>
          {hasFilters && (
            <Link
              href={parsed.view === "leads" ? "/platform-leads" : `/platform-leads?view=${parsed.view}`}
              className="text-sm underline underline-offset-4"
            >
              {t("filters.clear")}
            </Link>
          )}
        </div>
      </form>

      {parsed.exportError === "too_many_rows" && (
        <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
          {t("export.tooManyRows", { max: PLATFORM_CRM_EXPORT_MAX_ROWS })}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("results", { total: result.total })}</p>
        {/* Leads only: deals/contacts export is out of scope (§19.6). A plain
            <a>, not <Link>: it is a file download, not a page to prefetch. */}
        {parsed.view === "leads" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("export.hint", { max: PLATFORM_CRM_EXPORT_MAX_ROWS })}
            </span>
            <Button asChild variant="outline" size="sm">
              <a href={platformLeadsExportHref(parsed)}>
                <Download className="size-4" aria-hidden="true" />
                {t("export.button")}
              </a>
            </Button>
          </div>
        )}
      </div>

      {result.rows.length === 0 ? (
        <EmptyState icon={Inbox} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ResultTable parsed={parsed} result={result} labels={labels} locale={locale} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t("pageOf", { page: result.page, pages: totalPages })}</span>
          <div className="flex gap-3">
            {result.page > 1 && (
              <Link
                href={platformLeadsHref(parsed, { page: result.page - 1 })}
                className="underline underline-offset-4"
              >
                {t("prev")}
              </Link>
            )}
            {result.page < totalPages && (
              <Link
                href={platformLeadsHref(parsed, { page: result.page + 1 })}
                className="underline underline-offset-4"
              >
                {t("next")}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({
  parsed,
  result,
  labels,
  locale,
}: {
  parsed: ParsedPlatformLeadsParams;
  // The reader that ran matches the view, so the rows are of that view's type.
  result: PlatformCrmPage<unknown>;
  labels: ReturnType<typeof buildPlatformLeadsLabels>;
  locale: string;
}) {
  if (parsed.view === "deals") {
    return (
      <DealsTable
        rows={result.rows as Parameters<typeof DealsTable>[0]["rows"]}
        labels={labels}
        locale={locale}
      />
    );
  }
  if (parsed.view === "contacts") {
    return (
      <ContactsTable
        rows={result.rows as Parameters<typeof ContactsTable>[0]["rows"]}
        labels={labels}
        locale={locale}
      />
    );
  }
  return (
    <LeadsTable
      rows={result.rows as Parameters<typeof LeadsTable>[0]["rows"]}
      labels={labels}
      locale={locale}
    />
  );
}
