import { createHmac, timingSafeEqual } from "node:crypto";

// Verify Meta's X-Hub-Signature-256 over the RAW request body (PLAN.md §6.3,
// rule 1). Must run on the exact bytes Meta signed — the route reads the body
// as text before any JSON parsing.
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
