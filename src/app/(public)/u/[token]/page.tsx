import { notFound } from "next/navigation";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { getContact, listTags, createTag, addTagToContact } from "@/modules/crm/contacts";
import { OPTOUT_TAG } from "@/modules/automations/actions";
import { getTranslator } from "@/lib/i18n/translator";

// Unsubscribe from automated email (PLAN.md §15.1, §15.8 P4). Sets the same
// `optout` tag the WhatsApp BAJA/STOP keyword sets
// (modules/automations/triggers.ts's maybeOptOut) — one flag, both channels.
// No session, no confirmation step beyond loading the page: this is exactly
// the one-click unsubscribe every mailbox provider expects.
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = verifyUnsubscribeToken(token);
  if (!resolved) notFound();

  const ctx = await buildSystemTenantContext(resolved.tenantId);
  if (!ctx) notFound();

  const contact = await getContact(ctx, resolved.contactId);
  if (!contact) notFound();

  const tags = await listTags(ctx);
  const existing = tags.find((tag) => tag.name.toLowerCase() === OPTOUT_TAG);
  const tag = existing ?? (await createTag(ctx, { name: OPTOUT_TAG }));
  if (tag) await addTagToContact(ctx, contact.id, tag.id);

  const tenant = await getTenant(resolved.tenantId);
  const t = await getTranslator(tenant?.locale ?? "es", "public.unsubscribe");

  return (
    <main className="mx-auto max-w-md p-6 text-center text-sm">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("body", { name: contact.name })}</p>
    </main>
  );
}
