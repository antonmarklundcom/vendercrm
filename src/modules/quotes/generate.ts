import type { TenantContext } from "@/modules/tenancy/types";
import { getTenant, type TenantSettings } from "@/modules/tenancy/service";
import { getContact } from "@/modules/crm/contacts";
import { storage } from "@/lib/storage";
import { getQuote, listQuoteItems, setQuotePdfKey } from "./service";
import { renderQuotePdf } from "./pdf";

// Renders the quote PDF and persists it via the storage adapter, recording the
// key on the quote row (PLAN.md §8). Idempotent — re-running overwrites the
// same key.
export async function generateQuotePdf(
  ctx: TenantContext,
  quoteId: string,
): Promise<string> {
  const quote = await getQuote(ctx, quoteId);
  if (!quote) throw new Error("Presupuesto no encontrado");

  const [items, tenant, contact] = await Promise.all([
    listQuoteItems(ctx, quoteId),
    getTenant(ctx.tenantId),
    getContact(ctx, quote.contactId),
  ]);
  if (!tenant) throw new Error("Empresa no encontrada");
  if (!contact) throw new Error("Contacto no encontrado");

  const settings = (tenant.settings as TenantSettings | null) ?? {};
  const buffer = await renderQuotePdf({
    quote,
    items,
    tenantName: tenant.name,
    brandColor: settings.brandColor,
    contactName: contact.name,
  });

  const key = `${ctx.tenantId}/quotes/${quote.number}.pdf`;
  await storage.put(key, buffer, "application/pdf");
  await setQuotePdfKey(ctx, quoteId, key);
  return key;
}
