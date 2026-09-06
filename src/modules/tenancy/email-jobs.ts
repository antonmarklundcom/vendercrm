import { registerHandler } from "@/worker/handlers";
import { enqueue } from "@/lib/queue";
import { buildSystemTenantContext } from "./context";
import {
  getTenantEmailDomain,
  markTenantEmailDomainFailed,
  refreshTenantEmailDomain,
} from "./email-domains";

// `email.verify_domain` (PLAN.md §15.1, §15.8 P4): polls Resend every 10
// minutes for 72 hours, then gives up. Self-rescheduling, the same shape as
// booking/jobs.ts's BOOKING_COMPLETE_JOB_TYPE — there is no cron guarantee
// on this platform (§2.1), so the job books its own next run.

export const VERIFY_DOMAIN_JOB_TYPE = "email.verify_domain";
const POLL_INTERVAL_MS = 10 * 60 * 1000;
export const VERIFY_DOMAIN_WINDOW_MS = 72 * 60 * 60 * 1000;

export type VerifyDomainJobPayload = {
  tenantId: string;
  domainId: string;
  /** ISO timestamp — stop polling and mark `failed` once past this. */
  deadlineAt: string;
};

/** Schedules the first poll, 10 minutes out — called right after
 *  createTenantEmailDomain. */
export async function scheduleDomainVerification(tenantId: string, domainId: string): Promise<void> {
  const payload: VerifyDomainJobPayload = {
    tenantId,
    domainId,
    deadlineAt: new Date(Date.now() + VERIFY_DOMAIN_WINDOW_MS).toISOString(),
  };
  await enqueue(VERIFY_DOMAIN_JOB_TYPE, payload, {
    tenantId,
    runAt: new Date(Date.now() + POLL_INTERVAL_MS),
  });
}

/** The state machine itself, exported so tests can drive it directly with
 *  email-domains.ts mocked, the same shape notifications/jobs.ts's
 *  `sendPush` is tested. */
export async function processDomainVerification(payload: VerifyDomainJobPayload): Promise<void> {
  const ctx = await buildSystemTenantContext(payload.tenantId);
  if (!ctx) return;

  const domain = await getTenantEmailDomain(ctx, payload.domainId);
  // Gone, or already settled by an admin's manual retry between polls —
  // either way there is nothing left for this chain to do.
  if (!domain || domain.status !== "pending") return;

  const refreshed = await refreshTenantEmailDomain(ctx, payload.domainId);
  if (!refreshed || refreshed.status !== "pending") return;

  if (Date.now() >= new Date(payload.deadlineAt).getTime()) {
    await markTenantEmailDomainFailed(ctx, payload.domainId);
    return;
  }

  await enqueue(VERIFY_DOMAIN_JOB_TYPE, payload, {
    tenantId: payload.tenantId,
    runAt: new Date(Date.now() + POLL_INTERVAL_MS),
  });
}

registerHandler(VERIFY_DOMAIN_JOB_TYPE, async (rawPayload) => {
  await processDomainVerification(rawPayload as VerifyDomainJobPayload);
});
