import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { getPlatformDeal } from "@/modules/tenancy/platform-crm";
import { LeadSubmissionCard, buildLeadCardLabels } from "@/components/leads/lead-submission-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { openInAccountAction } from "../../../actions";
import {
  AccountCell,
  buildPlatformLeadsLabels,
  StatusChip,
} from "../../../platform-leads-tables";

// One deal, read-only, with the full form data of every submission that
// opened it (PLAN.md §19.4). The same LeadSubmissionCard the tenant app
// renders — one code path, so the two cannot drift. Acting on the deal goes
// through "Abrir en la cuenta", never from here.
//
// Defense in depth (§3.3): a layout is not an authorization boundary, so this
// page re-checks for itself. A (tenantId, dealId) pair that does not match,
// and an id that does not exist, are the same `notFound()`.
export default async function PlatformDealPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string; dealId: string }>;
  searchParams: Promise<{ openError?: string }>;
}) {
  const sa = await requireSuperadminContext();
  const { tenantId, dealId } = await params;
  const { openError } = await searchParams;
  const t = await getTranslations("superadmin.platformLeads");
  const tl = await getTranslations("app.leadData");
  const locale = await getLocale();

  const deal = await getPlatformDeal(sa, tenantId, dealId, tl.raw("fieldNames") as Record<string, string>);
  if (!deal) notFound();

  const labels = buildPlatformLeadsLabels((key, values) => t(key as "title", values));
  const leadLabels = buildLeadCardLabels((key) => tl(key as "title"));
  const f = (key: string) => t(`detail.facts.${key}` as "title");

  const facts: Array<[string, React.ReactNode]> = [
    [f("account"), <AccountCell key="a" name={deal.tenantName} status={deal.tenantStatus} labels={labels} />],
    [f("contact"), deal.contactName],
    [f("phone"), deal.contactPhone],
    [f("email"), deal.contactEmail ?? "—"],
    [f("pipeline"), deal.pipelineName],
    [f("stage"), deal.stageName],
    [f("status"), <StatusChip key="s" status={deal.status} labels={labels} />],
    [f("value"), formatMoney(deal.value, deal.currency, locale)],
    [f("owner"), deal.ownerName ?? "—"],
    [f("created"), formatDateTime(deal.createdAt, locale)],
    [f("lastStageChange"), formatDateTime(deal.stageEnteredAt, locale)],
    [f("closed"), deal.closedAt ? formatDateTime(deal.closedAt, locale) : "—"],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={deal.title}
        description={t("detail.readOnly")}
        action={
          <>
            <Link href="/platform-leads" className="text-sm underline underline-offset-4">
              {t("detail.back")}
            </Link>
            <form action={openInAccountAction.bind(null, deal.tenantId, deal.id)}>
              <Button type="submit" size="sm" title={t("detail.openInAccountHint")}>
                {t("detail.openInAccount")}
              </Button>
            </form>
          </>
        }
      />

      {openError && (
        <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
          {t("detail.openError")}
        </p>
      )}

      <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-medium">{t("detail.leads")}</h2>
        {deal.leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.noLeads")}</p>
        ) : (
          deal.leads.map((view) => (
            <LeadSubmissionCard key={view.id} view={view} labels={leadLabels} locale={locale} />
          ))
        )}
      </section>
    </div>
  );
}
