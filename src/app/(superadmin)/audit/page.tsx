import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { AUDIT_LOG_PAGE_SIZE, countAuditLog, listAuditLog } from "@/modules/tenancy/audit";
import { listTenants } from "@/modules/tenancy/tenants";
import { PageHeader } from "@/components/page-header";
import { AuditTable } from "@/components/audit-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-fields";

// Cross-tenant audit feed. Defense in depth (§3.3): the layout redirects a
// non-superadmin, but a layout is not an authorization boundary.
//
// A GET form with the filters in searchParams (not a client-side filter)
// keeps every filtered view a shareable, bookmarkable URL — "show me every
// payment.* entry for this business last week" is a link, not a screenshot.
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenant?: string;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireSuperadminContext();
  const t = await getTranslations("audit");
  const { tenant, action, actor, from, to, page } = await searchParams;

  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const offset = (pageNum - 1) * AUDIT_LOG_PAGE_SIZE;

  const filters = {
    tenantId: tenant || undefined,
    action: action || undefined,
    actorEmail: actor || undefined,
    from: from ? new Date(`${from}T00:00:00`) : undefined,
    to: to ? new Date(`${to}T23:59:59`) : undefined,
  };

  const [entries, total, tenants] = await Promise.all([
    listAuditLog(filters, { limit: AUDIT_LOG_PAGE_SIZE, offset }),
    countAuditLog(filters),
    listTenants(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / AUDIT_LOG_PAGE_SIZE));

  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (tenant) params.set("tenant", tenant);
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `/audit?${query}` : "/audit";
  }

  const hasFilters = Boolean(tenant || action || actor || from || to);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.tenant")}
          <Select name="tenant" defaultValue={tenant ?? ""} className="min-w-[10rem]">
            <option value="">{t("filters.allTenants")}</option>
            {tenants.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.action")}
          <Input name="action" defaultValue={action ?? ""} placeholder={t("filters.actionPlaceholder")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.actor")}
          <Input name="actor" defaultValue={actor ?? ""} placeholder={t("filters.actorPlaceholder")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.from")}
          <Input type="date" name="from" defaultValue={from ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.to")}
          <Input type="date" name="to" defaultValue={to ?? ""} />
        </label>
        <Button type="submit" variant="outline" size="sm">
          {t("filters.apply")}
        </Button>
        {hasFilters && (
          <Link href="/audit" className="text-sm underline underline-offset-4">
            {t("filters.clear")}
          </Link>
        )}
      </form>

      <AuditTable entries={entries} showTenant />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t("filters.pageOf", { page: pageNum, total: totalPages })}</span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link href={pageHref(pageNum - 1)} className="underline underline-offset-4">
                {t("filters.prev")}
              </Link>
            )}
            {pageNum < totalPages && (
              <Link href={pageHref(pageNum + 1)} className="underline underline-offset-4">
                {t("filters.next")}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
