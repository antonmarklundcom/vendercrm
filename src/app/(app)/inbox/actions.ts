"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { offerSlots } from "@/modules/booking/whatsapp-booking";
import { requireTenantContext } from "@/modules/tenancy/context";
import { sendText, sendTemplate } from "@/modules/whatsapp/send";
import {
  assignConversation,
  getConversation,
  markConversationRead,
  markConversationUnread,
} from "@/modules/whatsapp/inbox";
import { addNote } from "@/modules/whatsapp/notes";
import { createQuickReply, deleteQuickReply, updateQuickReply } from "@/modules/whatsapp/quick-replies";
import { hasOptedOut } from "@/modules/automations/actions";
import { createActivity } from "@/modules/crm/activities";
import { deliverReply, type AiReplyOutcome } from "@/modules/ai/reply";
import { markReplyDiscarded, setConversationAiEnabled } from "@/modules/ai/replies";

// useActionState-shaped (PLAN.md §10 1R #6). The inbox is the awkward case
// for that pattern because it also polls every 5s (§10 1R #3): a returned
// error has to outlive the next refresh. It does, because the action state
// is React state that SWR never touches — the refresh replaces `data`, not
// the form state, and the reply box is remounted only when a new action
// result arrives.
//
// Copy stays out of the actions as everywhere else: they return a message
// key the client resolves through next-intl (§1.2).

const sendTextSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().min(1).max(4096),
  // Set once the rep has clicked through the opt-out confirm dialog
  // (§15.8 P3). Absent/false on the first submit for every conversation —
  // whether it is actually needed is decided server-side below.
  confirmed: z.boolean(),
});

export type SendTextState = {
  error: string | null;
  /** Distinguishes a delivered send from the initial state, so the client
   *  clears the box only once the server actually accepted it. */
  sent: boolean;
  values: { body: string };
  /** True when the contact is tagged `optout`: the client shows a confirm
   *  dialog naming the tag and resubmits with `confirmed=true`. */
  needsOptoutConfirm: boolean;
};

export async function sendTextAction(
  _prevState: SendTextState,
  formData: FormData,
): Promise<SendTextState> {
  const ctx = await requireTenantContext();
  const body = String(formData.get("body") ?? "");

  const parsed = sendTextSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body,
    confirmed: formData.get("confirmed") === "true",
  });
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some(
      (issue) => issue.path[0] === "body" && issue.code === "too_big",
    );
    return {
      error: tooLong ? "bodyTooLong" : "bodyRequired",
      sent: false,
      values: { body },
      needsOptoutConfirm: false,
    };
  }

  if (!parsed.data.confirmed) {
    const conversation = await getConversation(ctx, parsed.data.conversationId);
    if (conversation && (await hasOptedOut(ctx, conversation.contactId))) {
      return { error: null, sent: false, values: { body }, needsOptoutConfirm: true };
    }
  } else {
    // Confirmed past the dialog: the override itself is worth a record on
    // the contact, since it means someone chose to write to a person who
    // asked not to hear from the business again.
    const conversation = await getConversation(ctx, parsed.data.conversationId);
    if (conversation) {
      await createActivity(ctx, {
        contactId: conversation.contactId,
        type: "system",
        payload: { kind: "optout_override_send" },
        userId: ctx.userId,
      });
    }
  }

  try {
    await sendText(ctx, { conversationId: parsed.data.conversationId, body: parsed.data.body });
  } catch (err) {
    // sendText throws when the 24h window has closed (§6.4). That guard is
    // not weakened here — it is only reported, instead of reaching Next's
    // error page and taking the half-typed reply with it.
    const message = err instanceof Error ? err.message : "";
    return {
      error: message.includes("ventana de 24 horas") ? "windowClosed" : "sendFailed",
      sent: false,
      values: { body },
      needsOptoutConfirm: false,
    };
  }

  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return { error: null, sent: true, values: { body: "" }, needsOptoutConfirm: false };
}

// The picker submits "name|language" as one value — the pair is the
// template's identity (§6.4 sends require both), and keeping them in one
// option value avoids a second dependent <select>.
const sendTemplateSchema = z.object({
  conversationId: z.string().min(1),
  template: z.string().min(1).includes("|"),
});

export type SendTemplateState = {
  error: string | null;
  values: { template: string };
};

export async function sendTemplateAction(
  _prevState: SendTemplateState,
  formData: FormData,
): Promise<SendTemplateState> {
  const ctx = await requireTenantContext();
  const template = String(formData.get("template") ?? "");

  const parsed = sendTemplateSchema.safeParse({
    conversationId: formData.get("conversationId"),
    template,
  });
  if (!parsed.success) {
    return { error: "templateRequired", values: { template } };
  }

  const separator = parsed.data.template.lastIndexOf("|");
  try {
    await sendTemplate(ctx, {
      conversationId: parsed.data.conversationId,
      templateName: parsed.data.template.slice(0, separator),
      language: parsed.data.template.slice(separator + 1),
    });
  } catch {
    return { error: "sendFailed", values: { template } };
  }

  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return { error: null, values: { template: "" } };
}

// --- AI auto-reply (PLAN.md §10 1O) --------------------------------------
// Approving a draft is a *send*, so it goes through modules/ai's deliverReply
// rather than sendText directly: that re-checks the window, the kill switch
// and the opt-out tag, all of which may have changed since the draft was
// written.

const replyIdSchema = z.object({
  replyId: z.string().min(1),
  conversationId: z.string().min(1),
});

export type ApproveDraftState = { error: string | null };

/**
 * The one hidden-id-only action here that still gets form state, because the
 * usual test cuts the other way: deliverReply *returns* its refusals rather
 * than throwing, and those refusals are things the rep needs to read — the
 * 24h window closed while the draft sat there, or the kill switch was
 * pulled, or the contact opted out. Discarding the return value would leave
 * the draft on screen with nothing said, which is worse than no message at
 * all. No guard in modules/ai is touched: this maps an outcome to a message
 * key and nothing more.
 */
function draftFailureKey(outcome: AiReplyOutcome): string | null {
  if (outcome.status === "sent") return null;
  if (outcome.status === "skipped") {
    switch (outcome.reason) {
      case "window_closed":
        return "aiWindowClosed";
      case "conversation_ai_disabled":
        return "aiConversationDisabled";
      case "contact_opted_out":
        return "aiOptedOut";
      default:
        return "aiSendFailed";
    }
  }
  return "aiSendFailed";
}

export async function approveAiDraftAction(
  _prevState: ApproveDraftState,
  formData: FormData,
): Promise<ApproveDraftState> {
  const ctx = await requireTenantContext();

  const parsed = replyIdSchema.safeParse({
    replyId: formData.get("replyId"),
    conversationId: formData.get("conversationId"),
  });
  if (!parsed.success) return { error: null };

  let outcome: AiReplyOutcome;
  try {
    outcome = await deliverReply(ctx, parsed.data.replyId, ctx.userId);
  } catch {
    return { error: "aiSendFailed" };
  }

  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return { error: draftFailureKey(outcome) };
}

// Hidden-id-only with no refusal path to report: discarding a draft and
// pulling the per-conversation kill switch are plain updates, and the only
// way either fails is a tampered id, which has no field to sit under.
// safeParse + silent return, like the issue/send/suspend buttons — the
// client re-reads the conversation afterwards either way, so a no-op shows
// up as the screen simply not changing.
export async function discardAiDraftAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = replyIdSchema.safeParse({
    replyId: formData.get("replyId"),
    conversationId: formData.get("conversationId"),
  });
  if (!parsed.success) return;

  await markReplyDiscarded(ctx, parsed.data.replyId, ctx.userId);
  revalidatePath(`/inbox/${parsed.data.conversationId}`);
}

/** Per-conversation kill switch — any agent can pull it, not admins only. */
export async function setConversationAiAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("conversationId"));
  if (!parsed.success) return;
  const enabled = formData.get("enabled") === "true";

  await setConversationAiEnabled(ctx, parsed.data, enabled);
  revalidatePath(`/inbox/${parsed.data}`);
}

export async function markReadAction(conversationId: string) {
  const ctx = await requireTenantContext();
  await markConversationRead(ctx, conversationId);
  revalidatePath("/inbox");
}

export async function markUnreadAction(conversationId: string) {
  const ctx = await requireTenantContext();
  await markConversationUnread(ctx, conversationId);
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${conversationId}`);
}

// --- Internal notes (PLAN.md §15.8 P3) -----------------------------------
// Never a `messages` row, never sent — a note rendered inline in the thread
// and on the contact timeline (modules/crm/timeline.ts).

const addNoteSchema = z.object({
  conversationId: z.string().min(1),
  contactId: z.string().min(1),
  body: z.string().min(1).max(2000),
});

export type AddNoteState = { error: string | null };

export async function addNoteAction(
  _prevState: AddNoteState,
  formData: FormData,
): Promise<AddNoteState> {
  const ctx = await requireTenantContext();
  const parsed = addNoteSchema.safeParse({
    conversationId: formData.get("conversationId"),
    contactId: formData.get("contactId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "noteRequired" };

  await addNote(ctx, parsed.data);
  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return { error: null };
}

// --- Quick replies (PLAN.md §15.8 P3) ------------------------------------
// Tenant-level, managed from /inbox/quick-replies (admin-only, enforced by
// the page itself — these actions trust the caller the way the rest of the
// module's agent-accessible actions do, since nothing here is destructive
// beyond a canned-response text).

const quickReplySchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(4096),
});

export type QuickReplyFormState = { error: string | null };

export async function createQuickReplyAction(
  _prevState: QuickReplyFormState,
  formData: FormData,
): Promise<QuickReplyFormState> {
  const ctx = await requireTenantContext();
  const parsed = quickReplySchema.safeParse({
    name: formData.get("name"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "quickReplyInvalid" };

  await createQuickReply(ctx, parsed.data);
  revalidatePath("/inbox/quick-replies");
  return { error: null };
}

export async function updateQuickReplyAction(id: string, formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = quickReplySchema.safeParse({
    name: formData.get("name"),
    body: formData.get("body"),
  });
  if (!parsed.success) return;

  await updateQuickReply(ctx, id, parsed.data);
  revalidatePath("/inbox/quick-replies");
}

export async function deleteQuickReplyAction(id: string) {
  const ctx = await requireTenantContext();
  await deleteQuickReply(ctx, id);
  revalidatePath("/inbox/quick-replies");
}

// --- Ownership (PLAN.md §6.5) --------------------------------------------
//
// Agent-accessible, deliberately. §13 H1 reserves *configuration* for admins;
// deciding which rep answers a customer is selling work, and `assignDeal` —
// the same decision one object over — has always been agent-accessible. A
// tenant where only the admin can hand a conversation to a colleague is a
// tenant where conversations don't get handed over.
//
// Nothing destructive happens here either, so this is not a
// requireTenantAdmin + auditLog case (§13 H1's rule): reassignment loses no
// data and is undone by reassigning back.
const assignSchema = z.object({
  conversationId: z.string().min(1),
  // The empty option is "sin asignar", so an empty string is a real choice
  // and not a missing field.
  userId: z.string().min(1).nullable(),
});

export async function assignConversationAction(formData: FormData) {
  const ctx = await requireTenantContext();

  const raw = String(formData.get("userId") ?? "");
  const parsed = assignSchema.safeParse({
    conversationId: formData.get("conversationId"),
    userId: raw === "" ? null : raw,
  });
  if (!parsed.success) return;

  // Throws on a user who isn't an active member of this tenant. Left to
  // propagate: the picker reports it as a toast, and swallowing it would
  // leave the rep looking at a name that was never saved.
  await assignConversation(ctx, parsed.data.conversationId, parsed.data.userId);

  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  revalidatePath("/inbox");
}

/**
 * "Ofrecer horarios" — the rep's half of booking inside WhatsApp
 * (plan-booking.md §5.3). Sends the next free slots as tappable options; the
 * customer's tap arrives as a webhook and reserves through the same
 * transaction the public page uses.
 */
export type OfferSlotsState = { error: string | null; offered: number };

export async function offerSlotsAction(
  _prevState: OfferSlotsState,
  formData: FormData,
): Promise<OfferSlotsState> {
  const ctx = await requireTenantContext();
  const conversationId = String(formData.get("conversationId") ?? "");
  const bookingTypeId = String(formData.get("bookingTypeId") ?? "");
  if (!conversationId || !bookingTypeId) return { error: "bookingTypeRequired", offered: 0 };

  const outcome = await offerSlots(ctx, { conversationId, bookingTypeId });
  if (outcome.status !== "offered") {
    // The three reasons a rep can act on, named rather than collapsed into
    // "no se pudo": no free slots, a closed window, or a retired type.
    return {
      error:
        outcome.reason === "no_slots"
          ? "noSlots"
          : outcome.reason === "window_closed"
            ? "windowClosed"
            : "bookingTypeRequired",
      offered: 0,
    };
  }

  revalidatePath(`/inbox/${conversationId}`);
  return { error: null, offered: outcome.count };
}
