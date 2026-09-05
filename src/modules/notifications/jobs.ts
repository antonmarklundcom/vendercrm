import { registerHandler } from "@/worker/handlers";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getUserById } from "@/modules/tenancy/users";
import { isKindMuted } from "./prefs";
import { deliverToTargets, isPushConfigured } from "./push";
import { applyOutcomes, listSubscriptionsForUser, toTargets } from "./subscriptions";
import { PUSH_JOB_TYPE, type PushJob } from "./queue";
import { registerNotificationHooks } from "./hooks";

// The `push.send` handler (PLAN.md §15.5 J2, §15.8 P2). Importing this module
// also subscribes to the domain event buses — the same side-effect pattern as
// modules/automations/jobs.ts, and the reason src/worker/index.ts imports it.

registerNotificationHooks();

registerHandler(PUSH_JOB_TYPE, async (payload, tenantId) => {
  if (!tenantId) throw new Error("push.send job missing tenantId");
  await sendPush(tenantId, payload as PushJob);
});

/**
 * One person, one notification, however many browsers they have.
 *
 * Every early return here is a *success*: a user who muted this kind, a
 * platform with no VAPID keys, a person with no browser registered. None of
 * them is a failure worth a retry, and none of them loses anything — the
 * `notifications` row behind the push is already in their bell.
 */
export async function sendPush(tenantId: string, job: PushJob): Promise<void> {
  if (!isPushConfigured()) return;

  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return;

  const user = await getUserById(job.userId);
  // Gone, or banned from the platform since the job was queued. The push is
  // dropped rather than delivered to a browser that can no longer sign in.
  if (!user || user.banned) return;
  if (isKindMuted(user.pushPrefs, job.kind)) return;

  const rows = await listSubscriptionsForUser(ctx, job.userId);
  if (rows.length === 0) return;

  const outcomes = await deliverToTargets(toTargets(rows), job.payload);
  await applyOutcomes(ctx, outcomes);
}
