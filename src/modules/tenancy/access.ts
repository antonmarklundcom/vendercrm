import { getTenant } from "./service";
import {
  getSubscription,
  effectiveSubscriptionStatus,
} from "@/modules/billing/service";

// Access state that gates the tenant app (PLAN.md §1B):
//   active    → full access
//   grace     → read-only, past-due banner shown
//   expired   → locked out
//   suspended → locked out (superadmin action, independent of billing)
export type TenantAccessState = "active" | "grace" | "expired" | "suspended";

export type TenantAccess = {
  state: TenantAccessState;
  expiresAt: Date | null;
  writable: boolean;
};

export class ReadOnlyError extends Error {
  constructor() {
    super("La cuenta está en modo de solo lectura");
    this.name = "ReadOnlyError";
  }
}

// Throws in grace/expired/suspended states — used by write server actions so a
// past-due tenant can read but not mutate (PLAN.md §1B).
export async function assertWritable(tenantId: string): Promise<void> {
  const access = await getTenantAccess(tenantId);
  if (!access.writable) throw new ReadOnlyError();
}

// A tenant with no subscription yet (fresh/trial) is treated as active —
// billing is only enforced once a subscription exists. A suspended tenant is
// locked regardless of billing.
export async function getTenantAccess(tenantId: string): Promise<TenantAccess> {
  const tenant = await getTenant(tenantId);
  if (!tenant || tenant.status === "suspended") {
    return { state: "suspended", expiresAt: null, writable: false };
  }

  const subscription = await getSubscription(tenantId);
  if (!subscription) {
    return { state: "active", expiresAt: null, writable: true };
  }

  const state = effectiveSubscriptionStatus(subscription);
  return {
    state,
    expiresAt: subscription.expiresAt,
    writable: state === "active",
  };
}
