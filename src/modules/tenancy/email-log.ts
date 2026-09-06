import { and, eq, gte } from "drizzle-orm";
import { emailLog } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "./context";
import { tenantDb } from "./db";

// One row per send attempt (PLAN.md §15.1, §15.8 P4). Lives in
// modules/tenancy rather than lib/email so every write and read goes
// through tenantDb — lib/email/index.ts calls these with a TenantContext
// instead of touching the database itself.

export type EmailKind = "transactional" | "automated";
export type EmailLogStatus = "sent" | "failed" | "skipped";

export async function logEmail(
  ctx: TenantContext,
  input: { to: string; subject: string; kind: EmailKind; status: EmailLogStatus; providerId?: string },
) {
  await tenantDb(ctx)
    .insert(emailLog)
    .values({
      id: newId(),
      to: input.to,
      subject: input.subject,
      kind: input.kind,
      status: input.status,
      providerId: input.providerId,
    });
}

/**
 * Emails sent (not skipped or failed) in the last 24 hours — a rolling
 * window rather than the tenant's calendar day: simpler, and "per day" as a
 * plan cap is about pacing volume, not about resetting at a particular
 * local midnight the way a promo's "hasta el 30" is.
 */
export async function countEmailsSentToday(ctx: TenantContext): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await tenantDb(ctx).select(
    emailLog,
    and(eq(emailLog.status, "sent"), gte(emailLog.createdAt, since)),
  );
  return rows.length;
}
