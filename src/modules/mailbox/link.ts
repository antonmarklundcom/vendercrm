import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import type { TenantContext } from "@/modules/tenancy/context";
import { createContact, getContactByPhone, updateContact } from "@/modules/crm/contacts";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import { getThread, linkThread } from "./threads";

// "Crear contacto" from an email thread (PLAN-EMAIL.md E4). Ingest only links
// senders that already exist (a contact needs a phone, an email has none), so
// the person reading the thread supplies the phone. If that phone already
// belongs to a contact, the thread links to them instead of failing on the
// unique (tenant, phone) index — and their email is filled in if empty.

export async function createContactFromThread(
  ctx: TenantContext,
  threadId: string,
  input: { name: string; phone: string },
): Promise<{ contactId: string } | { error: "not_found" | "invalid" }> {
  const thread = await getThread(ctx, threadId);
  if (!thread) return { error: "not_found" };
  const name = input.name.trim() || thread.participantName || thread.participantEmail;
  if (input.phone.replace(/\D/g, "").length < 6) return { error: "invalid" };

  const settings = ((await getTenant(ctx.tenantId))?.settings ?? {}) as TenantSettings;
  const country = settings.defaultCountry ?? DEFAULT_COUNTRY;

  const existing = await getContactByPhone(ctx, input.phone, country);
  let contactId: string;
  if (existing) {
    contactId = existing.id;
    if (!existing.email) await updateContact(ctx, existing.id, { email: thread.participantEmail }, country);
  } else {
    const created = await createContact(
      ctx,
      { name, phone: input.phone, email: thread.participantEmail, source: "email" },
      country,
    );
    contactId = created!.id;
  }

  await linkThread(ctx, threadId, { contactId });
  return { contactId };
}
