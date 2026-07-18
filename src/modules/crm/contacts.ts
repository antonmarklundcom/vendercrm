import { and, desc, eq, like, or, type SQL } from "drizzle-orm";
import { contacts, tags, contactTags } from "@/db/schema";
import { newId } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { emit } from "@/lib/events";

export type ContactInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  source?: string | null;
  ownerUserId?: string | null;
};

export async function createContact(
  ctx: TenantContext,
  input: ContactInput,
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(contacts, {
    id,
    name: input.name,
    phone: input.phone ? normalizePhone(input.phone) : null,
    email: input.email?.toLowerCase() ?? null,
    notes: input.notes ?? null,
    source: input.source ?? null,
    ownerUserId: input.ownerUserId ?? null,
  });
  await emit("contact.created", { tenantId: ctx.tenantId, contactId: id });
  return id;
}

// Upsert by phone (primary identity) then email — used by form submissions and
// inbound WhatsApp (1D). Returns the contact id, creating one if none matches.
export async function upsertContactByPhoneOrEmail(
  ctx: TenantContext,
  input: ContactInput,
): Promise<{ contactId: string; created: boolean }> {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email?.toLowerCase() ?? null;
  const tdb = tenantDb(ctx);

  const match: SQL | undefined = phone
    ? eq(contacts.phone, phone)
    : email
      ? eq(contacts.email, email)
      : undefined;

  if (match) {
    const [existing] = await tdb.select(contacts, match);
    if (existing) return { contactId: existing.id, created: false };
  }

  const contactId = await createContact(ctx, { ...input, phone, email });
  return { contactId, created: true };
}

export async function getContact(ctx: TenantContext, contactId: string) {
  const [row] = await tenantDb(ctx).select(contacts, eq(contacts.id, contactId));
  return row ?? null;
}

export async function listContacts(
  ctx: TenantContext,
  filter?: { search?: string; ownerUserId?: string; source?: string },
) {
  const conds: SQL[] = [];
  if (filter?.search) {
    const q = `%${filter.search}%`;
    const searchCond = or(
      like(contacts.name, q),
      like(contacts.phone, q),
      like(contacts.email, q),
    );
    if (searchCond) conds.push(searchCond);
  }
  if (filter?.ownerUserId) conds.push(eq(contacts.ownerUserId, filter.ownerUserId));
  if (filter?.source) conds.push(eq(contacts.source, filter.source));

  return tenantDb(ctx)
    .select(contacts, conds.length ? and(...conds) : undefined)
    .orderBy(desc(contacts.createdAt));
}

export async function updateContact(
  ctx: TenantContext,
  contactId: string,
  input: Partial<ContactInput>,
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.phone !== undefined)
    set.phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.email !== undefined) set.email = input.email?.toLowerCase() ?? null;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.source !== undefined) set.source = input.source;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  await tenantDb(ctx).update(contacts, set, eq(contacts.id, contactId));
}

// --- Tags --------------------------------------------------------------------

export async function listTags(ctx: TenantContext) {
  return tenantDb(ctx).select(tags);
}

export async function createTag(
  ctx: TenantContext,
  input: { name: string; color?: string },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(tags, { id, name: input.name, color: input.color });
  return id;
}

// Idempotent: adding a tag a contact already has is a no-op (unique constraint).
export async function addTagToContact(
  ctx: TenantContext,
  contactId: string,
  tagId: string,
): Promise<void> {
  const tdb = tenantDb(ctx);
  const [existing] = await tdb.select(
    contactTags,
    and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)),
  );
  if (existing) return;
  await tdb.insert(contactTags, { id: newId(), contactId, tagId });
  await emit("tag.added", { tenantId: ctx.tenantId, contactId, tagId });
}

export async function removeTagFromContact(
  ctx: TenantContext,
  contactId: string,
  tagId: string,
): Promise<void> {
  await tenantDb(ctx).delete(
    contactTags,
    and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)),
  );
}

export async function listContactTags(ctx: TenantContext, contactId: string) {
  const tdb = tenantDb(ctx);
  const links = await tdb.select(contactTags, eq(contactTags.contactId, contactId));
  if (links.length === 0) return [];
  const allTags = await tdb.select(tags);
  const tagIds = new Set(links.map((l) => l.tagId));
  return allTags.filter((t) => tagIds.has(t.id));
}
