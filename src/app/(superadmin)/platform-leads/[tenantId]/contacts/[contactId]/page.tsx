import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { getPlatformContact } from "@/modules/tenancy/platform-crm";
import {
  LeadSubmissionCard,
  buildLeadCardLabels,
} from "@/components/leads/lead-submission-card";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import {
  AccountCell,
  buildPlatformLeadsLabels,
  StatusChip,
} from "../../../platform-leads-tables";

// One contact, read-only: its facts, its deals (each linking to the deal
// detail) and the form data of every submission it sent (PLAN.md §19.4). The
// same LeadSubmissionCard the tenant app renders. There is no "open in
// account" action here; acting on a contact is out of scope for the console.
//
// Defense in depth (§3.3): a layout is not an authorization boundary, so this
// page re-checks for itself. A (tenantId, contactId) pair that does not match,
// and an id that does not exist, are the same `notFound()`.
export default async function PlatformContactPage({
  params,
}: {
  params: Promise<{ tenantId: string; contactId: string }>;
}) {
  const sa = await requireSuperadminContext();
  const { tenantId, contactId } = await params;
  const t = await getTranslations("superadmin.platformLeads");
  const tl = await getTranslations("app.leadData");
  const locale = await getLocale();

  const contact = await getPlatformContact(
    sa,
    tenantId,
    contactId,
    tl.raw("fieldNames") as Record<string, string>,
  );
  if (!contact) notFound();

  const labels = buildPlatformLeadsLabels((key, values) =>
    t(key as "title", values),
  );
  const leadLabels = buildLeadCardLabels((key) => tl(key as "title"));
  const f = (key: string) => t(`contactDetail.facts.${key}` as "title");

  const facts: Array<[string, React.ReactNode]> = [
    [
      f("account"),
      <AccountCell
        key="a"
        name={contact.tenantName}
        status={contact.tenantStatus}
        labels={labels}
      />,
    ],
    [f("phone"), contact.phone],
    [f("email"), contact.email ?? "—"],
    [f("source"), contact.source ?? "—"],
    [f("firstSite"), contact.firstSiteDomain ?? contact.firstSiteName ?? "—"],
    [f("created"), formatDateTime(contact.createdAt, locale)],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={contact.name}
        description={t("contactDetail.readOnly")}
        action={
          <Link
            href="/platform-leads?view=contacts"
            className="text-sm underline underline-offset-4"
          >
            {t("contactDetail.back")}
          </Link>
        }
      />

      <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-medium">{t("contactDetail.deals")}</h2>
        {contact.deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("contactDetail.noDeals")}
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y rounded-md border">
            {contact.deals.map((deal) => (
              <li
                key={deal.id}
                className="flex min-w-0 flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words text-sm">{deal.title}</span>
                  <span className="break-words text-xs text-muted-foreground">
                    {deal.pipelineName} · {deal.stageName} ·{" "}
                    {formatDateTime(deal.createdAt, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusChip status={deal.status} labels={labels} />
                  <span className="whitespace-nowrap text-sm tabular-nums">
                    {formatMoney(deal.value, deal.currency, locale)}
                  </span>
                  <Link
                    href={`/platform-leads/${encodeURIComponent(contact.tenantId)}/deals/${encodeURIComponent(deal.id)}`}
                    className="whitespace-nowrap text-sm underline underline-offset-4"
                  >
                    {labels.openRow}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-medium">{t("contactDetail.leads")}</h2>
        {contact.leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("contactDetail.noLeads")}
          </p>
        ) : (
          contact.leads.map((view) => (
            <LeadSubmissionCard
              key={view.id}
              view={view}
              labels={leadLabels}
              locale={locale}
            />
          ))
        )}
      </section>
    </div>
  );
}
