import Link from "next/link";
import { MessagesSquare, Smartphone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { listTenantUsers } from "@/modules/tenancy/users";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { InboxList } from "./InboxList";
import { getInboxRows, INBOX_FILTERS } from "./rows";
import type { InboxListFilter } from "@/modules/whatsapp/inbox";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.inbox");
  const params = await searchParams;
  const filter: InboxListFilter = INBOX_FILTERS.includes(params.filter as InboxListFilter)
    ? (params.filter as InboxListFilter)
    : "all";
  const q = params.q?.trim() || undefined;

  const [rows, accounts, users] = await Promise.all([
    getInboxRows(ctx, { filter, q }),
    listAccountsForTenant(ctx),
    listTenantUsers(ctx),
  ]);

  // Deactivated users included on purpose: a conversation assigned to
  // someone before they left must keep showing their name, or it reads as
  // unassigned and nobody picks it up. The picker (in the thread) offers
  // only active users; this map is for display.
  const userNames = Object.fromEntries(users.map((user) => [user.id, user.name]));

  // An empty inbox has two very different causes: no number connected yet
  // (nothing can arrive) versus connected but quiet. Only the first one has
  // something for the user to do — and only an admin can do it (§3.2).
  const needsAccount = accounts.length === 0;
  const canConnect = ctx.role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} description={t("intro")} />

      {ctx.role === "admin" && (
        <Link href="/inbox/quick-replies" className="text-sm underline underline-offset-4">
          {t("manageQuickReplies")}
        </Link>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-2 text-xs">
          {INBOX_FILTERS.map((option) => (
            <a
              key={option}
              href={`/inbox?filter=${option}`}
              className={`rounded-md border px-2 py-1 ${
                option === filter && !q ? "border-primary bg-accent" : ""
              }`}
            >
              {t(`filter.${option}` as "filter.all")}
            </a>
          ))}
        </nav>
        <form action="/inbox" className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("searchPlaceholder")}
            className="rounded-md border bg-card px-3 py-1 text-sm"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        needsAccount ? (
          <EmptyState
            icon={Smartphone}
            title={t("emptyNoAccountTitle")}
            description={t("emptyNoAccountBody")}
            actionLabel={canConnect ? t("emptyAction") : undefined}
            actionHref={canConnect ? "/whatsapp" : undefined}
          />
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title={t("emptyTitle")}
            description={t("emptyBody")}
          />
        )
      ) : (
        <InboxList initial={rows} userNames={userNames} />
      )}
    </div>
  );
}
