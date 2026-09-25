import { and, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { emailMessages } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/config/env";
import { reportError } from "@/lib/observability";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import {
  lastSuspensionClearedAt,
  listSuperadminEmails,
  suspendOutbound,
} from "@/modules/tenancy/mailbox";
import { getTenant } from "@/modules/tenancy/tenants";
import { listTenantUsers } from "@/modules/tenancy/users";
import { createNotification } from "@/modules/notifications/notifications";
import { findMailboxByAddress } from "./mailboxes";

// Bounce / complaint circuit breaker (PLAN-EMAIL.md E5). Suppression lists
// and abuse enforcement are per Cloudflare *account*, so one business
// sending to bad addresses can get sending suspended for all of them. The
// breaker stops that business first:
//
//   more than 3 % of its last 50 mailbox sends bounced  (i.e. 2 or more)
//   or 2 or more of its last 50 sends drew a spam complaint
//
// → `tenants.outbound_suspended_at` is set (replies refused in reply.ts),
// superadmins get an email, the business's admins a notification. Clearing
// it is the "Quitar suspensión" button on the superadmin tenant page.
//
// Signals: a synchronous `permanent_bounces` answer from the send itself
// (reply.ts), and Cloudflare's Email Sending events (message.bounced /
// message.complained) relayed by the Worker to /api/v1/email/events.

export const BREAKER_WINDOW = 50;
export const BOUNCE_RATE_LIMIT = 0.03;
export const COMPLAINT_LIMIT = 2;
const MATCH_WINDOW_DAYS = 7;

const SENT_STATES = ["sent", "bounced", "complained"] as const;

/** Pure rule, over a fixed 50-send window (fewer sends are not "safer"). */
export function breakerVerdict(counts: {
  bounced: number;
  complained: number;
}): "bounce_rate" | "complaints" | null {
  if (counts.bounced / BREAKER_WINDOW > BOUNCE_RATE_LIMIT) return "bounce_rate";
  if (counts.complained >= COMPLAINT_LIMIT) return "complaints";
  return null;
}

export async function evaluateBreaker(ctx: TenantContext, now: Date = new Date()) {
  const clearedAt = await lastSuspensionClearedAt(ctx.tenantId);
  const recent = await tenantDb(ctx)
    .select(
      emailMessages,
      and(
        eq(emailMessages.direction, "out"),
        inArray(emailMessages.status, [...SENT_STATES]),
        ...(clearedAt ? [gt(emailMessages.createdAt, clearedAt)] : []),
      ),
    )
    .orderBy(desc(emailMessages.createdAt))
    .limit(BREAKER_WINDOW);
  const counts = {
    bounced: recent.filter((m) => m.status === "bounced").length,
    complained: recent.filter((m) => m.status === "complained").length,
  };
  const verdict = breakerVerdict(counts);
  if (!verdict) return { suspended: false, counts };

  const suspended = await suspendOutbound(ctx.tenantId, verdict, { ...counts, window: BREAKER_WINDOW }, now);
  if (suspended) await alertSuspension(ctx, verdict, counts);
  return { suspended, counts };
}

async function alertSuspension(
  ctx: TenantContext,
  reason: string,
  counts: { bounced: number; complained: number },
) {
  try {
    const tenant = await getTenant(ctx.tenantId);
    const name = tenant?.name ?? ctx.tenantId;
    const url = `${env.APP_URL}/tenants/${ctx.tenantId}`;
    for (const to of await listSuperadminEmails()) {
      await sendEmail({
        to,
        subject: `Correo suspendido: ${name}`,
        html:
          `<p>Se suspendió el envío de correo de <strong>${escapeHtml(name)}</strong> ` +
          `(${reason === "bounce_rate" ? "demasiados rebotes" : "quejas de spam"}: ` +
          `${counts.bounced} rebotes y ${counts.complained} quejas en los últimos ${BREAKER_WINDOW} envíos).</p>` +
          `<p><a href="${url}">Revisar y quitar la suspensión</a></p>`,
      });
    }
    const admins = (await listTenantUsers(ctx)).filter((u) => u.role === "admin" && !u.banned);
    for (const admin of admins) {
      await createNotification(ctx, {
        userId: admin.id,
        kind: "system",
        title: "El envío de correo está pausado",
        body: "Varios correos rebotaron o fueron marcados como spam. Contactá al soporte para reactivarlo.",
        url: "/email",
      });
    }
  } catch (err) {
    reportError(err, { tags: { area: "mailbox.breaker" } });
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type DeliveryEvent = {
  type: "bounced" | "complained";
  sender: string;
  recipient: string;
  subject?: string | null;
  at?: string | null;
};

/**
 * One Cloudflare delivery event. Cloudflare's messageId isn't one we know
 * (REST doesn't return it), so the send is matched by mailbox address +
 * recipient, newest first within a week, preferring the same subject.
 */
export async function recordDeliveryEvent(
  event: DeliveryEvent,
  now: Date = new Date(),
): Promise<"matched" | "unmatched"> {
  const mailbox = await findMailboxByAddress(event.sender);
  if (!mailbox) return "unmatched";
  const ctx = await buildSystemTenantContext(mailbox.tenantId);
  if (!ctx) return "unmatched";
  const writable = { ...ctx, accessStatus: "active" as const };

  const since = new Date(now.getTime() - MATCH_WINDOW_DAYS * 86_400_000);
  const candidates = await tenantDb(writable)
    .select(
      emailMessages,
      and(
        eq(emailMessages.mailboxId, mailbox.id),
        eq(emailMessages.direction, "out"),
        inArray(emailMessages.status, ["sent", "bounced", "queued"]),
        gte(emailMessages.createdAt, since),
      ),
    )
    .orderBy(desc(emailMessages.createdAt))
    .limit(BREAKER_WINDOW);

  const recipient = event.recipient.trim().toLowerCase();
  const toRecipient = candidates.filter((m) =>
    [...((m.to as Array<{ address: string }>) ?? []), ...((m.cc as Array<{ address: string }>) ?? [])].some(
      (a) => a.address?.toLowerCase() === recipient,
    ),
  );
  const match =
    toRecipient.find((m) => event.subject && m.subject === event.subject) ?? toRecipient[0];
  if (!match) return "unmatched";
  // A complaint outranks a bounce; a bounce doesn't overwrite a complaint.
  if (match.status === "complained" || (match.status === "bounced" && event.type === "bounced")) {
    return "matched";
  }

  await tenantDb(writable)
    .update(emailMessages)
    .set({ status: event.type })
    .where(eq(emailMessages.id, match.id));
  await evaluateBreaker(writable, now);
  return "matched";
}
