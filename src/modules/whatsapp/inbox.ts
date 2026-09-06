import { and, eq, isNull, like, or, type SQL } from "drizzle-orm";
import { contacts, conversations, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { storage } from "@/lib/storage";
import { getActiveTenantUser } from "@/modules/tenancy/users";
import { whatsappEvents } from "./events";

// Unified inbox read paths (PLAN.md §6.5). Sending goes through ./send.ts;
// this file is read-only (conversation list, message thread, mark-read).

/** List filters as URL params (§15.8 P3): `mine`, `unassigned`, `unread`. */
export type InboxListFilter = "mine" | "unassigned" | "unread" | "all";

export async function listConversations(
  ctx: TenantContext,
  filters: { filter?: InboxListFilter } = {},
) {
  const extra: SQL | undefined =
    filters.filter === "mine"
      ? eq(conversations.assignedUserId, ctx.userId)
      : filters.filter === "unassigned"
        ? isNull(conversations.assignedUserId)
        : undefined;

  const rows = await tenantDb(ctx).select(conversations, extra);
  const filtered =
    filters.filter === "unread" ? rows.filter((row) => row.unreadCount > 0) : rows;

  return filtered.sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });
}

/**
 * `/inbox?q=` message + contact search (§15.8 P3). Matches message body or
 * the contact's name/phone, LIKE with a limit, scoped by `tenantDb`. Contact
 * matches are resolved first (a search is almost always "find So-and-so"
 * rather than a phrase match), then message-body matches fill the rest.
 */
export async function searchConversations(ctx: TenantContext, query: string, limit = 50) {
  const term = `%${query}%`;

  const matchingContacts = await tenantDb(
    ctx,
  ).select(contacts, or(like(contacts.name, term), like(contacts.phone, term)) as SQL);
  const contactIds = new Set(matchingContacts.map((c) => c.id));

  // Transcripts are searched alongside bodies (§15.10 W1): to a rep looking
  // for "el presupuesto del portón", whether the customer typed it or said
  // it in a voice note is not a distinction worth losing the result over.
  const matchingMessages = await tenantDb(ctx).select(
    messages,
    or(like(messages.body, term), like(messages.transcript, term)) as SQL,
  );
  const conversationIdsFromMessages = new Set(matchingMessages.map((m) => m.conversationId));

  const all = await tenantDb(ctx).select(conversations);
  const matched = all.filter(
    (row) => contactIds.has(row.contactId) || conversationIdsFromMessages.has(row.id),
  );

  return matched
    .sort((a, b) => {
      const at = a.lastMessageAt?.getTime() ?? 0;
      const bt = b.lastMessageAt?.getTime() ?? 0;
      return bt - at;
    })
    .slice(0, limit);
}

/** Conversations belonging to one contact — the contact detail's
 * conversation tab, where the thread is shown in the contact's context
 * rather than the inbox's. */
export async function listConversationsForContact(ctx: TenantContext, contactId: string) {
  const rows = await tenantDb(ctx).select(conversations, eq(conversations.contactId, contactId));
  return rows.sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });
}

export async function getConversation(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(conversations, eq(conversations.id, id));
  return row ?? null;
}

export async function listMessagesForConversation(ctx: TenantContext, conversationId: string) {
  const rows = await tenantDb(ctx).select(messages, eq(messages.conversationId, conversationId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  transcript: string | null;
  transcriptStatus: string | null;
  transcriptError: string | null;
  /** Signed, expiring URL for an audio bubble's player; null otherwise. */
  audioUrl: string | null;
  status: string;
  createdAt: string;
};

/**
 * The thread as the inbox renders it (PLAN.md §15.10 W1). One mapper for
 * both readers — the page's first render and the 5s poll route — because a
 * voice note that plays on load and not on the next poll is a bug nobody
 * would think to look for.
 *
 * Audio URLs are minted per read rather than stored: they expire, and the
 * object they point at is tenant media that must never be guessable
 * (lib/storage/signed-url.ts).
 */
export async function toThreadMessages(
  rows: Array<typeof messages.$inferSelect>,
): Promise<ThreadMessage[]> {
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      direction: row.direction as "in" | "out",
      type: row.type,
      body: row.body,
      transcript: row.transcript,
      transcriptStatus: row.transcriptStatus,
      transcriptError: row.transcriptError,
      audioUrl:
        row.type === "audio" && row.storageKey
          ? await storage.getSignedUrl(row.storageKey).catch(() => null)
          : null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
  );
}

/** Raised rather than silently ignored: an assignment that names a user who
 * cannot own the conversation is a tampered form, and writing it would leave
 * a row pointing at someone the rest of the app will never resolve. */
export class ConversationAssignError extends Error {
  constructor(readonly code: "userNotFound") {
    super(code);
  }
}

/**
 * Gives a conversation an owner, or clears it (`null` = sin asignar).
 *
 * The membership check is the point: `conversations.assignedUserId` has no
 * foreign key (§4 has none anywhere), and `tenantDb` scopes the *conversation*
 * row without saying anything about the user id in the payload. Without this,
 * a hand-crafted POST could park another tenant's conversation on one of our
 * reps, or assign work to a salesperson who was deactivated this morning —
 * whose queue nobody is reading. `getActiveTenantUser` answers both questions
 * at once, since it is the same check `getTenantContext` runs per request.
 */
export async function assignConversation(
  ctx: TenantContext,
  id: string,
  userId: string | null,
) {
  if (userId) {
    const user = await getActiveTenantUser(userId, ctx.tenantId);
    if (!user) throw new ConversationAssignError("userNotFound");
  }

  await tenantDb(ctx).update(conversations).set({ assignedUserId: userId }).where(eq(conversations.id, id));

  // Announced rather than notified directly: "somebody now owns this" is a
  // fact about the conversation, and who wants telling about it is the
  // notifications module's business, not the inbox's (PLAN.md §15.5 J2).
  const conversation = await getConversation(ctx, id);
  if (conversation) {
    await whatsappEvents.emit("wa.conversation_assigned", {
      tenantId: ctx.tenantId,
      conversationId: id,
      contactId: conversation.contactId,
      assignedUserId: userId,
      assignedByUserId: ctx.userId,
    });
  }
}

export async function markConversationRead(ctx: TenantContext, id: string) {
  await tenantDb(ctx).update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, id));
}

/** "Mark as unread" (§15.8 P3): there is no true unread count to restore, so
 *  this sets the flag to 1 — enough to bring the conversation back into the
 *  `unread` filter and put a badge on the row, which is the whole point of
 *  the action (send it back to the top of triage). */
export async function markConversationUnread(ctx: TenantContext, id: string) {
  await tenantDb(ctx).update(conversations).set({ unreadCount: 1 }).where(eq(conversations.id, id));
}

/**
 * Outbound-first conversations (quote delivery, §8): a contact that has
 * never written to us has no conversation row yet. The new row gets
 * lastInboundAt = null, so the 24h window is correctly *closed* — sending
 * free-form to it fails, which is exactly Meta's rule, not a bug.
 */
export async function getOrCreateConversation(
  ctx: TenantContext,
  waAccountId: string,
  contactId: string,
) {
  const [existing] = await tenantDb(ctx).select(
    conversations,
    and(eq(conversations.waAccountId, waAccountId), eq(conversations.contactId, contactId)),
  );
  if (existing) return existing;

  const id = newId();
  await tenantDb(ctx)
    .insert(conversations)
    .values({ id, waAccountId, contactId, status: "open", unreadCount: 0 });

  const [created] = await tenantDb(ctx).select(conversations, eq(conversations.id, id));
  return created;
}

export function isWithinFreeFormWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
}
