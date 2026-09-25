import { z } from "zod";

// The JSON body the email-inbound Worker POSTs (PLAN-EMAIL.md E2). The Worker
// has already stored the raw .eml and each attachment in R2 under
// `email-inbound/…`; this carries the parsed headers and bodies plus those
// keys. Mirrors `InboundPayload` in workers/email-inbound/src/types.ts —
// change both together.

export const INBOUND_KEY_PREFIX = "email-inbound/";

const address = z.object({
  address: z.string().trim().toLowerCase().email().max(320),
  name: z.string().max(200).optional().nullable(),
});

const storageKey = z
  .string()
  .max(500)
  .refine((key) => key.startsWith(INBOUND_KEY_PREFIX) && !key.includes(".."), "bad_key");

export const inboundPayloadSchema = z.object({
  version: z.literal(1),
  /** SMTP envelope recipient — the routing key. */
  envelopeTo: z.string().trim().toLowerCase().email().max(320),
  envelopeFrom: z.string().max(320).optional().nullable(),
  messageId: z.string().min(1).max(998),
  inReplyTo: z.string().max(998).optional().nullable(),
  references: z.array(z.string().max(998)).max(100).default([]),
  subject: z.string().max(2000).default(""),
  date: z.string().max(100).optional().nullable(),
  from: address,
  to: z.array(address).max(100).default([]),
  cc: z.array(address).max(100).default([]),
  replyTo: z.array(address).max(10).default([]),
  text: z.string().max(2_000_000).optional().nullable(),
  html: z.string().max(4_000_000).optional().nullable(),
  rawKey: storageKey,
  rawSize: z.number().int().nonnegative(),
  attachments: z
    .array(
      z.object({
        key: storageKey,
        filename: z.string().max(255),
        mimeType: z.string().max(150),
        size: z.number().int().nonnegative(),
        contentId: z.string().max(255).optional().nullable(),
      }),
    )
    .max(100)
    .default([]),
});

export type InboundPayload = z.infer<typeof inboundPayloadSchema>;
