import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { subscriptions, type TenantStatus } from "@/db/schema/tenancy";

const GRACE_PERIOD_DAYS = 7;

export type AccessState = "ok" | "grace" | "locked";

/** No superadmin/tenant guard — callers must already hold an authorized context. */
export async function getLatestSubscriptionForTenant(tenantId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.expiresAt))
    .limit(1);

  return row ?? null;
}

/**
 * A fresh tenant with no subscription yet (still "trial") gets full access —
 * that's the bootstrap window between tenant creation and the first
 * recorded payment. Everything else follows subscription expiry, with a
 * grace window before it locks.
 */
export function computeAccessState(
  tenantStatus: TenantStatus,
  latestSubscription: { expiresAt: Date } | null,
  now: Date = new Date(),
): AccessState {
  if (tenantStatus === "suspended") return "locked";

  if (!latestSubscription) {
    return tenantStatus === "trial" ? "ok" : "locked";
  }

  if (latestSubscription.expiresAt > now) return "ok";

  const graceDeadline = new Date(latestSubscription.expiresAt);
  graceDeadline.setDate(graceDeadline.getDate() + GRACE_PERIOD_DAYS);

  return now <= graceDeadline ? "grace" : "locked";
}

export class ReadOnlyAccessError extends Error {
  constructor() {
    super("Tenant access is read-only: subscription is in its grace period or has expired");
  }
}

/** Future mutating actions in tenant-facing modules should call this first. */
export async function assertMutationsAllowed(
  tenantId: string,
  tenantStatus: TenantStatus,
): Promise<void> {
  const subscription = await getLatestSubscriptionForTenant(tenantId);
  const state = computeAccessState(tenantStatus, subscription);

  if (state !== "ok") throw new ReadOnlyAccessError();
}
