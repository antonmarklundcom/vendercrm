import { and, eq, inArray, like, or } from "drizzle-orm";
import { tenantDb } from "@/modules/tenancy/db";
import { activities, contactTags, contacts, tags } from "@/db/schema/crm";
import type { TenantContext } from "@/modules/tenancy/context";

export type ContactFilters = {
  search?: string;
  tagId?: string;
  ownerUserId?: string;
};

export async function listContacts(ctx: TenantContext, filters: ContactFilters = {}) {
  const scoped = tenantDb(ctx);

  let allowedIds: string[] | null = null;
  if (filters.tagId) {
    const rows = await scoped.findMany(contactTags, eq(contactTags.tagId, filters.tagId));
    allowedIds = rows.map((r) => r.contactId);
    if (allowedIds.length === 0) return [];
  }

  const conditions = [
    filters.ownerUserId ? eq(contacts.ownerUserId, filters.ownerUserId) : undefined,
    filters.search
      ? or(
          like(contacts.name, `%${filters.search}%`),
          like(contacts.phone, `%${filters.search}%`),
          like(contacts.email, `%${filters.search}%`),
        )
      : undefined,
    allowedIds ? inArray(contacts.id, allowedIds) : undefined,
  ].filter((c) => c !== undefined);

  return scoped.findMany(contacts, conditions.length ? and(...conditions) : undefined);
}

export async function getContactById(ctx: TenantContext, id: string) {
  return tenantDb(ctx).findFirst(contacts, eq(contacts.id, id));
}

export async function getContactTags(ctx: TenantContext, contactId: string) {
  const links = await tenantDb(ctx).findMany(contactTags, eq(contactTags.contactId, contactId));
  if (links.length === 0) return [];

  return tenantDb(ctx).findMany(
    tags,
    inArray(
      tags.id,
      links.map((l) => l.tagId),
    ),
  );
}

export async function listTags(ctx: TenantContext) {
  return tenantDb(ctx).findMany(tags);
}

export async function getContactActivities(ctx: TenantContext, contactId: string) {
  const rows = await tenantDb(ctx).findMany(activities, eq(activities.contactId, contactId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
