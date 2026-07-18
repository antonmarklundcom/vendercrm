import { notFound } from "next/navigation";
import { getQuoteByPublicToken, listQuoteItems } from "@/modules/quotes/service";
import { getTenant } from "@/modules/tenancy/service";
import { getContact } from "@/modules/crm/contacts";
import { tenantContextFromJob } from "@/modules/tenancy/context";

function formatMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString("es-PY")} ${currency}`;
}

// Public read-only quote view — unauthenticated, reached via the quote's
// bearer token (PLAN.md §8). Fallback/preview alongside the WhatsApp send.
export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const quote = await getQuoteByPublicToken(token);
  if (!quote) notFound();

  const ctx = tenantContextFromJob({ tenantId: quote.tenantId });
  const [items, tenant, contact] = await Promise.all([
    listQuoteItems(ctx, quote.id),
    getTenant(quote.tenantId),
    getContact(ctx, quote.contactId),
  ]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm text-muted-foreground">{tenant?.name}</p>
        <h1 className="text-2xl font-semibold">Presupuesto {quote.number}</h1>
        <p className="text-sm text-muted-foreground">
          Para: {contact?.name ?? "—"}
        </p>
        {quote.validUntil && (
          <p className="text-sm text-muted-foreground">
            Válido hasta {quote.validUntil.toLocaleDateString("es-PY")}
          </p>
        )}
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Descripción</th>
              <th className="px-4 py-2 font-medium text-right">Cant.</th>
              <th className="px-4 py-2 font-medium text-right">Precio</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-2">{item.description}</td>
                <td className="px-4 py-2 text-right">{item.qty}</td>
                <td className="px-4 py-2 text-right">
                  {formatMoney(item.unitPrice, quote.currency)}
                </td>
                <td className="px-4 py-2 text-right">
                  {formatMoney(item.lineTotal, quote.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col items-end gap-1 text-sm">
        <div>Subtotal: {formatMoney(quote.subtotal, quote.currency)}</div>
        {quote.discount > 0 && (
          <div>Descuento: -{formatMoney(quote.discount, quote.currency)}</div>
        )}
        <div className="text-lg font-semibold">
          Total: {formatMoney(quote.total, quote.currency)}
        </div>
      </div>

      {quote.notes && (
        <div>
          <p className="text-xs text-muted-foreground">Notas</p>
          <p className="text-sm">{quote.notes}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Documento no fiscal — presupuesto sin valor de factura.
      </p>
    </div>
  );
}
