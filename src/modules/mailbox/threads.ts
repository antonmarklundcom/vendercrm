import { and, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { contacts, emailAttachments, emailMessages, emailThreads } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Reading and updating threads (PLAN-EMAIL.md E3/E4). Everything here is
// tenant-scoped through tenantDb.

export type EmailThreadRow = typeof emailThreads.$inferSelect;
export type EmailMessageRow = typeof emailMessages.$inferSelect;
export type EmailAttachmentRow = typeof emailAttachments.$inferSelect;

export const THREAD_WINDOW_DAYS = 14;

export async function getThread(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(emailThreads, eq(emailThreads.id, id));
  return row ?? null;
}

export type ListThreadsFilters = {
  mailboxId?: string;
  status?: "open" | "closed";
  contactId?: string;
  /** Keyset pagination: threads whose last message is older than this. */
  before?: Date;
  limit?: number;
};

export function listThreads(ctx: TenantContext, filters: ListThreadsFilters = {}) {
  const conditions: SQL[] = [];
  if (filters.mailboxId) conditions.push(eq(emailThreads.mailboxId, filters.mailboxId));
  if (filters.status) conditions.push(eq(emailThreads.status, filters.status));
  if (filters.contactId) conditions.push(eq(emailThreads.contactId, filters.contactId));
  if (filters.before) conditions.push(lt(emailThreads.lastMessageAt, filters.before));
  return tenantDb(ctx)
    .select(emailThreads, conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(Math.min(filters.limit ?? 50, 200));
}

export function countUnreadThreads(ctx: TenantContext) {
  return tenantDb(ctx).count(
    emailThreads,
    and(eq(emailThreads.unread, true), eq(emailThreads.status, "open")),
  );
}

export function listThreadMessages(ctx: TenantContext, threadId: string) {
  return tenantDb(ctx)
    .select(emailMessages, eq(emailMessages.threadId, threadId))
    .orderBy(emailMessages.sentAt, emailMessages.createdAt);
}

export async function getMessage(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(emailMessages, eq(emailMessages.id, id));
  return row ?? null;
}

export async function listAttachmentsForMessages(ctx: TenantContext, messageIds: string[]) {
  if (messageIds.length === 0) return [];
  return tenantDb(ctx).select(emailAttachments, inArray(emailAttachments.emailMessageId, messageIds));
}

export async function getAttachment(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(emailAttachments, eq(emailAttachments.id, id));
  return row ?? null;
}

export async function markThreadRead(ctx: TenantContext, id: string, unread = false) {
  await tenantDb(ctx).update(emailThreads).set({ unread }).where(eq(emailThreads.id, id));
}

export async function setThreadStatus(ctx: TenantContext, id: string, status: "open" | "closed") {
  await tenantDb(ctx)
    .update(emailThreads)
    .set({ status, updatedAt: new Date() })
    .where(eq(emailThreads.id, id));
}

/** Links a thread to a contact (and optionally a deal) of the same tenant. */
export async function linkThread(
  ctx: TenantContext,
  id: string,
  link: { contactId?: string | null; dealId?: string | null },
) {
  if (link.contactId) {
    const [contact] = await tenantDb(ctx).select(contacts, eq(contacts.id, link.contactId));
    if (!contact) throw new Error("contact_not_found");
  }
  await tenantDb(ctx)
    .update(emailThreads)
    .set({
      ...(link.contactId !== undefined ? { contactId: link.contactId } : {}),
      ...(link.dealId !== undefined ? { dealId: link.dealId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, id));
}

/** The contact whose email matches, if exactly the address is on file. */
export async function findContactByEmail(ctx: TenantContext, email: string) {
  const [row] = await tenantDb(ctx)
    .select(contacts, eq(contacts.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

/**
 * Threading fallback (PLAN-EMAIL.md E3): same mailbox, same outside person,
 * same normalized subject, last message within the window.
 */
export async function findRecentThread(
  ctx: TenantContext,
  input: { mailboxId: string; participantEmail: string; normalizedSubject: string; now: Date },
) {
  const since = new Date(input.now.getTime() - THREAD_WINDOW_DAYS * 86_400_000);
  const [row] = await tenantDb(ctx)
    .select(
      emailThreads,
      and(
        eq(emailThreads.mailboxId, input.mailboxId),
        eq(emailThreads.participantEmail, input.participantEmail),
        eq(emailThreads.normalizedSubject, input.normalizedSubject),
        gte(emailThreads.lastMessageAt, since),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(1);
  return row ?? null;
}

/** The thread an In-Reply-To/References id list points into, if any. */
export async function findThreadByMessageIds(ctx: TenantContext, ids: string[]) {
  if (ids.length === 0) return null;
  const [row] = await tenantDb(ctx)
    .select(emailMessages, inArray(emailMessages.messageId, ids))
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);
  return row ? getThread(ctx, row.threadId) : null;
}

export async function findMessageByMessageId(ctx: TenantContext, messageId: string) {
  const [row] = await tenantDb(ctx).select(emailMessages, eq(emailMessages.messageId, messageId));
  return row ?? null;
}
