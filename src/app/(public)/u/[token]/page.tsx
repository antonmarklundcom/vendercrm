import { notFound } from "next/navigation";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { getContact } from "@/modules/crm/contacts";
import { getTranslator } from "@/lib/i18n/translator";
import { confirmUnsubscribeAction } from "./actions";

// Unsubscribe from automated email (PLAN.md §15.1, §15.8 P4). Loading the
// page only reads: the opt-out itself is the button's POST (./actions.ts).
// It used to write on GET, which let a mail client's link prefetcher
// unsubscribe a contact who never clicked anything.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ listo?: string }>;
}) {
  const { token } = await params;
  const { listo } = await searchParams;
  const resolved = verifyUnsubscribeToken(token);
  if (!resolved) notFound();

  const ctx = await buildSystemTenantContext(resolved.tenantId);
  if (!ctx) notFound();

  const contact = await getContact(ctx, resolved.contactId);
  if (!contact) notFound();

  const tenant = await getTenant(resolved.tenantId);
  const t = await getTranslator(tenant?.locale ?? "es", "public.unsubscribe");

  if (listo === "1") {
    return (
      <main className="mx-auto max-w-md p-6 text-center text-sm">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("body", { name: contact.name })}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6 text-center text-sm">
      <h1 className="text-lg font-semibold">{t("confirmTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t("confirmBody", { name: contact.name })}</p>
      <form action={confirmUnsubscribeAction.bind(null, token)} className="mt-4">
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          {t("confirmButton")}
        </button>
      </form>
    </main>
  );
}
