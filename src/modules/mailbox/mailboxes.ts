import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { mailboxes, tenants } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { domainOf } from "./headers";

// Mailbox addresses (PLAN-EMAIL.md E3). Tenant-scoped CRUD goes through
// tenantDb. The two raw-db reads here are routing lookups that must look
// across tenants by definition — "which business owns this address" and
// "does another business already own this domain" — the same kind of lookup
// the WhatsApp webhook does for phone_number_id (eslint.config.mjs).

export type MailboxRow = typeof mailboxes.$inferSelect;

export class MailboxError extends Error {
  constructor(public code: "invalid_address" | "address_taken" | "domain_taken") {
    super(code);
  }
}

const ADDRESS = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function listMailboxes(ctx: TenantContext) {
  return tenantDb(ctx).select(mailboxes).orderBy(mailboxes.address);
}

export async function getMailbox(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(mailboxes, eq(mailboxes.id, id));
  return row ?? null;
}

export type CreateMailboxInput = {
  address: string;
  displayName?: string | null;
  isCatchAll?: boolean;
};

export async function createMailbox(ctx: TenantContext, input: CreateMailboxInput) {
  const address = input.address.trim().toLowerCase();
  if (address.length > 320 || !ADDRESS.test(address)) throw new MailboxError("invalid_address");
  const domain = domainOf(address);

  // One domain, one business: otherwise a catch-all could route a second
  // business's mail into the first one's inbox.
  const [foreign] = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(and(eq(mailboxes.domain, domain), ne(mailboxes.tenantId, ctx.tenantId)))
    .limit(1);
  if (foreign) throw new MailboxError("domain_taken");

  const [existing] = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.address, address))
    .limit(1);
  if (existing) throw new MailboxError("address_taken");

  const id = newId();
  await tenantDb(ctx).insert(mailboxes).values({
    id,
    address,
    domain,
    displayName: input.displayName?.trim() || null,
    isCatchAll: input.isCatchAll ?? false,
  });
  return getMailbox(ctx, id);
}

export async function updateMailbox(
  ctx: TenantContext,
  id: string,
  input: { displayName?: string | null; isCatchAll?: boolean; isActive?: boolean },
) {
  await tenantDb(ctx)
    .update(mailboxes)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName?.trim() || null } : {}),
      ...(input.isCatchAll !== undefined ? { isCatchAll: input.isCatchAll } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mailboxes.id, id));
  return getMailbox(ctx, id);
}

/** Deactivates rather than deletes — threads keep pointing at it. */
export function deactivateMailbox(ctx: TenantContext, id: string) {
  return updateMailbox(ctx, id, { isActive: false });
}

export type ResolvedRecipient = { tenantId: string; mailbox: MailboxRow };

/**
 * Routing lookup for the inbound webhook: exact active address first, then
 * an active catch-all at the same domain. Only tenants with the mailbox
 * switched on (`tenants.mailbox_enabled`) receive anything.
 */
export async function resolveRecipient(recipient: string): Promise<ResolvedRecipient | null> {
  const address = recipient.trim().toLowerCase();
  const domain = domainOf(address);

  const candidates = await db
    .select({ mailbox: mailboxes, mailboxEnabled: tenants.mailboxEnabled })
    .from(mailboxes)
    .innerJoin(tenants, eq(tenants.id, mailboxes.tenantId))
    .where(and(eq(mailboxes.domain, domain), eq(mailboxes.isActive, true)));

  const exact = candidates.find((row) => row.mailbox.address === address);
  const match = exact ?? candidates.find((row) => row.mailbox.isCatchAll);
  if (!match || !match.mailboxEnabled) return null;
  return { tenantId: match.mailbox.tenantId, mailbox: match.mailbox };
}

/** Outbound correlation (E5 delivery events): the mailbox that sent from this
 *  address, active or not, whichever business owns it. */
export async function findMailboxByAddress(address: string): Promise<MailboxRow | null> {
  const [row] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.address, address.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}
