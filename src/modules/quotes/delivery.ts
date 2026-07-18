import type { TenantContext } from "@/modules/tenancy/types";
import { getOrCreateConversationForContact } from "@/modules/whatsapp/conversations";
import { sendMessage } from "@/modules/whatsapp/send";
import { generateQuotePdf } from "./generate";
import { getQuote } from "./service";
import { QUOTES_MARK_SENT } from "./jobs";

// Sends the quote PDF as a WhatsApp document through the standard send
// service (PLAN.md §8). Generates the PDF first if it hasn't been rendered
// yet. The quote flips to `sent` (and gets its timeline entry) only once
// whatsapp/send.ts confirms delivery — see modules/quotes/jobs.ts.
export async function sendQuoteViaWhatsApp(
  ctx: TenantContext,
  quoteId: string,
): Promise<string> {
  const quote = await getQuote(ctx, quoteId);
  if (!quote) throw new Error("Presupuesto no encontrado");

  const storageKey = quote.pdfStorageKey ?? (await generateQuotePdf(ctx, quoteId));
  const conversationId = await getOrCreateConversationForContact(
    ctx,
    quote.contactId,
  );

  return sendMessage(ctx, {
    conversationId,
    kind: "document",
    storageKey,
    filename: `${quote.number}.pdf`,
    caption: `Presupuesto ${quote.number}`,
    onDelivered: { jobType: QUOTES_MARK_SENT, payload: { quoteId } },
  });
}
