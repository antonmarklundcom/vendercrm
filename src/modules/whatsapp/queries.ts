import { eq } from "drizzle-orm";
import { tenantDb } from "@/modules/tenancy/db";
import { conversations, messages, waAccounts, waTemplates } from "@/db/schema/whatsapp";
import { decrypt } from "@/lib/crypto";
import type { TenantContext } from "@/modules/tenancy/context";

export async function listWaAccounts(ctx: TenantContext) {
  return tenantDb(ctx).findMany(waAccounts);
}

export async function getWaAccountById(ctx: TenantContext, id: string) {
  return tenantDb(ctx).findFirst(waAccounts, eq(waAccounts.id, id));
}

export function getDecryptedAccessToken(account: {
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenTag: string;
}): string {
  return decrypt({
    ciphertext: account.accessTokenCiphertext,
    iv: account.accessTokenIv,
    tag: account.accessTokenTag,
  });
}

export async function listTemplates(ctx: TenantContext, waAccountId: string) {
  return tenantDb(ctx).findMany(waTemplates, eq(waTemplates.waAccountId, waAccountId));
}

export async function listApprovedTemplates(ctx: TenantContext, waAccountId: string) {
  const all = await listTemplates(ctx, waAccountId);
  return all.filter((t) => t.status === "approved");
}

export async function listConversations(
  ctx: TenantContext,
  filters: { assignedUserId?: string; status?: "open" | "closed" } = {},
) {
  const scoped = tenantDb(ctx);
  const all = await scoped.findMany(conversations);

  return all
    .filter((c) => (filters.assignedUserId ? c.assignedUserId === filters.assignedUserId : true))
    .filter((c) => (filters.status ? c.status === filters.status : true))
    .sort((a, b) => {
      const at = a.lastMessageAt?.getTime() ?? 0;
      const bt = b.lastMessageAt?.getTime() ?? 0;
      return bt - at;
    });
}

export async function getConversationById(ctx: TenantContext, id: string) {
  return tenantDb(ctx).findFirst(conversations, eq(conversations.id, id));
}

export async function getConversationMessages(ctx: TenantContext, conversationId: string) {
  const rows = await tenantDb(ctx).findMany(messages, eq(messages.conversationId, conversationId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** True if a free-form (non-template) message is currently allowed. */
export function isWithin24HourWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
}
