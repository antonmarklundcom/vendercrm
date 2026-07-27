import { and, eq, like, or, type SQL } from "drizzle-orm";
import { contactTags, contacts, tags } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { filterBySiteScope, siteInScope } from "@/modules/access/scope";
import { crmEvents } from "./events";

// Contacts (PLAN.md §4 "crm", §5): phone (E.164) is the primary identity
// key, unique per tenant.

/**
 * JUDGMENT CALL (not specified in PLAN.md — flagged for Fable review):
 * normalizes Paraguayan local input (e.g. "0981 123 456") to E.164
 * ("+595981123456"). Numbers already starting with "+" pass through
 * untouched so other-country contacts aren't mangled.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+595${digits.slice(1)}`;
  if (digits.startsWith("595")) return `+${digits}`;
  return `+595${digits}`;
}

export type CreateContactInput = {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  source?: string;
  ownerUserId?: string;
};

export type UpdateContactInput = Partial<
  Omit<CreateContactInput, "phone">
> & {
  phone?: string;
};

export type ListContactsFilters = {
  search?: string;
  tagId?: string;
  ownerUserId?: string;
  source?: string;
};

export async function createContact(ctx: TenantContext, input: CreateContactInput) {
  const id = newId();
  const phone = normalizePhone(input.phone);

  await tenantDb(ctx)
    .insert(contacts)
    .values({
      id,
      name: input.name,
      phone,
      email: input.email,
      notes: input.notes,
      source: input.source,
      ownerUserId: input.ownerUserId,
    });

  await crmEvents.emit("contact.created", { tenantId: ctx.tenantId, contactId: id });

  return getContact(ctx, id);
}

export async function updateContact(
  ctx: TenantContext,
  id: string,
  input: UpdateContactInput,
) {
  const values: Partial<typeof contacts.$inferInsert> = { ...input };
  if (input.phone) values.phone = normalizePhone(input.phone);

  await tenantDb(ctx).update(contacts).set(values).where(eq(contacts.id, id));
  return getContact(ctx, id);
}

export async function getContact(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(contacts, eq(contacts.id, id));
  if (!row) return null;
  // A site-restricted user must not be able to read a contact by guessing
  // its id any more than they can list it (PLAN.md §5.2).
  if (!siteInScope(ctx, row.firstSiteId)) return null;
  return row;
}

/** Ingest-side lookup: deliberately NOT site-scoped, because a returning
 * lead must be matched to its existing contact regardless of which site it
 * arrives from. Only ever called with a system context. */
export async function getContactByPhone(ctx: TenantContext, phone: string) {
  const [row] = await tenantDb(ctx).select(contacts, eq(contacts.phone, normalizePhone(phone)));
  return row ?? null;
}

export async function deleteContact(ctx: TenantContext, id: string) {
  await tenantDb(ctx).delete(contacts, eq(contacts.id, id));
}

/** List with search (name/phone/email) and tag/owner/source filters (§5). */
export async function listContacts(ctx: TenantContext, filters: ListContactsFilters = {}) {
  const conditions: SQL[] = [];

  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        like(contacts.name, term),
        like(contacts.phone, term),
        like(contacts.email, term),
      ) as SQL,
    );
  }
  if (filters.ownerUserId) {
    conditions.push(eq(contacts.ownerUserId, filters.ownerUserId));
  }
  if (filters.source) {
    conditions.push(eq(contacts.source, filters.source));
  }

  if (filters.tagId) {
    const tagged = await tenantDb(ctx).select(contactTags, eq(contactTags.tagId, filters.tagId));
    const contactIds = new Set(tagged.map((row) => row.contactId));
    if (contactIds.size === 0) return [];
    // No tenantDb "IN" helper — filter in memory over the (already
    // tenant-scoped) base query rather than reaching for raw SQL.
    const base = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = filterBySiteScope(
      ctx,
      await tenantDb(ctx).select(contacts, base),
      (row) => row.firstSiteId,
    );
    return rows
      .filter((row) => contactIds.has(row.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return tenantDb(ctx)
    .select(contacts, where)
    .then((rows) =>
      filterBySiteScope(ctx, rows, (row) => row.firstSiteId).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    );
}

export type CreateTagInput = { name: string; color?: string };

export async function createTag(ctx: TenantContext, input: CreateTagInput) {
  const id = newId();
  await tenantDb(ctx).insert(tags).values({ id, name: input.name, color: input.color });
  const [row] = await tenantDb(ctx).select(tags, eq(tags.id, id));
  return row ?? null;
}

export function listTags(ctx: TenantContext) {
  return tenantDb(ctx).select(tags).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
}

export async function listTagsForContact(ctx: TenantContext, contactId: string) {
  const links = await tenantDb(ctx).select(contactTags, eq(contactTags.contactId, contactId));
  if (links.length === 0) return [];
  const tagIds = new Set(links.map((l) => l.tagId));
  const allTags = await listTags(ctx);
  return allTags.filter((tag) => tagIds.has(tag.id));
}

export async function addTagToContact(ctx: TenantContext, contactId: string, tagId: string) {
  const existing = await tenantDb(ctx).select(
    contactTags,
    and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)),
  );
  if (existing.length > 0) return;

  await tenantDb(ctx).insert(contactTags).values({ id: newId(), contactId, tagId });
  await crmEvents.emit("tag.added", { tenantId: ctx.tenantId, contactId, tagId });
}

export async function removeTagFromContact(ctx: TenantContext, contactId: string, tagId: string) {
  await tenantDb(ctx).delete(
    contactTags,
    and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)),
  );
}
