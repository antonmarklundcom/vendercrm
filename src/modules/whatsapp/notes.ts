import { eq } from "drizzle-orm";
import { conversationNotes } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Internal notes on a conversation (PLAN.md §15.5 J2, §15.8 P3): rendered
// inline in the thread but never sent — no `messages` row, invisible to the
// customer. Also read by modules/crm/timeline.ts for the contact record.

export async function addNote(
  ctx: TenantContext,
  input: { conversationId: string; contactId: string; body: string },
) {
  const id = newId();
  await tenantDb(ctx)
    .insert(conversationNotes)
    .values({
      id,
      conversationId: input.conversationId,
      contactId: input.contactId,
      authorUserId: ctx.userId,
      body: input.body,
    });
  const [row] = await tenantDb(ctx).select(conversationNotes, eq(conversationNotes.id, id));
  return row ?? null;
}

export async function listNotesForConversation(ctx: TenantContext, conversationId: string) {
  const rows = await tenantDb(
    ctx,
  ).select(conversationNotes, eq(conversationNotes.conversationId, conversationId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function listNotesForContact(ctx: TenantContext, contactId: string) {
  const rows = await tenantDb(ctx).select(conversationNotes, eq(conversationNotes.contactId, contactId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
