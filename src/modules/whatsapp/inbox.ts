import { and, eq } from "drizzle-orm";
import { conversations, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getActiveTenantUser } from "@/modules/tenancy/users";
import { whatsappEvents } from "./events";

// Unified inbox read paths (PLAN.md §6.5). Sending goes through ./send.ts;
// this file is read-only (conversation list, message thread, mark-read).

export async function listConversations(ctx: TenantContext) {
  const rows = await tenantDb(ctx).select(conversations);
  return rows.sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });
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
