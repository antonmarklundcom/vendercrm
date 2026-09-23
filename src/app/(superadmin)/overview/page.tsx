import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { requireSuperadminContext } from "@/modules/tenancy/context";
import {
  getMonthlyRevenue,
  getPlatformActivity,
  getPlatformTotals,
  listExpiringSubscriptions,
  listTenantActivity,
  windowOf,
} from "@/modules/tenancy/platform-stats";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatNumber } from "@/lib/i18n/format";

// How the platform itself is doing. The console could already show one
// tenant's billing and every tenant's WhatsApp health; what it could not show
// was the business — how many businesses there are, how much work is going
// through them, which ones have gone quiet, and whose plan runs out next.
//
// Defense in depth (§3.3): the layout redirects a non-superadmin, but a
// layout is not an authorization boundary — this page re-checks for itself.

const WINDOW_DAYS = 30;
/** No message for this long, on a business that has sent one before, is the
 * churn conversation worth having early. */
const QUIET_DAYS = 14;

export default async function PlatformOverviewPage() {
  await requireSuperadminContext();
  const t = await getTranslations("superadmin.overview");
  const locale = await getLocale();

  const window = windowOf(WINDOW_DAYS);
  const [totals, activity, tenantActivity, expiring, revenue] = await Promise.all([
    getPlatformTotals(),
    getPlatformActivity(window),
    listTenantActivity(window),
    listExpiringSubscriptions(30),
    getMonthlyRevenue(),
  ]);

  const n = (value: number) => formatNumber(value, locale);
  const quietSince = new Date(Date.now() - QUIET_DAYS * 24 * 60 * 60 * 1000);
  const quiet = tenantActivity.filter(
    (row) =>
      row.status === "active" &&
      row.messages === 0 &&
      (row.lastMessageAt === null || row.lastMessageAt < quietSince),
  );

  const stats = [
    { key: "tenants", value: n(totals.tenants), hint: t("activeOf", { count: totals.tenantsByStatus.active ?? 0 }) },
    { key: "users", value: n(totals.users), hint: t("multiBusiness", { count: totals.multiBusinessUsers }) },
    { key: "contacts", value: n(totals.contacts), hint: t("openDeals", { count: totals.openDeals }) },
    {
      key: "whatsapp",
      value: n(totals.whatsappAccounts),
      hint:
        totals.whatsappAccountsInError > 0
          ? t("inError", { count: totals.whatsappAccountsInError })
          : t("allHealthy"),
      alert: totals.whatsappAccountsInError > 0,
    },
    {
      key: "monthlyRevenue",
      value: formatMoney(revenue.monthlyRevenue, "PYG", locale),
      hint: t("payingTenants", { count: revenue.payingTenants }),
    },
  ] as const;

  const flow = [
    { key: "leads", value: activity.leads },
    { key: "contactsCreated", value: activity.contactsCreated },
    { key: "dealsCreated", value: activity.dealsCreated },
    { key: "dealsWon", value: activity.dealsWon },
    { key: "messagesIn", value: activity.messagesIn },
    { key: "messagesOut", value: activity.messagesOut },
    { key: "quotesSent", value: activity.quotesSent },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro", { days: WINDOW_DAYS })} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.key}>
            <span className="text-sm text-muted-foreground">
              {t(`stats.${stat.key}` as "stats.tenants")}
            </span>
            <span className="text-3xl font-semibold tabular-nums">{stat.value}</span>
            <span
              className={cn(
                "text-xs",
                "alert" in stat && stat.alert ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {stat.hint}
            </span>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("flowTitle", { days: WINDOW_DAYS })}</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {flow.map((item) => (
            <Card key={item.key}>
              <span className="text-sm text-muted-foreground">
                {t(`flow.${item.key}` as "flow.leads")}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{n(item.value)}</span>
            </Card>
          ))}
        </div>
      </section>

      {(quiet.length > 0 || expiring.length > 0) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("attentionTitle")}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {quiet.length > 0 && (
              <Card>
                <span className="text-sm font-medium">{t("quietTitle", { days: QUIET_DAYS })}</span>
                <ul className="flex flex-col gap-1 text-sm">
                  {quiet.slice(0, 8).map((row) => (
                    <li key={row.tenantId} className="flex justify-between gap-3">
                      <Link href={`/tenants/${row.tenantId}`} className="underline underline-offset-4">
                        {row.tenantName}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {row.lastMessageAt
                          ? t("lastMessage", { date: formatDate(row.lastMessageAt, locale) })
                          : t("neverMessaged")}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {expiring.length > 0 && (
              <Card>
                <span className="text-sm font-medium">{t("expiringTitle")}</span>
                <ul className="flex flex-col gap-1 text-sm">
                  {expiring.slice(0, 8).map((row) => (
                    <li key={row.tenantId} className="flex justify-between gap-3">
                      <Link href={`/tenants/${row.tenantId}`} className="underline underline-offset-4">
                        {row.tenantName}
                      </Link>
                      <span
                        className={cn(
                          "text-xs",
                          row.expiresAt < new Date()
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatDate(row.expiresAt, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("byTenantTitle", { days: WINDOW_DAYS })}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 font-medium">{t("table.tenant")}</th>
                <th className="py-2 font-medium">{t("table.status")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("table.leads")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("table.contacts")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("table.messages")}</th>
                <th className="py-2 font-medium">{t("table.lastMessage")}</th>
              </tr>
            </thead>
            <tbody>
              {tenantActivity.map((row) => (
                <tr key={row.tenantId} className="border-b">
                  <td className="py-2">
                    <Link href={`/tenants/${row.tenantId}`} className="underline underline-offset-4">
                      {row.tenantName}
                    </Link>
                  </td>
                  <td className="py-2 text-muted-foreground">{row.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(row.leads)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(row.contacts)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(row.messages)}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {row.lastMessageAt ? formatDate(row.lastMessageAt, locale) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
