import PostalMime from "postal-mime";
import {
  buildPayload,
  classifyResponse,
  toDeliveryEvent,
  type CloudflareSendingEvent,
  nextAttemptDelayMs,
  RETRY_GIVE_UP_MS,
  type InboundPayload,
  type StoredAttachment,
} from "./payload";
import { sha256Hex, signInbound, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./sign";

// Cloudflare Email Worker for VenderCRM mailboxes (PLAN-EMAIL.md E2).
//
//   Email Routing (catch-all → this Worker)
//     → raw .eml + attachments to R2 under email-inbound/<date>/<uuid>/
//     → parsed JSON POSTed to VenderCRM /api/v1/email/inbound, HMAC-signed
//     → the app copies the files under its tenant and deletes these
//
// Mail is never dropped once it is in R2: if the POST fails, a marker goes to
// email-inbound-pending/ and the cron trigger retries with backoff for 72 h,
// after which the marker moves to email-inbound-failed/ and the raw mail
// stays in the bucket for a human. Nothing here logs bodies or the secret.

export interface Env {
  MAIL_BUCKET: R2Bucket;
  /** e.g. https://crm.example.com/api/v1/email/inbound */
  INBOUND_URL: string;
  /** e.g. https://crm.example.com/api/v1/email/events */
  EVENTS_URL: string;
  EMAIL_INBOUND_SECRET: string;
}

type PendingMarker = { base: string; attempts: number; firstAt: number; nextAt: number };

const PENDING = "email-inbound-pending/";
const FAILED = "email-inbound-failed/";

async function post(env: Env, payload: unknown, url: string = env.INBOUND_URL): Promise<number> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signInbound(env.EMAIL_INBOUND_SECRET, timestamp, body);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: signature,
      },
      body,
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function removeBase(env: Env, base: string) {
  const listed = await env.MAIL_BUCKET.list({ prefix: `${base}/` });
  await Promise.all(listed.objects.map((object) => env.MAIL_BUCKET.delete(object.key)));
}

/** One delivery attempt for a stored message; returns what happened. */
async function deliver(env: Env, base: string) {
  const stored = await env.MAIL_BUCKET.get(`${base}/payload.json`);
  if (!stored) return "done" as const; // already delivered and cleaned up
  const payload = (await stored.json()) as InboundPayload;
  const status = await post(env, payload);
  const outcome = classifyResponse(status);
  if (outcome === "done") await env.MAIL_BUCKET.delete(`${base}/payload.json`);
  if (outcome === "discarded") await removeBase(env, base);
  if (outcome !== "done" && outcome !== "discarded") {
    console.warn(`email-inbound: delivery ${outcome} (HTTP ${status}) for ${base}`);
  }
  return outcome;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const raw = await new Response(message.raw).arrayBuffer();
    const id = crypto.randomUUID();
    const base = `email-inbound/${new Date().toISOString().slice(0, 10)}/${id}`;

    // Until this put succeeds an exception is the right answer: the sending
    // server gets a temporary failure and tries again later.
    const rawKey = `${base}/raw.eml`;
    await env.MAIL_BUCKET.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });

    try {
      const parsed = await PostalMime.parse(raw);
      const attachments: StoredAttachment[] = [];
      for (const [index, attachment] of parsed.attachments.entries()) {
        const key = `${base}/att-${index}`;
        const content =
          typeof attachment.content === "string"
            ? new TextEncoder().encode(attachment.content)
            : attachment.content;
        await env.MAIL_BUCKET.put(key, content, {
          httpMetadata: { contentType: attachment.mimeType },
        });
        attachments.push({
          key,
          filename: attachment.filename || `adjunto-${index + 1}`,
          mimeType: attachment.mimeType || "application/octet-stream",
          size: content.byteLength,
          contentId: attachment.contentId ?? null,
        });
      }

      const payload = buildPayload({
        parsed,
        envelopeTo: message.to,
        envelopeFrom: message.from,
        rawKey,
        rawSize: raw.byteLength,
        fallbackMessageId: `${await sha256Hex(raw)}@vendercrm.generated`,
        attachments,
      });
      await env.MAIL_BUCKET.put(`${base}/payload.json`, JSON.stringify(payload));

      const outcome = await deliver(env, base);
      if (outcome === "retry") await schedule(env, base, 1, Date.now());
      if (outcome === "failed") await env.MAIL_BUCKET.put(`${FAILED}${id}`, base);
    } catch (err) {
      // Parsing or storage trouble after the raw mail is safe: queue it.
      console.error("email-inbound: processing failed, queued for retry", String(err));
      ctx.waitUntil(schedule(env, base, 1, Date.now()));
    }
  },

  // Email Sending events (PLAN-EMAIL.md E5): the queue the account's event
  // subscription publishes to. Bounces and complaints go to the app's
  // breaker; everything else is acknowledged and dropped. A failed POST
  // retries the whole batch (the app is idempotent per send).
  async queue(batch: MessageBatch<CloudflareSendingEvent>, env: Env) {
    const events = batch.messages
      .map((message) => toDeliveryEvent(message.body))
      .filter((event): event is NonNullable<typeof event> => event !== null);
    if (events.length > 0) {
      const status = await post(env, { version: 1, events }, env.EVENTS_URL);
      if (classifyResponse(status) === "retry") {
        batch.retryAll();
        return;
      }
    }
    batch.ackAll();
  },

  async scheduled(_event: ScheduledController, env: Env) {
    const listed = await env.MAIL_BUCKET.list({ prefix: PENDING, limit: 200 });
    const now = Date.now();
    for (const object of listed.objects) {
      const markerObject = await env.MAIL_BUCKET.get(object.key);
      if (!markerObject) continue;
      const marker = (await markerObject.json()) as PendingMarker;
      if (marker.nextAt > now) continue;

      const outcome = await deliver(env, marker.base);
      if (outcome === "done" || outcome === "discarded") {
        await env.MAIL_BUCKET.delete(object.key);
      } else if (outcome === "failed" || now - marker.firstAt > RETRY_GIVE_UP_MS) {
        await env.MAIL_BUCKET.put(`${FAILED}${object.key.slice(PENDING.length)}`, marker.base);
        await env.MAIL_BUCKET.delete(object.key);
      } else {
        await schedule(env, marker.base, marker.attempts + 1, marker.firstAt, object.key);
      }
    }
  },
} satisfies ExportedHandler<Env, CloudflareSendingEvent>;

async function schedule(env: Env, base: string, attempts: number, firstAt: number, key?: string) {
  const marker: PendingMarker = {
    base,
    attempts,
    firstAt,
    nextAt: Date.now() + nextAttemptDelayMs(attempts),
  };
  await env.MAIL_BUCKET.put(key ?? `${PENDING}${base.split("/").pop()}`, JSON.stringify(marker));
}
