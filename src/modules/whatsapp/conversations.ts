import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { conversations, messages, waAccounts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function upsertConversation(
  ctx: TenantContext,
  input: { waAccountId: string; contactId: string },
): Promise<string> {
  const tdb = tenantDb(ctx);
  const [existing] = await tdb.select(
    conversations,
    and(
      eq(conversations.waAccountId, input.waAccountId),
      eq(conversations.contactId, input.contactId),
    )!,
  );
  if (existing) return existing.id;

  const id = newId();
  await tdb.insert(conversations, {
    id,
    waAccountId: input.waAccountId,
    contactId: input.contactId,
    status: "open",
  });
  return id;
}

// Used by other modules (quotes) that need to send a contact a WhatsApp
// message without the caller managing account/conversation plumbing. Uses the
// tenant's (single, Phase 1) connected account.
export async function getOrCreateConversationForContact(
  ctx: TenantContext,
  contactId: string,
): Promise<string> {
  const [account] = await tenantDb(ctx).select(waAccounts);
  if (!account) throw new Error("La empresa no tiene WhatsApp conectado");
  return upsertConversation(ctx, { waAccountId: account.id, contactId });
}

export async function getConversation(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(conversations, eq(conversations.id, id));
  return row ?? null;
}

export async function listConversations(
  ctx: TenantContext,
  filter?: { assignedToMe?: boolean; unassigned?: boolean },
) {
  const conds = [eq(conversations.status, "open")];
  if (filter?.assignedToMe)
    conds.push(eq(conversations.assignedUserId, ctx.userId));
  if (filter?.unassigned) conds.push(isNull(conversations.assignedUserId));
  return tenantDb(ctx)
    .select(conversations, and(...conds))
    .orderBy(desc(conversations.lastMessageAt));
}

export async function listMessages(ctx: TenantContext, conversationId: string) {
  return tenantDb(ctx)
    .select(messages, eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

export async function assignConversation(
  ctx: TenantContext,
  conversationId: string,
  userId: string | null,
): Promise<void> {
  await tenantDb(ctx).update(
    conversations,
    { assignedUserId: userId },
    eq(conversations.id, conversationId),
  );
}

export async function markConversationRead(
  ctx: TenantContext,
  conversationId: string,
): Promise<void> {
  await tenantDb(ctx).update(
    conversations,
    { unreadCount: 0 },
    eq(conversations.id, conversationId),
  );
}

// The 24-hour free-form window (PLAN.md §6.4): inside it, free-form messages are
// allowed; outside, only templates. Derived from the conversation's last
// inbound timestamp so the send service can enforce it centrally.
export function isWithinFreeformWindow(
  conversation: Pick<Conversation, "lastInboundAt">,
  now: Date = new Date(),
): boolean {
  if (!conversation.lastInboundAt) return false;
  return now.getTime() - conversation.lastInboundAt.getTime() < WINDOW_MS;
}

// Bump conversation metadata on a new inbound message.
export async function recordInboundOnConversation(
  ctx: TenantContext,
  conversationId: string,
  at: Date,
): Promise<void> {
  await tenantDb(ctx).update(
    conversations,
    {
      lastInboundAt: at,
      lastMessageAt: at,
      unreadCount: sql`${conversations.unreadCount} + 1` as unknown as number,
    },
    eq(conversations.id, conversationId),
  );
}

export async function touchConversationOutbound(
  ctx: TenantContext,
  conversationId: string,
  at: Date,
): Promise<void> {
  await tenantDb(ctx).update(
    conversations,
    { lastMessageAt: at },
    eq(conversations.id, conversationId),
  );
}
