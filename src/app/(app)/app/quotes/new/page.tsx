import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listContacts } from "@/modules/crm/contacts";
import { listProducts } from "@/modules/quotes/products";
import { QuoteForm } from "./quote-form";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string }>;
}) {
  const { contactId } = await searchParams;
  const t = await getTranslations("app");
  const ctx = await requireTenantContext();
  const [contacts, products] = await Promise.all([
    listContacts(ctx),
    listProducts(ctx, true),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">{t("newQuote")}</h1>
      <QuoteForm
        contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
        products={products.map((p) => ({ id: p.id, name: p.name, unitPrice: p.unitPrice }))}
        defaultContactId={contactId}
      />
    </div>
  );
}
