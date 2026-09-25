import { eq } from "drizzle-orm";
import { emailMessages, emailThreads } from "@/db/schema";
import { newId } from "@/lib/ids";
import { mailboxProvider, type EmailProvider } from "@/lib/email/providers";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { isMailboxAvailable } from "@/modules/tenancy/mailbox";
import { getTenant } from "@/modules/tenancy/tenants";
import { replySubject } from "./headers";
import { getMailbox } from "./mailboxes";
import { getThread, listThreadMessages } from "./threads";

// Replying from the Inbox (PLAN-EMAIL.md E4). Always through the mailbox
// provider (Cloudflare), never through EMAIL_PROVIDER — the Inbox can run on
// Cloudflare while password resets stay on Resend.
//
// One-to-one by design (§1 business notes, E5): at most MAX_RECIPIENTS
// addresses per message counting To and Cc, no Bcc, no lists.
//
// Threading: Cloudflare generates the outgoing Message-ID itself and REST
// does not return it, so we store our own id (`<ulid>@out.vendercrm`, also
// sent as X-VenderCRM-Message-Id) and set In-Reply-To/References to the
// customer's message. Their answer carries those References back, which is
// what ingest matches on; the subject fallback covers clients that drop them.

export const MAX_RECIPIENTS = 5;
const MAX_BODY = 20_000;
const MAX_REFERENCES_LENGTH = 1_900; // Cloudflare caps a header value at 2,048 bytes

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export type ReplyError =
  | "not_found"
  | "unavailable"
  | "mailbox_inactive"
  | "suspended"
  | "empty"
  | "invalid_recipient"
  | "too_many_recipients"
  | "send_failed";

export type ReplyResult = { ok: true; emailMessageId: string } | { ok: false; error: ReplyError };

export type ReplyInput = { threadId: string; body: string; cc?: string[] };

/**
 * A hook E5 fills with the daily cap and warm-up; returns an error code to
 * refuse the send before anything is written.
 */
export type ReplyGuard = (ctx: TenantContext) => Promise<ReplyError | null>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text → minimal HTML: paragraphs on blank lines, <br> inside. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function referencesHeader(ids: string[]): string {
  const bracketed = ids.map((id) => `<${id}>`);
  // Keep the newest ids when the chain gets long; the first one matters to
  // some clients, so it stays when there's room.
  while (bracketed.join(" ").length > MAX_REFERENCES_LENGTH && bracketed.length > 2) {
    bracketed.splice(1, 1);
  }
  return bracketed.join(" ");
}

function quotedName(name: string): string {
  return `"${name.replace(/"/g, '\\"')}"`;
}

export async function sendThreadReply(
  ctx: TenantContext,
  input: ReplyInput,
  deps: { provider?: EmailProvider | null; guard?: ReplyGuard; now?: Date } = {},
): Promise<ReplyResult> {
  const provider = deps.provider === undefined ? mailboxProvider() : deps.provider;
  const now = deps.now ?? new Date();

  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) return { ok: false, error: "empty" };

  const thread = await getThread(ctx, input.threadId);
  if (!thread) return { ok: false, error: "not_found" };
  if (!provider || !(await isMailboxAvailable(ctx))) return { ok: false, error: "unavailable" };

  const tenant = await getTenant(ctx.tenantId);
  if (tenant?.outboundSuspendedAt) return { ok: false, error: "suspended" };

  const mailbox = await getMailbox(ctx, thread.mailboxId);
  if (!mailbox?.isActive) return { ok: false, error: "mailbox_inactive" };

  const messages = await listThreadMessages(ctx, thread.id);
  const lastInbound = [...messages].reverse().find((message) => message.direction === "in");
  const to = (lastInbound?.replyTo || lastInbound?.fromAddress || thread.participantEmail).toLowerCase();

  const cc = [...new Set((input.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))].filter(
    (address) => address !== to,
  );
  if (![to, ...cc].every((address) => ADDRESS.test(address) && address.length <= 320)) {
    return { ok: false, error: "invalid_recipient" };
  }
  if (1 + cc.length > MAX_RECIPIENTS) return { ok: false, error: "too_many_recipients" };

  const refused = deps.guard ? await deps.guard(ctx) : null;
  if (refused) return { ok: false, error: refused };

  const id = newId();
  const messageId = `${id.toLowerCase()}@out.vendercrm`;
  const subject = replySubject(lastInbound?.subject || thread.subject || "").slice(0, 500);
  const previousRefs = lastInbound?.references?.split(/\s+/).filter(Boolean) ?? [];
  const referenceIds = lastInbound ? [...previousRefs, lastInbound.messageId] : [];
  const html = textToHtml(body);
  const from = mailbox.displayName
    ? `${quotedName(mailbox.displayName)} <${mailbox.address}>`
    : mailbox.address;

  await tenantDb(ctx).insert(emailMessages).values({
    id,
    threadId: thread.id,
    mailboxId: mailbox.id,
    direction: "out",
    messageId,
    inReplyTo: lastInbound?.messageId ?? null,
    references: referenceIds.length ? referenceIds.join(" ") : null,
    fromAddress: mailbox.address,
    fromName: mailbox.displayName,
    to: [{ address: to }],
    cc: cc.map((address) => ({ address })),
    subject,
    textBody: body,
    htmlBody: html,
    status: "queued",
    sentByUserId: ctx.userId === "system" ? null : ctx.userId,
    sentAt: now,
  });

  let sent = false;
  try {
    const result = await provider.send({
      from,
      to,
      cc: cc.length ? cc : undefined,
      subject,
      html,
      text: body,
      headers: {
        ...(lastInbound ? { "In-Reply-To": `<${lastInbound.messageId}>` } : {}),
        ...(referenceIds.length ? { References: referencesHeader(referenceIds) } : {}),
        "X-VenderCRM-Message-Id": messageId,
      },
    });
    sent = result.ok;
  } catch (err) {
    console.error("[mailbox] reply send failed:", err instanceof Error ? err.message : "unknown");
  }

  await tenantDb(ctx)
    .update(emailMessages)
    .set({ status: sent ? "sent" : "failed" })
    .where(eq(emailMessages.id, id));
  if (sent) {
    await tenantDb(ctx)
      .update(emailThreads)
      .set({ lastMessageAt: now, unread: false, updatedAt: now })
      .where(eq(emailThreads.id, thread.id));
  }

  return sent ? { ok: true, emailMessageId: id } : { ok: false, error: "send_failed" };
}
