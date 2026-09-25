import { eq } from "drizzle-orm";
import { emailAttachments, emailMessages, emailThreads } from "@/db/schema";
import { newId } from "@/lib/ids";
import { storage } from "@/lib/storage";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantTransaction } from "@/modules/tenancy/db";
import { normalizeMessageId, normalizeSubject, parseMessageIdList } from "./headers";
import type { MailboxRow } from "./mailboxes";
import type { InboundPayload } from "./payload";
import { sanitizeEmailHtml } from "./sanitize";
import {
  findContactByEmail,
  findMessageByMessageId,
  findRecentThread,
  findThreadByMessageIds,
} from "./threads";

// Storing one inbound email (PLAN-EMAIL.md E2/E3). Called by the webhook
// route once the signature is verified and the recipient resolved to a
// tenant. Idempotent on Message-ID: the Worker retries until it gets a 2xx,
// so the same message can arrive more than once.
//
// Files: the Worker put the raw .eml and each attachment in the shared R2
// bucket under `email-inbound/…` without knowing the tenant. They are copied
// to `email/<tenantId>/<emailMessageId>/…` — the `<kind>/<tenantId>/` layout
// tenant purge sweeps (modules/tenancy/purge.ts) — and the originals deleted.

export type IngestResult =
  | { status: "stored"; emailMessageId: string; threadId: string; contactId: string | null }
  | { status: "duplicate"; emailMessageId: string; threadId: string };

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 120);
  return cleaned || "adjunto";
}

function parseDate(value: string | null | undefined, now: Date): Date {
  if (!value) return now;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return now;
  // A sender's clock a day in the future would pin the thread to the top.
  if (parsed.getTime() > now.getTime() + 86_400_000) return now;
  return parsed;
}

async function removeOriginals(payload: InboundPayload) {
  const keys = [payload.rawKey, ...payload.attachments.map((a) => a.key)];
  await Promise.all(keys.map((key) => storage.delete(key).catch(() => {})));
}

function isDuplicateEntry(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === "ER_DUP_ENTRY";
}

export async function ingestInboundEmail(
  ctx: TenantContext,
  mailbox: MailboxRow,
  payload: InboundPayload,
  now: Date = new Date(),
): Promise<IngestResult> {
  const messageId = normalizeMessageId(payload.messageId)!;

  const existing = await findMessageByMessageId(ctx, messageId);
  if (existing) {
    await removeOriginals(payload);
    return { status: "duplicate", emailMessageId: existing.id, threadId: existing.threadId };
  }

  const id = newId();
  const prefix = `email/${ctx.tenantId}/${id}`;

  // Copy first: a storage failure throws before anything is written, the
  // route answers 5xx, and the Worker retries with the originals intact.
  const rawKey = `${prefix}/raw.eml`;
  await storage.put(rawKey, await storage.get(payload.rawKey), "message/rfc822");
  const attachments: Array<InboundPayload["attachments"][number] & { storageKey: string }> = [];
  for (const [index, attachment] of payload.attachments.entries()) {
    const key = `${prefix}/${index}-${safeFilename(attachment.filename)}`;
    await storage.put(key, await storage.get(attachment.key), attachment.mimeType);
    attachments.push({ ...attachment, storageKey: key });
  }

  const fromAddress = payload.from.address;
  const subject = payload.subject.slice(0, 500);
  const normalized = normalizeSubject(payload.subject);
  const inReplyTo = normalizeMessageId(payload.inReplyTo);
  const references = parseMessageIdList(payload.references);
  const sentAt = parseDate(payload.date, now);

  const thread =
    (await findThreadByMessageIds(ctx, [...(inReplyTo ? [inReplyTo] : []), ...references])) ??
    (await findRecentThread(ctx, {
      mailboxId: mailbox.id,
      participantEmail: fromAddress,
      normalizedSubject: normalized,
      now,
    }));

  const contact = thread?.contactId ? null : await findContactByEmail(ctx, fromAddress);
  const threadId = thread?.id ?? newId();

  try {
    await tenantTransaction(ctx, async (tx) => {
      if (thread) {
        await tx
          .update(emailThreads)
          .set({
            unread: true,
            status: "open",
            lastMessageAt: sentAt > thread.lastMessageAt ? sentAt : thread.lastMessageAt,
            ...(contact ? { contactId: contact.id } : {}),
            updatedAt: now,
          })
          .where(eq(emailThreads.id, thread.id));
      } else {
        await tx.insert(emailThreads).values({
          id: threadId,
          mailboxId: mailbox.id,
          subject,
          normalizedSubject: normalized,
          participantEmail: fromAddress,
          participantName: payload.from.name?.slice(0, 200) || null,
          contactId: contact?.id ?? null,
          status: "open",
          unread: true,
          lastMessageAt: sentAt,
        });
      }

      await tx.insert(emailMessages).values({
        id,
        threadId,
        mailboxId: mailbox.id,
        direction: "in",
        messageId,
        inReplyTo,
        references: references.length ? references.join(" ") : null,
        fromAddress,
        fromName: payload.from.name?.slice(0, 200) || null,
        replyTo: payload.replyTo[0]?.address ?? null,
        to: payload.to,
        cc: payload.cc,
        subject,
        textBody: payload.text ?? null,
        htmlBody: payload.html ? sanitizeEmailHtml(payload.html) : null,
        rawKey,
        status: "received",
        sentAt,
      });

      for (const attachment of attachments) {
        await tx.insert(emailAttachments).values({
          id: newId(),
          emailMessageId: id,
          storageKey: attachment.storageKey,
          filename: attachment.filename.slice(0, 255) || "adjunto",
          mimeType: attachment.mimeType,
          size: attachment.size,
          contentId: normalizeMessageId(attachment.contentId),
        });
      }
    });
  } catch (err) {
    // Two deliveries of the same message racing each other: the loser's
    // copies go, the winner's row stands.
    if (!isDuplicateEntry(err)) throw err;
    await storage.deletePrefix(`${prefix}/`).catch(() => {});
    const winner = await findMessageByMessageId(ctx, messageId);
    await removeOriginals(payload);
    return { status: "duplicate", emailMessageId: winner?.id ?? id, threadId: winner?.threadId ?? threadId };
  }

  await removeOriginals(payload);
  return {
    status: "stored",
    emailMessageId: id,
    threadId,
    contactId: contact?.id ?? thread?.contactId ?? null,
  };
}
