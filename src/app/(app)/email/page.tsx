import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { isMailboxAvailable } from "@/modules/tenancy/mailbox";
import { listMailboxes } from "@/modules/mailbox/mailboxes";
import { listThreads } from "@/modules/mailbox/threads";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// The email Inbox (PLAN-EMAIL.md E4). Its own surface next to /inbox
// (WhatsApp) and /chat, for the same reason those two are separate: each
// channel has its own rules, and a unified inbox should be a decision.
// 404 unless the platform is configured and this business has it on.

const STATUSES = ["open", "closed", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

export default async function EmailInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mailbox?: string }>;
}) {
  const ctx = await requireTenantContext();
  if (!(await isMailboxAvailable(ctx))) notFound();

  const t = await getTranslations("app.email");
  const locale = await getLocale();
  const params = await searchParams;
  const status: StatusFilter = STATUSES.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : "open";

  const [mailboxes, tenant] = await Promise.all([listMailboxes(ctx), getTenant(ctx.tenantId)]);
  const mailboxId = mailboxes.some((m) => m.id === params.mailbox) ? params.mailbox : undefined;
  const threads = await listThreads(ctx, {
    ...(status === "all" ? {} : { status }),
    mailboxId,
    limit: 100,
  });
  const mailboxById = new Map(mailboxes.map((m) => [m.id, m]));

  const href = (next: { status?: string; mailbox?: string }) => {
    const query = new URLSearchParams();
    const s = next.status ?? status;
    const m = next.mailbox ?? mailboxId;
    if (s !== "open") query.set("status", s);
    if (m) query.set("mailbox", m);
    const qs = query.toString();
    return qs ? `/email?${qs}` : "/email";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {STATUSES.map((option) => (
            <Link
              key={option}
              href={href({ status: option })}
              className={cn("rounded-md border px-2 py-1", option === status && "border-primary bg-accent")}
            >
              {t(`filter.${option}` as "filter.open")}
            </Link>
          ))}
          {mailboxes.length > 1 && (
            <>
              <span className="mx-1 text-muted-foreground">·</span>
              <Link
                href={href({ mailbox: "" })}
                className={cn("rounded-md border px-2 py-1", !mailboxId && "border-primary bg-accent")}
              >
                {t("allMailboxes")}
              </Link>
              {mailboxes.map((mailbox) => (
                <Link
                  key={mailbox.id}
                  href={href({ mailbox: mailbox.id })}
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono",
                    mailbox.id === mailboxId && "border-primary bg-accent",
                  )}
                >
                  {mailbox.address}
                </Link>
              ))}
            </>
          )}
        </div>
      </PageHeader>

      {threads.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={t("emptyTitle")}
          description={
            mailboxes.length
              ? t("emptyBody", { address: mailboxes.find((m) => m.isActive)?.address ?? mailboxes[0].address })
              : t("noMailbox")
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/email/${thread.id}`}
                className="flex flex-col gap-0.5 px-4 py-3 hover:bg-accent sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="flex min-w-0 items-center gap-2 sm:w-56">
                  {thread.unread && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" aria-label={t("unread")} />
                  )}
                  <span className={cn("truncate", thread.unread && "font-semibold")}>
                    {thread.participantName || thread.participantEmail}
                  </span>
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-sm", thread.unread && "font-medium")}>
                  {thread.subject || t("noSubject")}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {mailboxes.length > 1 && (
                    <span className="font-mono">{mailboxById.get(thread.mailboxId)?.address}</span>
                  )}
                  {thread.contactId && (
                    <span className="rounded-full bg-muted px-2 py-0.5">{t("linkedContact")}</span>
                  )}
                  {thread.status === "closed" && (
                    <span className="rounded-full bg-muted px-2 py-0.5">{t("closed")}</span>
                  )}
                  <time dateTime={thread.lastMessageAt.toISOString()}>
                    {formatDateTime(thread.lastMessageAt, locale, tenant?.timezone)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
