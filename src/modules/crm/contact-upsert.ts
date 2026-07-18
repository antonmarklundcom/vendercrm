import { eq } from "drizzle-orm";
import { tenantDb } from "@/modules/tenancy/db";
import { contacts } from "@/db/schema/crm";
import type { TenantContext } from "@/modules/tenancy/context";

/** Finds a contact by (normalized) phone, or creates one. */
export async function upsertContactByPhone(
  ctx: TenantContext,
  input: { phone: string; name: string; source?: string },
) {
  const scoped = tenantDb(ctx);

  const existing = await scoped.findFirst(contacts, eq(contacts.phone, input.phone));
  if (existing) return existing;

  const [inserted] = await scoped
    .insert(contacts, {
      name: input.name,
      phone: input.phone,
      source: input.source ?? null,
    })
    .$returningId();

  const created = await scoped.findFirst(contacts, eq(contacts.id, inserted.id));
  if (!created) throw new Error("Failed to load newly created contact");

  return created;
}
