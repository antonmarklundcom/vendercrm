import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, tenants, users } from "@/db/schema";
import { env } from "@/lib/config/env";
import type { SuperadminContext, TenantContext } from "./context";
import { writeAuditLog } from "./audit";

// The per-domain mailbox on/off switch (PLAN-EMAIL.md §3). Two layers, both
// off by default so deploying the code changes nothing:
//
//   1. Platform: the Cloudflare vars and the inbound HMAC secret are all set.
//   2. Tenant:   `tenants.mailbox_enabled`, flipped by a superadmin.
//
// The Inbox is visible for a tenant only when both hold. `tenants` is a
// platform table (like tenants.ts, one of the allowed raw-db callers), so
// reads go by id and writes require a SuperadminContext.

type MailboxEnv = {
  STORAGE_DRIVER?: "local" | "s3";
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  EMAIL_INBOUND_SECRET?: string;
};

/**
 * Platform layer: everything the mailbox needs to receive and reply. The
 * Worker stores raw mail and attachments in R2 and the app reads them back
 * through its own storage driver, so the app must be on the S3 driver
 * pointed at that same bucket (PLAN-EMAIL.md E2).
 */
export function isMailboxConfigured(config: MailboxEnv = env): boolean {
  return !!(
    config.STORAGE_DRIVER === "s3" &&
    config.CLOUDFLARE_ACCOUNT_ID &&
    config.CLOUDFLARE_EMAIL_API_TOKEN &&
    config.EMAIL_INBOUND_SECRET
  );
}

/**
 * Whether this tenant's Inbox exists — for nav and page guards. Checks the
 * env first so an unconfigured platform never touches the database.
 */
export async function isMailboxAvailable(
  ctx: Pick<TenantContext, "tenantId">,
  config: MailboxEnv = env,
): Promise<boolean> {
  if (!isMailboxConfigured(config)) return false;
  const [row] = await db
    .select({ mailboxEnabled: tenants.mailboxEnabled })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));
  return row?.mailboxEnabled === true;
}

export async function setMailboxEnabled(
  ctx: SuperadminContext,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  await db.update(tenants).set({ mailboxEnabled: enabled }).where(eq(tenants.id, tenantId));
  await writeAuditLog({
    tenantId,
    actorUserId: ctx.userId,
    action: enabled ? "mailbox.enabled" : "mailbox.disabled",
    entity: "tenant",
    entityId: tenantId,
    payload: { mailboxEnabled: enabled },
  });
}

/** Lifts an outbound suspension (set by the E5 circuit breaker). */
export async function clearOutboundSuspension(
  ctx: SuperadminContext,
  tenantId: string,
): Promise<void> {
  const [row] = await db
    .select({ outboundSuspendedAt: tenants.outboundSuspendedAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row?.outboundSuspendedAt) return;
  await db.update(tenants).set({ outboundSuspendedAt: null }).where(eq(tenants.id, tenantId));
  await writeAuditLog({
    tenantId,
    actorUserId: ctx.userId,
    action: "mailbox.suspension_cleared",
    entity: "tenant",
    entityId: tenantId,
    payload: { suspendedAt: row.outboundSuspendedAt.toISOString() },
  });
}

/**
 * The circuit breaker's switch (PLAN-EMAIL.md E5): stops mailbox replies for
 * one business. Only the first call sets the timestamp and writes the audit
 * row, so a burst of bounce events suspends once. Returns whether this call
 * was the one that suspended.
 */
export async function suspendOutbound(
  tenantId: string,
  reason: string,
  detail: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<boolean> {
  const [result] = await db
    .update(tenants)
    .set({ outboundSuspendedAt: now })
    .where(and(eq(tenants.id, tenantId), isNull(tenants.outboundSuspendedAt)));
  if (!result || result.affectedRows === 0) return false;
  await writeAuditLog({
    tenantId,
    actorUserId: "system",
    action: "mailbox.outbound_suspended",
    entity: "tenant",
    entityId: tenantId,
    payload: { reason, ...detail },
  });
  return true;
}

/** Where a suspension alert goes: every platform superadmin's login email. */
export async function listSuperadminEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.isSuperadmin, true), eq(users.banned, false)));
  return rows.map((row) => row.email);
}

/**
 * When a superadmin last lifted this business's suspension (from the audit
 * trail, so no extra column). The breaker only counts sends after it: the
 * operator has looked at the old bounces, and they must not re-trip the
 * breaker on the very next one.
 */
export async function lastSuspensionClearedAt(tenantId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, "mailbox.suspension_cleared")))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row?.at ?? null;
}
