import { enqueue } from "@/lib/queue";
import type { PushPayload } from "./push";
import type { PushNotificationKind } from "./prefs";
import { isPushConfigured } from "./push";

// Enqueueing a push (PLAN.md §15.5 J2, §15.8 P2). Split from ./jobs.ts, which
// registers the handler, so nothing on a request path has to import the
// worker just to say "buzz this person".

export const PUSH_JOB_TYPE = "push.send";

/** `push.send` job body — one job per recipient, so one person's muted kind
 * or dead endpoint never affects anybody else's delivery. */
export type PushJob = {
  userId: string;
  kind: PushNotificationKind;
  payload: PushPayload;
};

/**
 * Queues a push, or does nothing at all.
 *
 * The unconfigured check is here rather than only in the handler so a
 * platform without VAPID keys doesn't accumulate a `jobs` row per
 * notification — with the feature off there is nothing for the worker to do
 * with them, and a queue full of no-ops is a queue nobody can read.
 *
 * Never awaited for its result by callers on a request path: a push is a
 * second copy of a `notifications` row that is already durable, so failing to
 * enqueue one must never fail the thing that caused it.
 */
export async function enqueuePush(
  tenantId: string,
  userId: string,
  kind: PushNotificationKind,
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) return;

  const job: PushJob = { userId, kind, payload };
  // Two attempts, not the default five: a push is worth one retry past a
  // blip, and worth nothing an hour late — by then the person has opened the
  // app and read it in the bell.
  await enqueue(PUSH_JOB_TYPE, job, { tenantId, maxAttempts: 2 });
}
