import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getDeal } from "@/modules/crm/deals";
import { getPipeline, listStagesForPipeline } from "@/modules/crm/pipelines";
import { getContact } from "@/modules/crm/contacts";
import { WhatsAppLink } from "@/components/whatsapp-link";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { listActivitiesForContact } from "@/modules/crm/activities";
import { listTasksForContact } from "@/modules/crm/tasks";
import { listQuotesForContact } from "@/modules/quotes/quotes";
import { listDocumentsForContact } from "@/modules/documents/documents";
import { listTenantUsers } from "@/modules/tenancy/users";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { CloseDealForms, type CloseLabels } from "./CloseDealForms";
import { assignDealAction, reopenDealAction, updateExpectedCloseAtAction } from "./actions";
import { deleteDealAction } from "../actions";
import { findDealDeleteBlockers, type DealBlocker } from "@/modules/crm/deletion";
import { Select, Input } from "@/components/ui/form-fields";

// Deal detail (PLAN.md §13 H8). Everything about one opportunity in one
// place: what it's worth, who owns it, how it got to this stage, and what is
// attached to it — plus the two buttons the board can't offer, won and lost.
export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ deleteError?: string }>;
}) {
  const { dealId } = await params;
  const { deleteError } = await searchParams;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.deal");
  const tp = await getTranslations("app.pipeline");
  const locale = await getLocale();

  const deal = await getDeal(ctx, dealId);
  if (!deal) notFound();

  const tenantRow = await getTenant(ctx.tenantId);
  const defaultCountry =
    ((tenantRow?.settings ?? {}) as TenantSettings).defaultCountry ?? DEFAULT_COUNTRY;

  const [
    pipeline,
    stages,
    contact,
    users,
    tasks,
    quotes,
    documents,
    activities,
    deleteBlockers,
  ] =
    await Promise.all([
      getPipeline(ctx, deal.pipelineId),
      listStagesForPipeline(ctx, deal.pipelineId),
      getContact(ctx, deal.contactId),
      listTenantUsers(ctx),
      listTasksForContact(ctx, deal.contactId),
      listQuotesForContact(ctx, deal.contactId),
      listDocumentsForContact(ctx, deal.contactId),
      listActivitiesForContact(ctx, deal.contactId),
      // Only an admin can delete, so only an admin pays for the scan.
      ctx.role === "admin"
        ? findDealDeleteBlockers(ctx, dealId)
        : Promise.resolve<DealBlocker[]>([]),
    ]);

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const stage = stageById.get(deal.stageId);
  const closed = !!stage?.isWon || !!stage?.isLost;
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);

  // Stage history comes off the activity trail, which has recorded every
  // move since §5 — the deal row itself only knows the stage it is in now.
  const stageHistory = activities
    .filter((activity) => activity.dealId === deal.id && activity.type === "stage_change")
    .map((activity) => {
      const payload = (activity.payload ?? {}) as { fromStageId?: string; toStageId?: string };
      return {
        id: activity.id,
        at: activity.createdAt,
        from: payload.fromStageId ? (stageById.get(payload.fromStageId)?.name ?? null) : null,
        to: payload.toStageId ? (stageById.get(payload.toStageId)?.name ?? null) : null,
      };
    });

  const dealTasks = tasks.filter((task) => task.dealId === deal.id);

  const closeLabels: CloseLabels = {
    won: t("markWon"),
    lost: t("markLost"),
    reason: t("reason"),
    reasonPlaceholder: t("reasonPlaceholder"),
    errors: {
      noStage: t("errors.noStage"),
      notFound: t("errors.notFound"),
      invalid: t("errors.invalid"),
      unknown: t("errors.unknown"),
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={deal.title}
        description={`${pipeline?.name ?? ""} · ${stage?.name ?? ""}`}
        action={
          <Link
            href={`/pipeline?pipeline=${deal.pipelineId}`}
            className="text-sm underline underline-offset-4"
          >
            {t("backToBoard")}
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("value")} value={formatMoney(deal.value, deal.currency, locale)} />
        <Fact label={t("stage")} value={stage?.name ?? "—"} />
        <Fact
          label={t("contact")}
          value={contact?.name ?? "—"}
          href={contact ? `/contacts/${contact.id}` : undefined}
        />
        <Fact
          label={t("stageSince")}
          value={formatDateTime(deal.stageEnteredAt, locale)}
        />
        {!closed && (
          <Fact
            label={t("expectedCloseAt")}
            value={
              <form action={updateExpectedCloseAtAction} className="flex gap-1">
                <input type="hidden" name="dealId" value={deal.id} />
                <Input
                  type="date"
                  name="expectedCloseAt"
                  defaultValue={
                    deal.expectedCloseAt ? deal.expectedCloseAt.toISOString().slice(0, 10) : ""
                  }
                  className="h-7 px-2 text-sm"
                />
                <Button type="submit" size="sm" variant="ghost">
                  {t("save")}
                </Button>
              </form>
            }
          />
        )}
        {contact?.phone ? (
          // The rep's next move on a deal in Paraguay is a WhatsApp message,
          // so the number is a link rather than something to copy out
          // (plan-booking.md §6.2). Prefilled with the deal's own title: the
          // customer should not have to ask which quote this is about.
          <Fact
            label={t("whatsapp")}
            value={
              <WhatsAppLink
                phone={contact.phone}
                country={defaultCountry}
                text={t("whatsappGreeting", { deal: deal.title })}
              />
            }
          />
        ) : null}
      </section>

      {closed ? (
        <section className="flex flex-col gap-3">
          <p className="rounded-md border bg-muted px-3 py-2 text-sm">
            {stage?.isWon ? t("closedWon") : t("closedLost")}
            {stage?.isLost
              ? deal.lostReason
                ? ` · ${deal.lostReason}`
                : ""
              : deal.closeReason
                ? ` · ${deal.closeReason}`
                : ""}
            {deal.closedAt ? ` · ${formatDateTime(deal.closedAt, locale)}` : ""}
          </p>

          {openStages.length > 0 && (
            <form action={reopenDealAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="dealId" value={deal.id} />
              <Select
                name="toStageId"
                defaultValue={openStages[0].id}
                aria-label={t("stage")}
              >
                {openStages.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="outline">
                {t("reopen")}
              </Button>
            </form>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("closeTitle")}</h2>
          <CloseDealForms dealId={deal.id} labels={closeLabels} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("assignedTitle")}</h2>
        <form action={assignDealAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="dealId" value={deal.id} />
          <Select
            name="userId"
            defaultValue={deal.assignedUserId ?? ""}
            aria-label={t("assignedTitle")}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="outline">
            {t("assign")}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("historyTitle")}</h2>
        {stageHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {stageHistory.map((entry) => (
              <li key={entry.id} className="rounded-md border px-3 py-2">
                {entry.from ?? "—"} → {entry.to ?? "—"}
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatDateTime(entry.at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("quotesTitle")}</h2>
          {quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("quotesEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {quotes.map((quote) => (
                <li key={quote.id} className="rounded-md border px-3 py-2">
                  <Link href={`/quotes/${quote.id}`} className="underline underline-offset-4">
                    {quote.number}
                  </Link>
                  <span className="ml-2 text-muted-foreground">
                    {formatMoney(quote.total, quote.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {/* Notas de venta, alongside the quotes they usually come from —
              1Q shipped after this page and was never listed here. */}
          <h2 className="text-lg font-semibold">{t("documentsTitle")}</h2>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("documentsEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {documents.map((document) => (
                <li key={document.id} className="rounded-md border px-3 py-2">
                  <Link
                    href={`/documents/${document.id}`}
                    className="underline underline-offset-4"
                  >
                    {document.number}
                  </Link>
                  <span className="ml-2 text-muted-foreground">
                    {formatMoney(document.total, document.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("tasksTitle")}</h2>
          {dealTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("tasksEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {dealTasks.map((task) => (
                <li key={task.id} className="rounded-md border px-3 py-2">
                  {task.title}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatDateTime(task.dueAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Deletion is for a deal opened by mistake, so it is offered only
          while nothing real hangs off it and only to an admin (§13 H1). The
          action re-checks both — this just doesn't dangle an option that
          would be refused. */}
      {ctx.role === "admin" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("deleteTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {deleteBlockers.length > 0
              ? t("deleteBlocked", {
                  reasons: deleteBlockers
                    .map((blocker) => t(`deleteBlockers.${blocker}`))
                    .join(", "),
                })
              : t("deleteHint")}
          </p>
          {deleteError && <p className="text-sm text-destructive">{t("deleteFailed")}</p>}
          <form action={deleteDealAction}>
            <input type="hidden" name="dealId" value={deal.id} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={deleteBlockers.length > 0}
            >
              {t("delete")}
            </Button>
          </form>
        </section>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href={`/pipeline?pipeline=${deal.pipelineId}`} className="underline underline-offset-4">
          {tp("title")}
        </Link>
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  href,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">
        {href ? (
          <Link href={href} className="underline underline-offset-4">
            {value}
          </Link>
        ) : (
          value
        )}
      </p>
    </div>
  );
}
