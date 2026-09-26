import { env } from "@/lib/config/env";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { isMailboxConfigured } from "@/modules/tenancy/mailbox";
import { domainOf } from "./headers";
import { ingestInboundEmail } from "./ingest";
import { resolveRecipient } from "./mailboxes";
import { pushInboundEmail } from "./notify";
import { inboundPayloadSchema } from "./payload";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyInboundSignature } from "./signature";

// The inbound webhook's decision table (PLAN-EMAIL.md E2), kept out of the
// route file so it can be tested with plain strings and headers.
//
//   404  mailbox not configured on this platform (EMAIL_INBOUND_SECRET etc.)
//   401  bad or stale signature
//   400  body is not the payload the Worker sends — retrying won't help
//   202  no active mailbox / business with the mailbox on — discarded
//   503  the business exists but is read-only right now — retry later
//   200  stored, or already stored (duplicate)
//
// Anything thrown bubbles up as 500 and the Worker retries. Bodies and the
// secret are never logged.

export type InboundResponse = { status: number; body: Record<string, unknown> };

export async function handleInboundEmail(
  rawBody: string,
  headers: Headers,
  nowSeconds?: number,
): Promise<InboundResponse> {
  const secret = env.EMAIL_INBOUND_SECRET;
  if (!secret || !isMailboxConfigured()) return { status: 404, body: { error: "not_found" } };

  const valid = verifyInboundSignature({
    secret,
    timestamp: headers.get(TIMESTAMP_HEADER),
    signature: headers.get(SIGNATURE_HEADER),
    body: rawBody,
    nowSeconds,
  });
  if (!valid) return { status: 401, body: { error: "invalid_signature" } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const parsed = inboundPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).slice(0, 5);
    console.warn("[email-inbound] payload rejected:", fields.join(", "));
    return { status: 400, body: { error: "invalid_payload", fields } };
  }
  const payload = parsed.data;

  const resolved = await resolveRecipient(payload.envelopeTo);
  if (!resolved) {
    console.info(`[email-inbound] discarded: no active mailbox for @${domainOf(payload.envelopeTo)}`);
    return { status: 202, body: { status: "discarded" } };
  }

  const ctx = await buildSystemTenantContext(resolved.tenantId);
  if (!ctx) return { status: 202, body: { status: "discarded" } };
  if (ctx.accessStatus !== "active") {
    return { status: 503, body: { error: "tenant_not_writable" } };
  }

  const result = await ingestInboundEmail(ctx, resolved.mailbox, payload);
  if (result.status === "stored") {
    await pushInboundEmail(ctx, {
      threadId: result.threadId,
      fromName: payload.from.name ?? null,
      fromAddress: payload.from.address,
      subject: payload.subject,
    });
  }
  return { status: 200, body: { status: result.status } };
}
