import { getReceiptByPublicToken, generateReceiptPdf } from "@/modules/documents/receipts";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";

// Serves the receipt PDF at a public, unauthenticated URL (PLAN.md §15.2),
// the same shape as the quote and nota de venta PDF routes — including the
// WhatsApp document-send URL a rep's "enviar por WhatsApp" points at.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = clientIp(request.headers);
  if ((await checkRateLimit(`receipt-pdf:${ip}`, 30, 60_000)).limited) {
    return new Response("Too many requests", { status: 429 });
  }

  const resolved = await getReceiptByPublicToken(token);
  if (!resolved) return new Response("Not found", { status: 404 });

  const pdf = await generateReceiptPdf(resolved.ctx, resolved.payment.id);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${resolved.payment.receiptNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
