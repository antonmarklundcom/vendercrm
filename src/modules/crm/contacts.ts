import { and, eq, like, or, type SQL } from "drizzle-orm";
import { contactTags, contacts, tags } from "@/db/schema";
import { newId } from "@/lib/ids";
import { normalizePhone, DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { crmEvents } from "./events";

// Contacts (PLAN.md §4 "crm", §5): phone (E.164) is the primary identity
// key, unique per tenant.

export { normalizePhone };

export type CreateContactInput = {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  source?: string;
  ownerUserId?: string;
  /** Custom field values, keyed by `custom_field_definitions.key`
   *  (PLAN.md §15.8 P5). */
  custom?: Record<string, string | number | null>;
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

export async function createContact(
  ctx: TenantContext,
  input: CreateContactInput,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
) {
  const id = newId();
  const phone = normalizePhone(input.phone, defaultCountry);

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
      custom: input.custom ?? {},
    });

  await crmEvents.emit("contact.created", { tenantId: ctx.tenantId, contactId: id });

  return getContact(ctx, id);
}

export async function updateContact(
  ctx: TenantContext,
  id: string,
  input: UpdateContactInput,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
) {
  const { custom, ...rest } = input;
  const values: Partial<typeof contacts.$inferInsert> = { ...rest };
  if (input.phone) values.phone = normalizePhone(input.phone, defaultCountry);

  // Merged, not replaced: a caller updating one custom field (the contact
  // edit form saves the whole custom object, but an importer might only
  // carry the columns its mapping covers) must not blank every other one
  // that already had a value — same rule updateContact already follows for
  // its plain fields via CSV import.
  if (custom) {
    const current = await getContact(ctx, id);
    values.custom = { ...((current?.custom as Record<string, unknown>) ?? {}), ...custom };
  }

  await tenantDb(ctx).update(contacts).set(values).where(eq(contacts.id, id));
  return getContact(ctx, id);
}

export async function getContact(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(contacts, eq(contacts.id, id));
  return row ?? null;
}

export async function getContactByPhone(
  ctx: TenantContext,
  phone: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
) {
  const [row] = await tenantDb(
    ctx,
  ).select(contacts, eq(contacts.phone, normalizePhone(phone, defaultCountry)));
  return row ?? null;
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
    const rows = await tenantDb(ctx).select(contacts, base);
    return rows
      .filter((row) => contactIds.has(row.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return tenantDb(ctx)
    .select(contacts, where)
    .then((rows) => rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
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
