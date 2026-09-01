import { getDocumentByPublicToken } from "@/modules/documents/documents";
import { generateDocumentPdf } from "@/modules/documents/delivery";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";

// Serves the nota de venta PDF at a public, unauthenticated URL (PLAN.md
// §10 1Q). This is the URL handed to Meta when sending the document over
// WhatsApp — Meta fetches the file itself, so it cannot require a session.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Rendering is on-demand and CPU/memory-bound, so this route is worth
  // protecting even though the token is unguessable. Generous limit — Meta
  // itself fetches this URL when delivering the WhatsApp document.
  const ip = clientIp(request.headers);
  if ((await checkRateLimit(`document-pdf:${ip}`, 30, 60_000)).limited) {
    return new Response("Too many requests", { status: 429 });
  }

  const resolved = await getDocumentByPublicToken(token);
  if (!resolved) return new Response("Not found", { status: 404 });

  // Rendered on demand rather than served from storage: the balance moves
  // as payments are recorded, and a stored copy would show a stale one.
  const pdf = await generateDocumentPdf(resolved.ctx, resolved.document.id);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${resolved.document.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
