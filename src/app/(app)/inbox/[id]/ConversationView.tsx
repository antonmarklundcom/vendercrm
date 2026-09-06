"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import useSWR, { type KeyedMutator } from "swr";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEchoGeneration } from "@/lib/use-echo-generation";
import {
  sendTextAction,
  sendTemplateAction,
  offerSlotsAction,
  approveAiDraftAction,
  discardAiDraftAction,
  setConversationAiAction,
  addNoteAction,
  markUnreadAction,
  type ApproveDraftState,
  type SendTemplateState,
  type SendTextState,
  type OfferSlotsState,
  type AddNoteState,
} from "../actions";
import { formatDateTime } from "@/lib/i18n/format";
import { Input, Select } from "@/components/ui/form-fields";
import { AssigneePicker, type AssignableUser } from "../AssigneePicker";

// Client-side mirror of modules/whatsapp/quick-replies.ts's `renderQuickReply`
// — that module also exports DB-backed functions and can't be imported from
// a client component. The picker only needs to preview the substitution
// before send; the server re-renders it from the same rule when the text is
// actually typed into the box (this just fills the input, it does not send).
function renderQuickReplyPreview(body: string, contactName: string): string {
  return body.replace(/\{\{\s*contacto\.nombre\s*\}\}/gi, contactName);
}

export type ConversationData = {
  contact: { name: string; phone: string; whatsappHref: string | null } | null;
  conversation: {
    id: string;
    contactId: string;
    lastInboundAt: string | null;
    aiDisabledAt: string | null;
    assignedUserId: string | null;
  };
  messages: Array<{
    id: string;
    direction: "in" | "out";
    body: string | null;
    status: string;
    createdAt: string;
  }>;
  notes: Array<{ id: string; body: string; authorUserId: string; createdAt: string }>;
  templates: Array<{ id: string; name: string; language: string }>;
  aiDrafts: Array<{
    id: string;
    body: string | null;
    provider: string | null;
    model: string | null;
    promptTokens: number;
    completionTokens: number;
  }>;
  windowOpen: boolean;
};

type QuickReply = { id: string; name: string; body: string };

/** Merges messages and internal notes into one chronological thread — a note
 *  is rendered inline where it happened, in a distinct style, never as a
 *  `messages` row (§15.8 P3). */
type ThreadItem =
  | { kind: "message"; at: string; message: ConversationData["messages"][number] }
  | { kind: "note"; at: string; note: ConversationData["notes"][number] };

function buildThread(data: ConversationData): ThreadItem[] {
  const items: ThreadItem[] = [
    ...data.messages.map((message): ThreadItem => ({ kind: "message", at: message.createdAt, message })),
    ...data.notes.map((note): ThreadItem => ({ kind: "note", at: note.createdAt, note })),
  ];
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Declared here, not in actions.ts: a "use server" module may only export
// async functions.
const sendTextInitialState: SendTextState = {
  error: null,
  sent: false,
  values: { body: "" },
  needsOptoutConfirm: false,
};
const sendTemplateInitialState: SendTemplateState = { error: null, values: { template: "" } };
const approveInitialState: ApproveDraftState = { error: null };
const offerSlotsInitialState: OfferSlotsState = { error: null, offered: 0 };
const addNoteInitialState: AddNoteState = { error: null };

function formatRemaining(lastInboundAt: string | null): string {
  if (!lastInboundAt) return "";
  const msLeft = new Date(lastInboundAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (msLeft <= 0) return "";
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

// Conversation thread, 5s polling (PLAN.md §6.5). Three things must survive
// a poll landing mid-interaction, and inline validation (§10 1R #6) adds the
// third:
//
//   * a half-typed reply — the box is uncontrolled and remounted only when a
//     new action result arrives, so a refresh re-rendering this tree never
//     touches what is in it;
//   * scroll position — auto-scroll only fires when the rep was already at
//     the bottom before new messages arrived;
//   * a rejected send's error — it lives in useActionState state, which SWR
//     replaces nothing of. The refresh swaps `data`; the form state stays
//     until the next submit answers.
export function ConversationView({
  conversationId,
  initial,
  users,
  userNames,
  bookingTypes,
  quickReplies,
}: {
  conversationId: string;
  initial: ConversationData;
  /** Active members of the tenant, passed once from the page: the one part
   *  of this screen the 5s poll has no reason to re-fetch. */
  users: AssignableUser[];
  /** Every user the tenant has ever had, deactivated included — a note
   *  written before someone left must still show their name. */
  userNames: Record<string, string>;
  /** Bookable types, for "Ofrecer horarios". Static per tenant, same reason. */
  bookingTypes: Array<{ id: string; name: string }>;
  /** Quick replies for the `/` picker. Static per tenant, same reason. */
  quickReplies: QuickReply[];
}) {
  const t = useTranslations("app.inbox");
  const locale = useLocale();

  const { data, mutate } = useSWR<ConversationData>(
    `/api/inbox/${conversationId}`,
    fetcher,
    { fallbackData: initial, refreshInterval: 5000 },
  );
  const d = data ?? initial;

  const [offerState, offerFormAction] = useActionState(
    offerSlotsAction,
    offerSlotsInitialState,
  );

  const listRef = useRef<HTMLUListElement>(null);
  const prevCountRef = useRef(d.messages.length + d.notes.length);
  const [pending, startTransition] = useTransition();

  const [sendState, sendFormAction, sendPending] = useActionState(
    sendTextAction,
    sendTextInitialState,
  );
  const [templateState, templateFormAction, templatePending] = useActionState(
    sendTemplateAction,
    sendTemplateInitialState,
  );
  const sendGeneration = useEchoGeneration(sendState);
  const templateGeneration = useEchoGeneration(templateState);

  const [noteState, noteFormAction, notePending] = useActionState(addNoteAction, addNoteInitialState);
  const [showNoteForm, setShowNoteForm] = useState(false);
  useEffect(() => {
    if (noteState !== addNoteInitialState) {
      setShowNoteForm(false);
      void mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteState]);

  const thread = useMemo(() => buildThread(d), [d]);

  // Quick reply picker: typing "/" at the start of the box opens a filtered
  // list; picking one replaces the box with the rendered template. The send
  // itself is unchanged — this only fills the input (§15.8 P3).
  const replyInputRef = useRef<HTMLInputElement>(null);
  const [quickReplyQuery, setQuickReplyQuery] = useState<string | null>(null);
  const matchingQuickReplies = useMemo(() => {
    if (quickReplyQuery === null) return [];
    const term = quickReplyQuery.toLowerCase();
    return quickReplies.filter((reply) => reply.name.toLowerCase().includes(term));
  }, [quickReplyQuery, quickReplies]);

  function handleComposerChange(value: string) {
    setQuickReplyQuery(value.startsWith("/") ? value.slice(1) : null);
  }

  function pickQuickReply(reply: QuickReply) {
    if (replyInputRef.current) {
      replyInputRef.current.value = renderQuickReplyPreview(
        reply.body,
        d.contact?.name ?? "",
      );
      replyInputRef.current.focus();
    }
    setQuickReplyQuery(null);
  }

  // Keyboard: "r" focuses the reply box (§15.8 P3) — ignored while already
  // typing anywhere, so it never steals a literal "r" from a form field.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (event.key === "r") {
        event.preventDefault();
        replyInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const count = d.messages.length + d.notes.length;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (count !== prevCountRef.current && (nearBottom || prevCountRef.current === 0)) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = count;
  }, [d.messages.length, d.notes.length]);

  // A send that landed should show up now rather than up to 5s from now.
  // Re-reading on a *rejected* send is harmless and keeps one code path.
  useEffect(() => {
    if (sendState !== sendTextInitialState) void mutate();
  }, [sendState, mutate]);
  useEffect(() => {
    if (templateState !== sendTemplateInitialState) void mutate();
  }, [templateState, mutate]);

  // Toggling AI and discarding a draft have no form state to render a
  // refusal into, so a throw here used to leave the button looking like it
  // had worked. The toast is the only place these can report.
  function runAction(run: () => Promise<void>) {
    startTransition(async () => {
      try {
        await run();
      } catch {
        toast.error(t("actionFailed"));
      }
      await mutate();
    });
  }

  function handleDiscardDraft(replyId: string) {
    const fd = new FormData();
    fd.set("replyId", replyId);
    fd.set("conversationId", conversationId);
    runAction(() => discardAiDraftAction(fd));
  }

  function handleToggleAi() {
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("enabled", d.conversation.aiDisabledAt ? "true" : "false");
    runAction(() => setConversationAiAction(fd));
  }

  function handleMarkUnread() {
    runAction(() => markUnreadAction(conversationId));
  }

  const aiDisabled = !!d.conversation.aiDisabledAt;
  const busy = pending || sendPending || templatePending;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{d.contact?.name ?? d.conversation.id}</h1>
      <p className="text-sm text-muted-foreground">
        {d.contact?.whatsappHref ? (
          // The rep is already in this conversation; the link is for the
          // times WhatsApp itself is the better place to answer from — a
          // voice note, a photo, their phone (plan-booking.md §6.2).
          <a
            href={d.contact.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            title="WhatsApp"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {d.contact.phone}
          </a>
        ) : (
          d.contact?.phone
        )}
      </p>

      <AssigneePicker
        conversationId={conversationId}
        assignedUserId={d.conversation.assignedUserId}
        users={users}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={aiDisabled ? "text-muted-foreground" : "text-success"}>
          {aiDisabled ? t("aiOff") : t("aiOn")}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={handleToggleAi}>
          {aiDisabled ? t("aiEnable") : t("aiDisable")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={handleMarkUnread}>
          {t("markUnread")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setShowNoteForm((open) => !open)}
        >
          {t("addNote")}
        </Button>
      </div>

      {showNoteForm && (
        <form action={noteFormAction} className="flex flex-col gap-1 rounded-md border border-dashed p-3">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="contactId" value={d.conversation.contactId} />
          <Input name="body" placeholder={t("notePlaceholder")} className="flex-1" />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={notePending}>
              {t("saveNote")}
            </Button>
            {noteState.error && (
              <span role="alert" className="text-xs text-destructive">
                {t("noteRequired")}
              </span>
            )}
          </div>
        </form>
      )}

      {d.aiDrafts.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-info/30 bg-info-surface p-3">
          <h2 className="text-sm font-medium text-info">{t("aiDraftsTitle")}</h2>
          {d.aiDrafts.map((draft) => (
            <AiDraftCard
              key={draft.id}
              draft={draft}
              conversationId={conversationId}
              windowOpen={d.windowOpen}
              busy={busy}
              mutate={mutate}
              onDiscard={() => handleDiscardDraft(draft.id)}
            />
          ))}
        </section>
      )}

      <ul ref={listRef} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {thread.map((item) =>
          item.kind === "message" ? (
            <li
              key={`m-${item.message.id}`}
              className={`max-w-md rounded-md border px-3 py-2 text-sm ${
                item.message.direction === "out" ? "ml-auto bg-accent" : ""
              }`}
            >
              <p>{item.message.body}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(item.message.createdAt, locale)} · {item.message.status}
              </p>
            </li>
          ) : (
            // Internal note: distinct style, never a `messages` row — the
            // point of §15.8 P3's notes feature.
            <li
              key={`n-${item.note.id}`}
              className="max-w-md rounded-md border border-dashed border-warning/50 bg-warning-surface px-3 py-2 text-sm"
            >
              <p className="text-xs font-medium text-warning">
                {t("noteAuthor", { name: userNames[item.note.authorUserId] ?? item.note.authorUserId })}
              </p>
              <p>{item.note.body}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(item.note.createdAt, locale)}
              </p>
            </li>
          ),
        )}
        {thread.length === 0 && <li className="text-muted-foreground">{t("noMessages")}</li>}
      </ul>

      {d.windowOpen ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("windowOpen", { remaining: formatRemaining(d.conversation.lastInboundAt) })}
          </p>
          <form action={sendFormAction} className="relative flex flex-col gap-1">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="confirmed" value="false" />
            <div className="flex gap-2">
              {/* No `required`: the bubble would render in the browser's
                  language on a Spanish-only app (§1.2). The server answers.
                  Keyed so a rejected send hands the typed text back — and so
                  a poll tick, which changes no action state, leaves a
                  half-typed reply exactly where it is. */}
              <Input
                key={sendGeneration}
                ref={replyInputRef}
                name="body"
                defaultValue={sendState.values.body}
                placeholder={t("messagePlaceholder")}
                className="flex-1"
                onChange={(event) => handleComposerChange(event.target.value)}
              />
              <Button type="submit" disabled={busy}>
                {t("send")}
              </Button>
            </div>
            {quickReplyQuery !== null && matchingQuickReplies.length > 0 && (
              <ul className="absolute bottom-full z-10 mb-1 flex max-h-40 w-full flex-col overflow-y-auto rounded-md border bg-popover shadow-sm">
                {matchingQuickReplies.map((reply) => (
                  <li key={reply.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => pickQuickReply(reply)}
                    >
                      <span className="font-medium">/{reply.name}</span>{" "}
                      <span className="text-muted-foreground">{reply.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sendState.error && (
              <span role="alert" className="text-xs text-destructive">
                {t(`errors.${sendState.error}` as "errors.sendFailed")}
              </span>
            )}
          </form>

          {sendState.needsOptoutConfirm && (
            <div
              role="alertdialog"
              className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning-surface p-3 text-sm text-warning"
            >
              <p>{t("optoutConfirm")}</p>
              <div className="flex gap-2">
                <form action={sendFormAction}>
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="body" value={sendState.values.body} />
                  <input type="hidden" name="confirmed" value="true" />
                  <Button type="submit" size="sm" disabled={busy}>
                    {t("optoutConfirmSend")}
                  </Button>
                </form>
              </div>
            </div>
          )}

          {/* Booking inside the conversation (plan-booking.md §5.3). Only
              while the window is open: these are free-form messages, and
              this answers someone who just wrote rather than opening a
              thread. */}
          {bookingTypes.length > 0 ? (
            <form action={offerFormAction} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <input type="hidden" name="conversationId" value={conversationId} />
                <Select name="bookingTypeId" className="flex-1">
                  {bookingTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="outline" disabled={busy}>
                  {t("offerSlots")}
                </Button>
              </div>
              {offerState.error ? (
                <span role="alert" className="text-xs text-destructive">
                  {t(`errors.${offerState.error}` as "errors.sendFailed")}
                </span>
              ) : offerState.offered > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("offerSlotsSent", { count: offerState.offered })}
                </span>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <p className="rounded-md border bg-warning-surface px-3 py-2 text-sm text-warning">
            {t("windowClosed")}
          </p>
          {d.templates.length > 0 ? (
            <form action={templateFormAction} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <input type="hidden" name="conversationId" value={conversationId} />
                <Select
                  key={templateGeneration}
                  name="template"
                  defaultValue={templateState.values.template}
                  className="flex-1"
                >
                  {d.templates.map((template) => (
                    <option key={template.id} value={`${template.name}|${template.language}`}>
                      {template.name} ({template.language})
                    </option>
                  ))}
                </Select>
                <Button type="submit" disabled={busy}>
                  {t("sendTemplate")}
                </Button>
              </div>
              {templateState.error && (
                <span role="alert" className="text-xs text-destructive">
                  {t(`errors.${templateState.error}` as "errors.sendFailed")}
                </span>
              )}
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Its own component so each draft carries its own approve state — hooks
// cannot be called from inside the map above, and one shared state would
// pin another draft's refusal to the wrong card.
function AiDraftCard({
  draft,
  conversationId,
  windowOpen,
  busy,
  mutate,
  onDiscard,
}: {
  draft: ConversationData["aiDrafts"][number];
  conversationId: string;
  windowOpen: boolean;
  busy: boolean;
  mutate: KeyedMutator<ConversationData>;
  onDiscard: () => void;
}) {
  const t = useTranslations("app.inbox");
  const [state, formAction, pending] = useActionState(approveAiDraftAction, approveInitialState);

  useEffect(() => {
    if (state !== approveInitialState) void mutate();
  }, [state, mutate]);

  return (
    <div className="flex flex-col gap-2 rounded-md bg-card text-card-foreground p-3 text-sm">
      <p>{draft.body}</p>
      <p className="text-xs text-muted-foreground">
        {draft.provider} · {draft.model} ·{" "}
        {t("aiTokens", { tokens: draft.promptTokens + draft.completionTokens })}
      </p>
      <div className="flex gap-2">
        {windowOpen ? (
          <form action={formAction}>
            <input type="hidden" name="replyId" value={draft.id} />
            <input type="hidden" name="conversationId" value={conversationId} />
            <Button type="submit" size="sm" disabled={busy || pending}>
              {t("aiApprove")}
            </Button>
          </form>
        ) : (
          <span className="text-xs text-warning">{t("aiDraftWindowClosed")}</span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || pending}
          onClick={onDiscard}
        >
          {t("aiDiscard")}
        </Button>
      </div>
      {/* The refusals deliverReply returns rather than throws: the window
          closed while the draft sat here, the kill switch was pulled, the
          contact opted out. Reported, never worked around. */}
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {t(`errors.${state.error}` as "errors.sendFailed")}
        </span>
      )}
    </div>
  );
}
