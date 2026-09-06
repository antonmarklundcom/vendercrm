import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listTenantUsers } from "@/modules/tenancy/users";
import { getContact, listTags, listTagsForContact } from "@/modules/crm/contacts";
import { listCustomFieldDefinitions } from "@/modules/crm/custom-fields";
import { getContactTimeline, type TimelineEntry } from "@/modules/crm/timeline";
import { listDealsForContact } from "@/modules/crm/deals";
import { listTasksForContact } from "@/modules/crm/tasks";
import { listEventsForContact } from "@/modules/calendar/events";
import { findContactDeleteBlockers, type ContactBlocker } from "@/modules/crm/deletion";
import {
  listConversationsForContact,
  listMessagesForConversation,
  isWithinFreeFormWindow,
} from "@/modules/whatsapp/inbox";
import { listApprovedTemplates } from "@/modules/whatsapp/templates";
import { Button } from "@/components/ui/button";
import { WhatsAppLink } from "@/components/whatsapp-link";
import { getTenant } from "@/modules/tenancy/tenants";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { cn } from "@/lib/utils";
import { TaskList, type TaskListLabels } from "@/components/task-list";
import { EmptyState } from "@/components/empty-state";
import { ListTodo } from "lucide-react";
import { ConversationThread, type ThreadLabels } from "./ConversationThread";
import { ContactEditForm } from "./ContactEditForm";
import {
  addNoteAction,
  deleteContactAction,
  addTagToContactAction,
  removeTagFromContactAction,
  sendContactMessageAction,
  sendContactTemplateAction,
  updateContactAction,
  updateContactCustomFieldsAction,
} from "../actions";
import {
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "../tasks-actions";
import { Input, Select, Textarea } from "@/components/ui/form-fields";

// Contact record with the whole relationship in one place (PLAN.md §10 1J
// #2): the WhatsApp conversation, the unified timeline, and the contact's
// own data. Tabs are URL state rather than client state so each one is a
// plain server render — no client bundle for what is fundamentally reading.

const TABS = ["conversacion", "tareas", "actividad", "datos"] as const;
type Tab = (typeof TABS)[number];



/** Same countdown the inbox shows — accurate as of page load (§6.5). */
function formatRemaining(lastInboundAt: Date | null): string {
  if (!lastInboundAt) return "";
  const msLeft = lastInboundAt.getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (msLeft <= 0) return "";
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; deleteError?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab, deleteError } = await searchParams;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.contacts");
  const locale = await getLocale();
  const tq = await getTranslations("app.quotes");
  const td = await getTranslations("app.documents");
  const ti = await getTranslations("app.inbox");
  const tcal = await getTranslations("app.calendar");

  const contact = await getContact(ctx, id);
  if (!contact) notFound();

  // The tenant's dialing convention, so a wa.me link built from a bare local
  // number reaches the right country (plan-booking.md §6.2).
  const tenantRow = await getTenant(ctx.tenantId);
  const defaultCountry =
    ((tenantRow?.settings ?? {}) as TenantSettings).defaultCountry ?? DEFAULT_COUNTRY;

  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "conversacion";

  const [
    timeline,
    deals,
    contactTags,
    allTags,
    conversations,
    tasks,
    appointments,
    users,
    deleteBlockers,
    customFields,
  ] =
    await Promise.all([
      getContactTimeline(ctx, id),
      listDealsForContact(ctx, id),
      listTagsForContact(ctx, id),
      listTags(ctx),
      listConversationsForContact(ctx, id),
      listTasksForContact(ctx, id),
      // What is booked with this person — the agenda read from the record
      // rather than from the calendar page (modules/calendar).
      listEventsForContact(ctx, id),
      // For the conversation tab's owner picker — same decision as the
      // inbox's, offered in the place a rep is actually looking.
      listTenantUsers(ctx),
      // Only an admin can delete, so only an admin pays for the scan.
      ctx.role === "admin"
        ? findContactDeleteBlockers(ctx, id)
        : Promise.resolve<ContactBlocker[]>([]),
      listCustomFieldDefinitions(ctx),
    ]);

  const assignableUsers = users
    .filter((user) => !user.banned)
    .map((user) => ({ id: user.id, name: user.name }));

  // One contact can in principle have a conversation per connected number;
  // the most recent is the one worth showing inline.
  const conversation = conversations[0] ?? null;
  const [messages, templates] = conversation
    ? await Promise.all([
        listMessagesForConversation(ctx, conversation.id),
        listApprovedTemplates(ctx, conversation.waAccountId),
      ])
    : [[], []];

  const availableTags = allTags.filter(
    (tag) => !contactTags.some((ct) => ct.id === tag.id),
  );

  const updateAction = updateContactAction.bind(null, id);
  const addNote = addNoteAction.bind(null, id);
  const addTag = addTagToContactAction.bind(null, id);

  const threadLabels: ThreadLabels = {
    empty: t("conversationEmpty"),
    emptyBody: t("conversationEmptyBody"),
    noMessages: ti("noMessages"),
    placeholder: ti("messagePlaceholder"),
    send: ti("send"),
    windowOpen: ti("windowOpenShort"),
    windowClosed: ti("windowClosed"),
    sendTemplate: ti("sendTemplate"),
    noTemplates: ti("noTemplates"),
    media: t("timelineMedia"),
  };

  const taskLabels: TaskListLabels = {
    complete: t("tasks.complete"),
    reopen: t("tasks.reopen"),
    delete: t("tasks.delete"),
    overdue: t("tasks.overdue"),
  };

  const redirectPath = `/contacts/${id}`;
  const openTasks = tasks.filter((task) => !task.completedAt);
  const doneTasks = tasks.filter((task) => task.completedAt);

  function describe(entry: TimelineEntry): { title: string; detail?: string } {
    switch (entry.kind) {
      case "activity":
        return {
          title: t(`activityTypes.${entry.activityType}` as "activityTypes.note"),
          detail: entry.text,
        };
      case "message":
        return {
          title:
            entry.direction === "in"
              ? t("timelineMessageIn")
              : t("timelineMessageOut"),
          detail: entry.body ?? (entry.hasMedia ? t("timelineMedia") : undefined),
        };
      case "quote":
        return {
          title: t("timelineQuote", { number: entry.number }),
          detail: `${tq(`statusValues.${entry.status}` as "statusValues.draft")} · ${formatMoney(entry.total, entry.currency, locale)}`,
        };
      case "document":
        return {
          title: t("timelineDocument", { number: entry.number }),
          detail: `${td(`statusValues.${entry.status}` as "statusValues.draft")} · ${formatMoney(entry.total, entry.currency, locale)}`,
        };
      case "lead":
        return {
          title: t("timelineLead"),
          detail: entry.campaign ?? entry.pageUrl ?? undefined,
        };
      case "conversationNote":
        return {
          title: t("timelineConversationNote"),
          detail: entry.body,
        };
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{contact.name}</h1>
        <p className="text-sm text-muted-foreground">
          <WhatsAppLink phone={contact.phone} country={defaultCountry} />
          {contact.email ? ` · ${contact.email}` : ""}
          {contact.source ? ` · ${contact.source}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {contactTags.map((tag) => (
            <form key={tag.id} action={removeTagFromContactAction.bind(null, id, tag.id)}>
              <button
                type="submit"
                className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
              >
                {tag.name} ×
              </button>
            </form>
          ))}
        </div>
      </header>

      <nav className="flex gap-1 border-b">
        {TABS.map((candidate) => (
          <Link
            key={candidate}
            href={`/contacts/${id}?tab=${candidate}`}
            aria-current={candidate === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              candidate === tab
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${candidate}` as "tabs.conversacion")}
          </Link>
        ))}
      </nav>

      {tab === "conversacion" && (
        <ConversationThread
          conversationId={conversation?.id ?? null}
          assignedUserId={conversation?.assignedUserId ?? null}
          assignableUsers={assignableUsers}
          messages={messages.map((message) => ({
            id: message.id,
            direction: message.direction,
            body: message.body,
            status: message.status,
            hasMedia: Boolean(message.storageKey || message.mediaId),
            at: message.createdAt,
          }))}
          windowOpen={isWithinFreeFormWindow(conversation?.lastInboundAt ?? null)}
          remaining={formatRemaining(conversation?.lastInboundAt ?? null)}
          templates={templates.map((template) => ({
            name: template.name,
            language: template.language,
          }))}
          labels={threadLabels}
          sendMessage={sendContactMessageAction.bind(null, id)}
          sendTemplate={sendContactTemplateAction.bind(null, id)}
        />
      )}

      {tab === "tareas" && (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{tcal("title")}</h3>
              <Link href="/calendar#nueva-cita" className="text-sm underline underline-offset-4">
                {tcal("createTitle")}
              </Link>
            </div>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tcal("emptyRange")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {appointments.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={`/calendar/${event.id}`}
                      className="underline underline-offset-4"
                    >
                      {event.title}
                    </Link>
                    <span className="ml-2 text-muted-foreground">
                      {event.allDay
                        ? tcal("allDay")
                        : formatDateTime(event.startsAt, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form
            action={createTaskAction.bind(null, id)}
            className="flex max-w-lg flex-wrap items-end gap-2"
          >
            <label className="flex flex-1 flex-col gap-1 text-sm">
              {t("tasks.title")}
              <Input
                name="title"
                required
                placeholder={t("tasks.titlePlaceholder")}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("tasks.dueAt")}
              <Input
                name="dueAt"
                type="datetime-local"
                required
              />
            </label>
            {deals.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                {t("dealsTitle")}
                <Select name="dealId">
                  <option value="">{t("tasks.noDeal")}</option>
                  {deals.map((deal) => (
                    <option key={deal.id} value={deal.id}>
                      {deal.title}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <Button type="submit" size="sm">
              {t("tasks.create")}
            </Button>
          </form>

          {openTasks.length === 0 && doneTasks.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={t("tasks.emptyTitle")}
              description={t("tasks.emptyBody")}
            />
          ) : (
            <>
              <TaskList
                tasks={openTasks.map((task) => ({
                  id: task.id,
                  title: task.title,
                  dueAt: task.dueAt,
                  completed: false,
                }))}
                labels={taskLabels}
                onComplete={completeTaskAction.bind(null, redirectPath)}
                onReopen={reopenTaskAction.bind(null, redirectPath)}
                onDelete={deleteTaskAction.bind(null, redirectPath)}
              />
              {doneTasks.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("tasks.showCompleted", { count: doneTasks.length })}
                  </summary>
                  <div className="mt-2">
                    <TaskList
                      tasks={doneTasks.map((task) => ({
                        id: task.id,
                        title: task.title,
                        dueAt: task.dueAt,
                        completed: true,
                      }))}
                      labels={taskLabels}
                      onComplete={completeTaskAction.bind(null, redirectPath)}
                      onReopen={reopenTaskAction.bind(null, redirectPath)}
                      onDelete={deleteTaskAction.bind(null, redirectPath)}
                    />
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {tab === "actividad" && (
        <div className="flex flex-col gap-4">
          <form action={addNote} className="flex max-w-sm flex-col gap-2">
            <Textarea
              name="note"
              required
              placeholder={t("notePlaceholder")}
            />
            <Button type="submit" size="sm" className="w-fit">
              {t("addNote")}
            </Button>
          </form>

          <ul className="flex flex-col gap-2 text-sm">
            {timeline.map((entry) => {
              const { title, detail } = describe(entry);
              return (
                <li key={`${entry.kind}-${entry.id}`} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(entry.at, locale)}
                    </span>
                  </div>
                  {detail && <p className="text-muted-foreground">{detail}</p>}
                </li>
              );
            })}
            {timeline.length === 0 && (
              <li className="text-muted-foreground">{t("timelineEmpty")}</li>
            )}
          </ul>
        </div>
      )}

      {tab === "datos" && (
        <div className="flex flex-col gap-8">
          {deals.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">{t("dealsTitle")}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {deals.map((deal) => (
                  <li key={deal.id} className="rounded-md border px-3 py-2">
                    {deal.title} — {formatMoney(deal.value, deal.currency, locale)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {availableTags.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">{t("addTag")}</h2>
              <form action={addTag} className="flex max-w-xs gap-2">
                <Select name="tagId" className="flex-1">
                  {availableTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" variant="outline">
                  {t("addTag")}
                </Button>
              </form>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("editTitle")}</h2>
            <ContactEditForm
              action={updateAction}
              defaults={{
                name: contact.name,
                email: contact.email ?? "",
                notes: contact.notes ?? "",
              }}
            />
          </section>

          {customFields.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">{t("customFieldsTitle")}</h2>
              <form
                action={updateContactCustomFieldsAction.bind(null, id)}
                className="flex max-w-sm flex-col gap-3"
              >
                {customFields.map((field) => {
                  const value = ((contact.custom as Record<string, unknown>) ?? {})[field.key];
                  const name = `custom_${field.key}`;
                  return (
                    <label key={field.id} className="flex flex-col gap-1 text-sm">
                      {field.label}
                      {field.type === "select" ? (
                        <Select name={name} defaultValue={value ? String(value) : ""}>
                          <option value="" />
                          {((field.options as string[] | null) ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          name={name}
                          type={
                            field.type === "number" ? "number" : field.type === "date" ? "date" : "text"
                          }
                          defaultValue={value ? String(value) : ""}
                        />
                      )}
                    </label>
                  );
                })}
                <Button type="submit" size="sm" variant="outline" className="w-fit">
                  {t("customFieldsSave")}
                </Button>
              </form>
            </section>
          )}

          {/* Deletion is for a record created by mistake, so it is offered
              only while the contact has no history and only to an admin
              (§13 H1). The action re-checks both — this just doesn't dangle
              an option that would be refused. */}
          {ctx.role === "admin" && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">{t("deleteTitle")}</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                {deleteBlockers.length > 0
                  ? t("deleteBlocked", {
                      reasons: deleteBlockers
                        .map((blocker) => t(`deleteBlockers.${blocker}`))
                        .join(", "),
                    })
                  : t("deleteHint")}
              </p>
              {deleteError && (
                <p className="mb-3 text-sm text-destructive">{t("deleteFailed")}</p>
              )}
              <form action={deleteContactAction}>
                <input type="hidden" name="contactId" value={contact.id} />
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
        </div>
      )}
    </div>
  );
}
