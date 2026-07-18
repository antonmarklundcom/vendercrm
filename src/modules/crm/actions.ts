"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { activities, contactTags, contacts, tags } from "@/db/schema/crm";
import { normalizePhonePY } from "@/lib/phone";
import { crmEvents } from "./events";

export async function createContact(input: {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  source?: string;
}): Promise<void> {
  const ctx = await getTenantContext();
  const scoped = tenantDb(ctx);

  const [inserted] = await scoped
    .insert(contacts, {
      name: input.name,
      phone: normalizePhonePY(input.phone),
      email: input.email || null,
      notes: input.notes || null,
      source: input.source || null,
      ownerUserId: ctx.userId,
    })
    .$returningId();

  await crmEvents.emit("contact.created", { tenantId: ctx.tenantId, contactId: inserted.id });

  revalidatePath("/contacts");
  redirect(`/contacts/${inserted.id}`);
}

export async function updateContact(
  id: string,
  input: { name: string; phone: string; email?: string; notes?: string },
): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).update(
    contacts,
    {
      name: input.name,
      phone: normalizePhonePY(input.phone),
      email: input.email || null,
      notes: input.notes || null,
    },
    eq(contacts.id, id),
  );

  revalidatePath(`/contacts/${id}`);
}

export async function addNote(contactId: string, body: string): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).insert(activities, {
    contactId,
    type: "note",
    userId: ctx.userId,
    payload: { body },
  });

  revalidatePath(`/contacts/${contactId}`);
}

export async function createTag(input: { name: string; color?: string }): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).insert(tags, {
    name: input.name,
    color: input.color || "#6b7280",
  });

  revalidatePath("/contacts");
}

export async function addContactTag(contactId: string, tagId: string): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).insert(contactTags, { contactId, tagId });
  await crmEvents.emit("tag.added", { tenantId: ctx.tenantId, contactId, tagId });

  revalidatePath(`/contacts/${contactId}`);
}

export async function removeContactTag(contactId: string, tagId: string): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).delete(
    contactTags,
    and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)),
  );

  revalidatePath(`/contacts/${contactId}`);
}
