// Pure payload building and retry policy — no Worker or postal-mime imports,
// so the app's test suite can exercise it (src/modules/mailbox/worker.test.ts).
// `InboundPayload` mirrors inboundPayloadSchema in the app's
// src/modules/mailbox/payload.ts — change both together.

export type Mailbox = { name: string; address: string };
export type ParsedAddress = Mailbox | { name: string; address?: undefined; group: Mailbox[] };

/** The subset of postal-mime's `Email` this Worker reads. */
export type ParsedEmail = {
  from?: ParsedAddress;
  replyTo?: ParsedAddress[];
  to?: ParsedAddress[];
  cc?: ParsedAddress[];
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  date?: string;
  html?: string;
  text?: string;
};

export type StoredAttachment = {
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string | null;
};

export type InboundPayload = {
  version: 1;
  envelopeTo: string;
  envelopeFrom: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  date: string | null;
  from: { address: string; name: string | null };
  to: Array<{ address: string; name: string | null }>;
  cc: Array<{ address: string; name: string | null }>;
  replyTo: Array<{ address: string; name: string | null }>;
  text: string | null;
  html: string | null;
  rawKey: string;
  rawSize: number;
  attachments: StoredAttachment[];
};

// Bodies are capped (the app enforces the same limits); the full message is
// always in R2 as raw.eml.
export const MAX_TEXT = 2_000_000;
export const MAX_HTML = 4_000_000;

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function flattenAddresses(list: ParsedAddress[] | undefined, limit = 100) {
  const out: Array<{ address: string; name: string | null }> = [];
  for (const entry of list ?? []) {
    const members = "group" in entry && entry.group ? entry.group : [entry as Mailbox];
    for (const member of members) {
      const address = member.address?.trim().toLowerCase();
      if (address && EMAIL.test(address) && address.length <= 320) {
        out.push({ address, name: member.name?.slice(0, 200) || null });
      }
    }
  }
  return out.slice(0, limit);
}

export function splitReferences(value: string | undefined): string[] {
  if (!value) return [];
  return (value.match(/<[^<>\s]+>/g) ?? value.split(/\s+/)).filter(Boolean).slice(0, 100);
}

export function buildPayload(input: {
  parsed: ParsedEmail;
  envelopeTo: string;
  envelopeFrom: string | null;
  rawKey: string;
  rawSize: number;
  /** Used when the message has no Message-ID header. */
  fallbackMessageId: string;
  attachments: StoredAttachment[];
}): InboundPayload {
  const { parsed } = input;
  const envelopeFrom = input.envelopeFrom?.trim().toLowerCase() || null;
  const from = flattenAddresses(parsed.from ? [parsed.from] : [])[0] ??
    (envelopeFrom && EMAIL.test(envelopeFrom)
      ? { address: envelopeFrom, name: null }
      : { address: "unknown@invalid.invalid", name: null });

  return {
    version: 1,
    envelopeTo: input.envelopeTo.trim().toLowerCase(),
    envelopeFrom,
    messageId: parsed.messageId?.trim() || input.fallbackMessageId,
    inReplyTo: parsed.inReplyTo?.trim() || null,
    references: splitReferences(parsed.references),
    subject: (parsed.subject ?? "").slice(0, 2000),
    date: parsed.date ?? null,
    from,
    to: flattenAddresses(parsed.to),
    cc: flattenAddresses(parsed.cc),
    replyTo: flattenAddresses(parsed.replyTo, 10),
    text: parsed.text ? parsed.text.slice(0, MAX_TEXT) : null,
    html: parsed.html ? parsed.html.slice(0, MAX_HTML) : null,
    rawKey: input.rawKey,
    rawSize: input.rawSize,
    attachments: input.attachments,
  };
}

/** What the Worker does with the app's answer. */
export type DeliveryOutcome = "done" | "discarded" | "retry" | "failed";

export function classifyResponse(status: number): DeliveryOutcome {
  if (status === 202) return "discarded";
  if (status >= 200 && status < 300) return "done";
  // A payload the app refuses as malformed will be refused again.
  if (status === 400 || status === 413 || status === 422) return "failed";
  // 401/404 are configuration (secret or env not set yet) and fixable; 5xx
  // and 429 are transient. Keep retrying.
  return "retry";
}

export const RETRY_GIVE_UP_MS = 72 * 3600 * 1000;

/** 5 min, 10, 20, … capped at 6 h. */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3600_000);
}

/** The compact event the app's /api/v1/email/events accepts. */
export type DeliveryEvent = {
  type: "bounced" | "complained";
  sender: string;
  recipient: string;
  subject: string | null;
  at: string | null;
};

/** The parts of a Cloudflare Email Sending event this Worker reads
 *  (Queues event subscription, eventSchemaVersion 1). */
export type CloudflareSendingEvent = {
  type?: string;
  payload?: { sender?: string; recipient?: string; subject?: string };
  metadata?: { eventTimestamp?: string };
};

/**
 * `cf.email.sending.message.bounced` → bounced (permanent, or temporary with
 * retries exhausted), `…message.complained` → complained. Every other event
 * (delivered, deferred, failed, rejected) is not a breaker signal → null.
 */
export function toDeliveryEvent(event: CloudflareSendingEvent): DeliveryEvent | null {
  const type = event.type?.endsWith(".message.bounced")
    ? "bounced"
    : event.type?.endsWith(".message.complained")
      ? "complained"
      : null;
  const sender = event.payload?.sender?.trim().toLowerCase();
  const recipient = event.payload?.recipient?.trim().toLowerCase();
  if (!type || !sender || !recipient || !EMAIL.test(sender) || !EMAIL.test(recipient)) return null;
  return {
    type,
    sender,
    recipient,
    subject: event.payload?.subject?.slice(0, 2000) ?? null,
    at: event.metadata?.eventTimestamp ?? null,
  };
}
