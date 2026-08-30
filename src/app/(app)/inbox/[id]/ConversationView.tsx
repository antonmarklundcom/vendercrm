"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
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
  type ApproveDraftState,
  type SendTemplateState,
  type SendTextState,
  type OfferSlotsState,
} from "../actions";
import { formatDateTime } from "@/lib/i18n/format";
import { Input, Select } from "@/components/ui/form-fields";
import { AssigneePicker, type AssignableUser } from "../AssigneePicker";

export type ConversationData = {
  contact: { name: string; phone: string; whatsappHref: string | null } | null;
  conversation: {
    id: string;
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

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Declared here, not in actions.ts: a "use server" module may only export
// async functions.
const sendTextInitialState: SendTextState = { error: null, sent: false, values: { body: "" } };
const sendTemplateInitialState: SendTemplateState = { error: null, values: { template: "" } };
const approveInitialState: ApproveDraftState = { error: null };
const offerSlotsInitialState: OfferSlotsState = { error: null, offered: 0 };

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
  bookingTypes,
}: {
  conversationId: string;
  initial: ConversationData;
  /** Active members of the tenant, passed once from the page: the one part
   *  of this screen the 5s poll has no reason to re-fetch. */
  users: AssignableUser[];
  /** Bookable types, for "Ofrecer horarios". Static per tenant, same reason. */
  bookingTypes: Array<{ id: string; name: string }>;
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
  const prevCountRef = useRef(d.messages.length);
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

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (d.messages.length !== prevCountRef.current && (nearBottom || prevCountRef.current === 0)) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = d.messages.length;
  }, [d.messages.length]);

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

      <div className="flex items-center gap-2 text-sm">
        <span className={aiDisabled ? "text-muted-foreground" : "text-success"}>
          {aiDisabled ? t("aiOff") : t("aiOn")}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={handleToggleAi}>
          {aiDisabled ? t("aiEnable") : t("aiDisable")}
        </Button>
      </div>

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
        {d.messages.map((message) => (
          <li
            key={message.id}
            className={`max-w-md rounded-md border px-3 py-2 text-sm ${
              message.direction === "out" ? "ml-auto bg-accent" : ""
            }`}
          >
            <p>{message.body}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(message.createdAt, locale)} · {message.status}
            </p>
          </li>
        ))}
        {d.messages.length === 0 && <li className="text-muted-foreground">{t("noMessages")}</li>}
      </ul>

      {d.windowOpen ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("windowOpen", { remaining: formatRemaining(d.conversation.lastInboundAt) })}
          </p>
          <form action={sendFormAction} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input type="hidden" name="conversationId" value={conversationId} />
              {/* No `required`: the bubble would render in the browser's
                  language on a Spanish-only app (§1.2). The server answers.
                  Keyed so a rejected send hands the typed text back — and so
                  a poll tick, which changes no action state, leaves a
                  half-typed reply exactly where it is. */}
              <Input
                key={sendGeneration}
                name="body"
                defaultValue={sendState.values.body}
                placeholder={t("messagePlaceholder")}
                className="flex-1"
              />
              <Button type="submit" disabled={busy}>
                {t("send")}
              </Button>
            </div>
            {sendState.error && (
              <span role="alert" className="text-xs text-destructive">
                {t(`errors.${sendState.error}` as "errors.sendFailed")}
              </span>
            )}
          </form>

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
    <div className="flex flex-col gap-2 rounded-md bg-white p-3 text-sm">
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
