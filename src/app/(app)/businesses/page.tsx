import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Smartphone,
  SquareKanban,
  Target,
  type LucideIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { requireTenantContext } from "@/modules/tenancy/context";
import {
  listPortfolio,
  listPortfolioMessages,
  PORTFOLIO_LEAD_WINDOW_DAYS,
  type PortfolioBusiness,
  type PortfolioMessage,
} from "@/modules/tenancy/portfolio";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatNumber, formatTime } from "@/lib/i18n/format";
import { openBusinessAction } from "./actions";

// "All my businesses" — the owner's view across every business they belong to
// (modules/tenancy/portfolio.ts has the why). Two questions, one screen:
// which business needs me first, and who is waiting for an answer anywhere.
// Everything is read from the signed-in user's own memberships; the only
// write is stepping into a business, and that goes through the same
// membership check as the switcher.

const SORTS = ["priority", "name", "leads", "recent"] as const;
type Sort = (typeof SORTS)[number];

function sortBusinesses(rows: PortfolioBusiness[], sort: Sort): PortfolioBusiness[] {
  const copy = [...rows];
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "leads":
      return copy.sort((a, b) => b.leads - a.leads || b.priority - a.priority);
    case "recent":
      return copy.sort(
        (a, b) => (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0),
      );
    default:
      return copy.sort(
        (a, b) =>
          b.priority - a.priority ||
          (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0),
      );
  }
}

/** A stable colour per business, so the same business reads the same in the
 * message list and on its card — the fastest "whose is this?" cue there is. */
function businessHue(tenantId: string): number {
  let hash = 0;
  for (const char of tenantId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function BusinessDot({ tenantId, className }: { tenantId: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: `hsl(${businessHue(tenantId)} 65% 50%)` }}
    />
  );
}

function relative(value: Date | null, locale: string, now: Date): string | null {
  if (!value) return null;
  const minutes = Math.round((value.getTime() - now.getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  return formatDate(value, locale);
}

/** Hidden-field form that steps into a business (see ./actions.ts). */
function OpenForm({
  tenantId,
  to,
  conversation,
  children,
  className,
}: {
  tenantId: string;
  to?: string;
  conversation?: { id: string; channel: "whatsapp" | "webchat" };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form action={openBusinessAction} className={className}>
      <input type="hidden" name="tenantId" value={tenantId} />
      {to && <input type="hidden" name="to" value={to} />}
      {conversation && (
        <>
          <input type="hidden" name="conversationId" value={conversation.id} />
          <input type="hidden" name="channel" value={conversation.channel} />
        </>
      )}
      {children}
    </form>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  alert,
  extra,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  alert?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </span>
      <span
        className={cn(
          "flex items-baseline gap-1 text-lg font-semibold tabular-nums",
          alert && "text-destructive",
        )}
      >
        {value}
        {extra}
      </span>
    </div>
  );
}

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; msgs?: string }>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.businesses");
  const tRoles = await getTranslations("app.users.roles");
  const locale = await getLocale();
  const params = await searchParams;
  const sort: Sort = SORTS.includes(params.sort as Sort) ? (params.sort as Sort) : "priority";
  const q = params.q?.trim().toLowerCase() || "";
  const showAllMessages = params.msgs === "all";

  const [portfolio, messages] = await Promise.all([
    listPortfolio(ctx.userId),
    listPortfolioMessages(ctx.userId, { unreadOnly: !showAllMessages, limit: 60 }),
  ]);

  const now = new Date();
  const n = (value: number) => formatNumber(value, locale);

  if (portfolio.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        <EmptyState icon={Building2} title={t("emptyTitle")} description={t("emptyBody")} />
      </div>
    );
  }

  const filtered = sortBusinesses(
    q ? portfolio.filter((row) => row.name.toLowerCase().includes(q)) : portfolio,
    sort,
  );
  // Sorting by priority splits the list: what needs someone now, then a
  // compact list of the ones that are fine. With fifty lead-gen sites the
  // second group is most of them, and a card each would bury the first.
  const needsAttention = sort === "priority" ? filtered.filter((row) => row.priority > 0) : filtered;
  const quiet = sort === "priority" ? filtered.filter((row) => row.priority === 0) : [];

  const totals = portfolio.reduce(
    (acc, row) => ({
      unread: acc.unread + row.unreadConversations,
      leads: acc.leads + row.leads,
      overdue: acc.overdue + row.overdueTasks,
      attention: acc.attention + (row.priority > 0 ? 1 : 0),
    }),
    { unread: 0, leads: 0, overdue: 0, attention: 0 },
  );

  const summary = [
    { key: "unread", icon: MessagesSquare, value: totals.unread, alert: totals.unread > 0 },
    { key: "leads", icon: Target, value: totals.leads, alert: false },
    { key: "overdue", icon: CalendarClock, value: totals.overdue, alert: totals.overdue > 0 },
    { key: "attention", icon: AlertTriangle, value: totals.attention, alert: false },
  ] as const;

  const sortHref = (value: Sort) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (value !== "priority") search.set("sort", value);
    if (showAllMessages) search.set("msgs", "all");
    const s = search.toString();
    return s ? `/businesses?${s}` : "/businesses";
  };
  const msgsHref = (all: boolean) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (sort !== "priority") search.set("sort", sort);
    if (all) search.set("msgs", "all");
    const s = search.toString();
    return `${s ? `/businesses?${s}` : "/businesses"}#mensajes`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("intro", { count: portfolio.length, days: PORTFOLIO_LEAD_WINDOW_DAYS })}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map((item) => (
          <Card key={item.key} className="gap-1 p-4">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <item.icon className="size-3.5" aria-hidden="true" />
              {t(`summary.${item.key}`, { days: PORTFOLIO_LEAD_WINDOW_DAYS })}
            </span>
            <span
              className={cn(
                "text-2xl font-semibold tabular-nums",
                item.alert && "text-destructive",
              )}
            >
              {n(item.value)}
            </span>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Businesses */}
        <section className="flex min-w-0 flex-col gap-4 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("businessesTitle")}</h2>
            <form action="/businesses" className="flex items-center gap-2">
              {sort !== "priority" && <input type="hidden" name="sort" value={sort} />}
              {showAllMessages && <input type="hidden" name="msgs" value="all" />}
              <Input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder={t("search")}
                aria-label={t("search")}
                className="h-8 w-48"
              />
            </form>
          </div>

          <nav aria-label={t("sortLabel")} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("sortLabel")}</span>
            {SORTS.map((value) => (
              <Link
                key={value}
                href={sortHref(value)}
                aria-current={value === sort ? "page" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-1",
                  value === sort ? "bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {t(`sort.${value}`)}
              </Link>
            ))}
          </nav>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMatch")}</p>
          ) : (
            <>
              {sort === "priority" && needsAttention.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t("allCalm")}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {needsAttention.map((row) => (
                  <BusinessCard
                    key={row.tenantId}
                    row={row}
                    active={row.tenantId === ctx.tenantId}
                    locale={locale}
                    labels={{
                      role: tRoles(row.role),
                      current: t("current"),
                      unread: t("metrics.unread"),
                      leads: t("metrics.leads", { days: PORTFOLIO_LEAD_WINDOW_DAYS }),
                      deals: t("metrics.deals"),
                      overdue: t("metrics.overdue"),
                      unassigned: t("unassigned", { count: row.unassignedConversations }),
                      waError: t("waError"),
                      grace: t("access.grace"),
                      locked: t("access.locked"),
                      lastMessage: row.lastInboundAt
                        ? t("lastMessage", { when: relative(row.lastInboundAt, locale, now) ?? "" })
                        : t("neverMessaged"),
                      lastLead: row.lastLeadAt
                        ? t("lastLead", { when: relative(row.lastLeadAt, locale, now) ?? "" })
                        : null,
                      dealsValue:
                        row.openDealsValue > 0 ? formatMoney(row.openDealsValue, "PYG", locale) : null,
                      open: t("actions.open"),
                      inbox: t("actions.inbox"),
                      pipeline: t("actions.pipeline"),
                      trendUp: t("trendUp", { previous: row.leadsPrevious }),
                      trendDown: t("trendDown", { previous: row.leadsPrevious }),
                    }}
                  />
                ))}
              </div>

              {quiet.length > 0 && (
                <details className="rounded-xl border" open={needsAttention.length === 0}>
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                    {t("quietTitle", { count: quiet.length })}
                  </summary>
                  <ul className="divide-y border-t">
                    {quiet.map((row) => (
                      <li key={row.tenantId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <BusinessDot tenantId={row.tenantId} />
                          <span className="truncate">{row.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {row.lastInboundAt
                              ? t("lastMessage", { when: relative(row.lastInboundAt, locale, now) ?? "" })
                              : t("neverMessaged")}
                          </span>
                        </span>
                        <OpenForm tenantId={row.tenantId} to="/dashboard">
                          <Button type="submit" variant="ghost" size="sm">
                            {t("actions.open")}
                          </Button>
                        </OpenForm>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>

        {/* Messages from every business */}
        <section id="mensajes" className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("messagesTitle")}</h2>
            <nav className="flex gap-2 text-xs">
              {[false, true].map((all) => (
                <Link
                  key={String(all)}
                  href={msgsHref(all)}
                  aria-current={all === showAllMessages ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-2.5 py-1",
                    all === showAllMessages ? "bg-foreground text-background" : "hover:bg-muted",
                  )}
                >
                  {all ? t("messagesAll") : t("messagesUnread")}
                </Link>
              ))}
            </nav>
          </div>

          <Card className="gap-0 p-0">
            {messages.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                {showAllMessages ? t("messagesEmptyAll") : t("messagesEmptyUnread")}
              </p>
            ) : (
              <ul className="divide-y">
                {messages.map((message) => (
                  <MessageRow
                    key={`${message.channel}-${message.conversationId}`}
                    message={message}
                    locale={locale}
                    now={now}
                    labels={{
                      unknown: t("unknownContact"),
                      you: t("you"),
                      media: t(`media.${mediaKey(message.previewType)}`),
                      channel: message.channel === "whatsapp" ? "WhatsApp" : t("webchat"),
                    }}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function mediaKey(type: string | null): "image" | "audio" | "video" | "document" | "other" {
  if (type === "image" || type === "audio" || type === "video" || type === "document") return type;
  return "other";
}

function BusinessCard({
  row,
  active,
  locale,
  labels,
}: {
  row: PortfolioBusiness;
  active: boolean;
  locale: string;
  labels: {
    role: string;
    current: string;
    unread: string;
    leads: string;
    deals: string;
    overdue: string;
    unassigned: string;
    waError: string;
    grace: string;
    locked: string;
    lastMessage: string;
    lastLead: string | null;
    dealsValue: string | null;
    open: string;
    inbox: string;
    pipeline: string;
    trendUp: string;
    trendDown: string;
  };
}) {
  const n = (value: number) => formatNumber(value, locale);
  const trend =
    row.leads > row.leadsPrevious ? (
      <ArrowUpRight className="size-4 text-success" aria-label={labels.trendUp} />
    ) : row.leads < row.leadsPrevious ? (
      <ArrowDownRight className="size-4 text-muted-foreground" aria-label={labels.trendDown} />
    ) : null;

  return (
    <Card
      className={cn(
        "gap-3 p-4",
        row.unreadConversations > 0 && "border-l-4 border-l-destructive",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <BusinessDot tenantId={row.tenantId} />
            <span className="truncate font-semibold">{row.name}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{labels.role}</span>
            {active && (
              <span className="rounded-full bg-info-surface px-1.5 py-0.5 text-info">{labels.current}</span>
            )}
            {row.access === "grace" && (
              <span className="rounded-full bg-warning-surface px-1.5 py-0.5 text-warning">{labels.grace}</span>
            )}
            {row.access === "locked" && (
              <span className="rounded-full bg-destructive-surface px-1.5 py-0.5 text-destructive">
                {labels.locked}
              </span>
            )}
            {row.whatsappInError && (
              <span className="flex items-center gap-1 rounded-full bg-destructive-surface px-1.5 py-0.5 text-destructive">
                <Smartphone className="size-3" aria-hidden="true" />
                {labels.waError}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Metric
          icon={MessagesSquare}
          label={labels.unread}
          value={n(row.unreadConversations)}
          alert={row.unreadConversations > 0}
        />
        <Metric icon={Target} label={labels.leads} value={n(row.leads)} extra={trend} />
        <Metric icon={SquareKanban} label={labels.deals} value={n(row.openDeals)} />
        <Metric
          icon={CalendarClock}
          label={labels.overdue}
          value={n(row.overdueTasks)}
          alert={row.overdueTasks > 0}
        />
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span>
          {labels.lastMessage}
          {labels.lastLead && ` · ${labels.lastLead}`}
        </span>
        {(row.unassignedConversations > 0 || labels.dealsValue) && (
          <span>
            {row.unassignedConversations > 0 && (
              <span className="text-warning">{labels.unassigned}</span>
            )}
            {row.unassignedConversations > 0 && labels.dealsValue && " · "}
            {labels.dealsValue}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <OpenForm tenantId={row.tenantId} to="/inbox">
          <Button type="submit" size="sm" variant={row.unreadConversations > 0 ? "default" : "outline"}>
            <Inbox aria-hidden="true" />
            {labels.inbox}
          </Button>
        </OpenForm>
        <OpenForm tenantId={row.tenantId} to="/pipeline">
          <Button type="submit" size="sm" variant="outline">
            <SquareKanban aria-hidden="true" />
            {labels.pipeline}
          </Button>
        </OpenForm>
        <OpenForm tenantId={row.tenantId} to="/dashboard">
          <Button type="submit" size="sm" variant="ghost">
            {labels.open}
          </Button>
        </OpenForm>
      </div>
    </Card>
  );
}

function MessageRow({
  message,
  locale,
  now,
  labels,
}: {
  message: PortfolioMessage;
  locale: string;
  now: Date;
  labels: { unknown: string; you: string; media: string; channel: string };
}) {
  const ChannelIcon = message.channel === "whatsapp" ? Smartphone : MessageCircle;
  const text = message.preview?.trim() || (message.previewType && message.previewType !== "text" ? labels.media : "");
  const sameDay = message.lastMessageAt && now.getTime() - message.lastMessageAt.getTime() < 20 * 60 * 60 * 1000;
  const when = message.lastMessageAt
    ? sameDay
      ? formatTime(message.lastMessageAt, locale)
      : formatDate(message.lastMessageAt, locale, { day: "2-digit", month: "short" })
    : "";
  const unread = message.unreadCount > 0;

  return (
    <li>
      <OpenForm
        tenantId={message.tenantId}
        conversation={{ id: message.conversationId, channel: message.channel }}
      >
        <button
          type="submit"
          className="flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent/40"
        >
          <span className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <BusinessDot tenantId={message.tenantId} className="size-2" />
              <span className="truncate">{message.tenantName}</span>
              <ChannelIcon className="size-3 shrink-0 text-muted-foreground" aria-label={labels.channel} />
            </span>
            <span className={cn("shrink-0 tabular-nums", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {when}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-sm", unread && "font-semibold")}>
              {message.contactName || message.contactPhone || labels.unknown}
            </span>
            {unread && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white">
                {message.unreadCount}
              </span>
            )}
          </span>
          {text && (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {message.previewDirection === "out" && `${labels.you}: `}
              {text}
            </span>
          )}
        </button>
      </OpenForm>
    </li>
  );
}
