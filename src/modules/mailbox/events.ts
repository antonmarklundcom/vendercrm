import { z } from "zod";
import { env } from "@/lib/config/env";
import { isMailboxConfigured } from "@/modules/tenancy/mailbox";
import { recordDeliveryEvent } from "./breaker";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyInboundSignature } from "./signature";
import type { InboundResponse } from "./inbound";

// Delivery events from the Worker's queue consumer (PLAN-EMAIL.md E5):
// Cloudflare Email Sending's message.bounced / message.complained, reduced
// to the fields the breaker needs (workers/email-inbound/src/payload.ts,
// toDeliveryEvent). Same HMAC and same 404-when-off rule as the inbound
// webhook. 200 means "processed" whether or not each event matched a send —
// an unmatched event is not something a retry fixes.

const eventsSchema = z.object({
  version: z.literal(1),
  events: z
    .array(
      z.object({
        type: z.enum(["bounced", "complained"]),
        sender: z.string().trim().toLowerCase().email().max(320),
        recipient: z.string().trim().toLowerCase().email().max(320),
        subject: z.string().max(2000).optional().nullable(),
        at: z.string().max(100).optional().nullable(),
      }),
    )
    .max(100),
});

export async function handleDeliveryEvents(
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
  const parsed = eventsSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "invalid_payload" } };

  let matched = 0;
  for (const event of parsed.data.events) {
    if ((await recordDeliveryEvent(event)) === "matched") matched += 1;
  }
  return { status: 200, body: { processed: parsed.data.events.length, matched } };
}
