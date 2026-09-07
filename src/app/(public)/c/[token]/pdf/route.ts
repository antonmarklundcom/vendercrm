import { generateContractPdf, getContractByPublicToken } from "@/modules/contracts/contracts";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";

// Serves the contract PDF at a public, unauthenticated URL — the same shape
// as the quote/document/receipt PDF routes, including the WhatsApp
// document-send URL "enviar por WhatsApp" points at (PLAN.md §17.3 P13).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = clientIp(request.headers);
  if ((await checkRateLimit(`contract-pdf:${ip}`, 30, 60_000)).limited) {
    return new Response("Too many requests", { status: 429 });
  }

  const resolved = await getContractByPublicToken(token);
  if (!resolved) return new Response("Not found", { status: 404 });

  const pdf = await generateContractPdf(resolved.ctx, resolved.contract.id);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${resolved.contract.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
