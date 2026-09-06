import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  FileText,
  MessagesSquare,
  SquareKanban,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { DEFAULT_TIMEZONE, formatDateTime, formatNumber, formatTime } from "@/lib/i18n/format";

import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { getDashboardSummary } from "@/modules/dashboard/summary";
import { buildHoy, type HoyItem } from "@/modules/coach/hoy";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { TaskList, type TaskListLabels } from "@/components/task-list";
import { cn } from "@/lib/utils";
import {
  completeTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "../contacts/tasks-actions";
import { getLeadStats } from "@/modules/leads/stats";
import { listSites } from "@/modules/sites/sites";

// Tenant home. Two jobs: tell someone who already works here what needs
// attention today (the counters), and tell someone who just got their login
// what to do first (the checklist). Every number comes from the tenant-scoped
// read model in modules/dashboard — no raw db, no cross-tenant reads.

const STAT_TONES = {
  info: "bg-info-surface text-info",
  warning: "bg-warning-surface text-warning",
  destructive: "bg-destructive-surface text-destructive",
  success: "bg-success-surface text-success",
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  href: string;
  tone: keyof typeof STAT_TONES;
}) {
  return (
    <Card className="gap-3 transition-colors hover:bg-accent/40">
      <Link href={href} className="flex flex-col gap-3">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              STAT_TONES[tone],
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </Link>
    </Card>
  );
}

function ChecklistItem({
  done,
  title,
  description,
  actionLabel,
  href,
}: {
  done: boolean;
  title: string;
  description: string;
  actionLabel: string;
  href: string;
}) {
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <li className="flex items-start gap-3 border-b py-3 last:border-b-0">
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", done ? "text-primary" : "text-muted-foreground/60")}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>
          {title}
        </span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
      {!done && (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline"
        >
          {actionLabel}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

// "Hoy" (PLAN.md §15.3 L1, §15.8 P7): a ranked, rule-based list of what
// needs attention today — modules/coach/hoy.ts does the ranking, this is
// purely the render, one row per item with the one deep-link action.
const HOY_SEVERITY_DOT = {
  high: "bg-destructive",
  medium: "bg-warning",
  low: "bg-info",
} as const;

function HoyPanel({ items, title, empty }: { items: HoyItem[]; title: string; empty: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Card className="py-1">
          <ul className="flex flex-col">
            {items.map((item, index) => (
              <li
                key={`${item.kind}-${index}`}
                className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", HOY_SEVERITY_DOT[item.severity])}
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className="text-sm text-muted-foreground">{item.subtitle}</span>
                  </div>
                </div>
                <Link
                  href={item.url}
                  className="flex shrink-0 items-center gap-1 text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline"
                >
                  {item.action}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.dashboard");
  const locale = await getLocale();
  const formatNumberL = (value: number) => formatNumber(value, locale);
  const tActivity = await getTranslations("app.contacts.activityTypes");

  // The tenant is read first because the summary needs its timezone: which
  // appointments count as "today" is a question only the business can answer.
  const tenant = await getTenant(ctx.tenantId);
  const timeZone = tenant?.timezone || DEFAULT_TIMEZONE;

  const [summary, leadStats, sites, hoy] = await Promise.all([
    getDashboardSummary(ctx, { timeZone }),
    getLeadStats(ctx),
    listSites(ctx),
    buildHoy(ctx),
  ]);

  // Sites are shown by name; the stats module groups by id because that is
  // what the submission row carries.
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  const { stats, checklist, recentActivity, dueTasks, todayAppointments, onboardingPending } =
    summary;
  const tTasks = await getTranslations("app.contacts.tasks");
  const tLeads = await getTranslations("app.dashboard.leads");
  const tHoy = await getTranslations("app.dashboard.hoy");
  const taskLabels: TaskListLabels = {
    complete: tTasks("complete"),
    reopen: tTasks("reopen"),
    delete: tTasks("delete"),
    overdue: tTasks("overdue"),
  };
  const isAdmin = ctx.role === "admin";

  // Steps an `agent` can't act on (WhatsApp connection, automations — §3.2)
  // are left out of their list rather than shown as a dead end.
  const steps = [
    {
      key: "whatsapp",
      done: checklist.whatsappConnected,
      href: "/whatsapp",
      visible: isAdmin,
    },
    { key: "contact", done: checklist.hasContact, href: "/contacts", visible: true },
    { key: "deal", done: checklist.hasDeal, href: "/pipeline", visible: true },
    { key: "quote", done: checklist.hasQuote, href: "/quotes", visible: true },
    {
      key: "capture",
      done: checklist.hasLeadCapture,
      href: isAdmin ? "/sites" : "/forms",
      visible: true,
    },
    {
      key: "automation",
      done: checklist.hasActiveAutomation,
      href: "/automations",
      visible: isAdmin,
    },
  ].filter((step) => step.visible);

  const doneCount = steps.filter((step) => step.done).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title", { tenant: tenant?.name ?? "" })}
        description={t("subtitle")}
      />

      <HoyPanel items={hoy} title={tHoy("title")} empty={tHoy("empty")} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={SquareKanban}
          label={t("stats.openDeals")}
          value={formatNumberL(stats.openDeals)}
          hint={t("stats.openDealsHint", {
            value: formatNumberL(stats.openDealsValuePyg),
          })}
          href="/pipeline"
          tone="info"
        />
        <StatCard
          icon={MessagesSquare}
          label={t("stats.unread")}
          value={formatNumberL(stats.unreadMessages)}
          hint={t("stats.unreadHint", { count: stats.unreadConversations })}
          href="/inbox"
          tone="warning"
        />
        <StatCard
          icon={FileText}
          label={t("stats.pendingQuotes")}
          value={formatNumberL(stats.pendingQuotes)}
          hint={t("stats.pendingQuotesHint")}
          href="/quotes"
          tone="destructive"
        />
        <StatCard
          icon={Users}
          label={t("stats.contacts")}
          value={formatNumberL(stats.contacts)}
          hint={t("stats.contactsHint")}
          href="/contacts"
          tone="success"
        />
      </section>

      {todayAppointments.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("todayAgenda.title")}</h2>
            <Link href="/calendar" className="text-sm underline underline-offset-4">
              {t("todayAgenda.viewAll")}
            </Link>
          </div>
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {todayAppointments.map((appointment) => (
              <li key={appointment.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                <span className="w-16 text-sm tabular-nums text-muted-foreground">
                  {appointment.allDay
                    ? t("todayAgenda.allDay")
                    : formatTime(appointment.startsAt, locale, timeZone)}
                </span>
                <Link
                  href={`/calendar/${appointment.id}`}
                  className="text-sm font-medium underline underline-offset-4"
                >
                  {appointment.title}
                </Link>
                {appointment.contactName && appointment.contactId && (
                  <Link
                    href={`/contacts/${appointment.contactId}`}
                    className="text-sm text-muted-foreground underline underline-offset-4"
                  >
                    {appointment.contactName}
                  </Link>
                )}
                {appointment.location && (
                  <span className="text-sm text-muted-foreground">{appointment.location}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dueTasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("dueTasks.title")}</h2>
          <TaskList
            tasks={dueTasks.map((task) => ({
              id: task.id,
              title: task.title,
              dueAt: task.dueAt,
              completed: false,
              contactId: task.contactId,
              contactName: task.contactName,
            }))}
            labels={taskLabels}
            onComplete={completeTaskAction.bind(null, "/dashboard")}
            onReopen={reopenTaskAction.bind(null, "/dashboard")}
            onDelete={deleteTaskAction.bind(null, "/dashboard")}
          />
        </section>
      )}

      {onboardingPending && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("checklist.title")}</h2>
            <span className="text-sm text-muted-foreground">
              {t("checklist.progress", { done: doneCount, total: steps.length })}
            </span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("checklist.intro")}</p>
          <Card className="py-1">
            <ul className="flex flex-col">
              {steps.map((step) => (
                <ChecklistItem
                  key={step.key}
                  done={step.done}
                  href={step.href}
                  title={t(`checklist.steps.${step.key}.title` as "checklist.steps.contact.title")}
                  description={t(
                    `checklist.steps.${step.key}.description` as "checklist.steps.contact.description",
                  )}
                  actionLabel={t(
                    `checklist.steps.${step.key}.action` as "checklist.steps.contact.action",
                  )}
                />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("activity.title")}</h2>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("activity.empty")}</p>
        ) : (
          <Card className="py-1">
            <ul className="flex flex-col">
              {recentActivity.map((activity) => (
                <li
                  key={activity.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-sm last:border-b-0"
                >
                  <span>
                    <Link
                      href={`/contacts/${activity.contactId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {activity.contactName}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      {tActivity(activity.type)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(activity.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Where the leads came from (PLAN.md §13 H8). modules/leads/stats.ts
          has produced these counts since the ingest work landed and nothing
          rendered them — the tenant could see that a lead arrived, but not
          which campaign paid for it. */}
      {leadStats.total > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{tLeads("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {tLeads("intro", { total: leadStats.total, withDeal: leadStats.withDeal })}
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            <LeadBreakdown
              title={tLeads("bySite")}
              empty={tLeads("empty")}
              rows={leadStats.bySite.map((row) => ({
                ...row,
                key: siteNames.get(row.key) ?? row.key,
              }))}
            />
            <LeadBreakdown
              title={tLeads("bySource")}
              empty={tLeads("empty")}
              rows={leadStats.bySource}
            />
            <LeadBreakdown
              title={tLeads("byCampaign")}
              empty={tLeads("empty")}
              rows={leadStats.byCampaign}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function LeadBreakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ key: string; count: number }>;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.key} className="border-b last:border-b-0">
                  <td className="py-1 pr-3">{row.key}</td>
                  <td className="py-1 text-right tabular-nums">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
