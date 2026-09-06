import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, rateLimitBuckets, webhookEvents } from "@/db/schema";
import { enqueue } from "@/lib/queue";
import { STUCK_AFTER_MS } from "@/lib/queue/ops";
import { reportError } from "@/lib/observability";
import { registerHandler } from "./handlers";

// Recurring maintenance jobs (PLAN.md §10 1H #3). Same self-rescheduling
// pattern as modules/whatsapp/sync-schedule.ts's nightly template sync: the
// handler re-enqueues itself after each successful run, so the chain lives
// in the jobs table (survives restarts, needs no cron) rather than in a
// process timer.
//
// Lives in src/worker (not src/modules) because it needs raw db access to
// the platform-level `webhook_events`/`jobs` tables — same reasoning as
// worker/claim.ts and worker/process-job.ts, both exempt from the
// tenancy-scoped db rule (PLAN.md §3.3, eslint.config.mjs).

export const PRUNE_JOB_TYPE = "maintenance.prune_webhook_events";
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

registerHandler(PRUNE_JOB_TYPE, async () => {
  await pruneWebhookEvents();
  await enqueue(PRUNE_JOB_TYPE, {}, { runAt: new Date(Date.now() + PRUNE_INTERVAL_MS) });
});

/** Deletes webhook_events rows older than the retention window (PLAN.md's
 * WhatsApp webhook_events note: raw payloads aren't kept indefinitely). */
export async function pruneWebhookEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [result] = await db
    .delete(webhookEvents)
    .where(and(lt(webhookEvents.createdAt, cutoff)));
  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}

/**
 * Seeds the pruning chain if it isn't already running — called once from
 * worker startup (worker/index.ts). Idempotent: does nothing if a job of
 * this type is already pending/running, so restarting the worker never
 * spawns a second parallel chain.
 */
export async function ensureWebhookPruningScheduled(): Promise<void> {
  await ensureChainScheduled(PRUNE_JOB_TYPE);
}

/** Seeds every recurring maintenance chain — called once from worker startup. */
export async function ensureMaintenanceScheduled(): Promise<void> {
  await ensureWebhookPruningScheduled();
  await ensureChainScheduled(REAP_JOB_TYPE);
  await ensureChainScheduled(TASK_REMINDER_JOB_TYPE);
  await ensureChainScheduled(SWEEP_RATE_LIMITS_JOB_TYPE);
  // modules/quotes/jobs.ts's daily expiry sweep (§15.8 P6) — registered
  // there (that module owns it), seeded here alongside every other daily
  // chain so a fresh deploy starts it without a manual trigger.
  const { QUOTE_EXPIRE_JOB_TYPE } = await import("@/modules/quotes/jobs");
  await ensureChainScheduled(QUOTE_EXPIRE_JOB_TYPE);
  // modules/coach/jobs.ts's hourly morning-digest check (§15.3 L1, §15.8
  // P7) — same seeding as every other daily/hourly chain above.
  const { COACH_MORNING_JOB_TYPE } = await import("@/modules/coach/jobs");
  await ensureChainScheduled(COACH_MORNING_JOB_TYPE);
}

async function ensureChainScheduled(type: string): Promise<void> {
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, type), inArray(jobs.status, ["pending", "running"])))
    .limit(1);
  if (existing) return;

  await enqueue(type, {});
}

// --- Stuck-job reaper (PLAN.md §13 H3 #2) -------------------------------
//
// claim.ts flips a job to `running` and never looks at it again. If the
// process dies mid-run — a deploy, an OOM kill, Hostinger recycling the app
// — the row stays `running` forever and nothing retries it: the send is
// simply lost, silently. The reaper is the only thing that can notice,
// because only the row's age can distinguish "still working" from "the
// worker that held this is gone".

export const REAP_JOB_TYPE = "maintenance.reap_stuck_jobs";
const REAP_INTERVAL_MS = 5 * 60 * 1000;

// Shared with the superadmin console so "stuck" means one thing in both
// places: well above any real handler's runtime (the WhatsApp send/AI calls
// are seconds), so a live job is never reaped out from under itself.
export { STUCK_AFTER_MS };

registerHandler(REAP_JOB_TYPE, async () => {
  await reapStuckJobs();
  await enqueue(REAP_JOB_TYPE, {}, { runAt: new Date(Date.now() + REAP_INTERVAL_MS) });
});

/**
 * Returns `running` jobs whose lock has gone stale to `pending` so the next
 * tick picks them up, counting the dead run as an attempt. A job that has
 * exhausted its attempts this way goes to `dead` instead of looping
 * forever — same terminal state processJob uses.
 */
export async function reapStuckJobs(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);

  const stuck = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      tenantId: jobs.tenantId,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      lockedBy: jobs.lockedBy,
      lockedAt: jobs.lockedAt,
    })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff)))
    .limit(200);

  for (const job of stuck) {
    const attempts = job.attempts + 1;
    const dead = attempts >= job.maxAttempts;

    await db
      .update(jobs)
      .set({
        status: dead ? "dead" : "pending",
        attempts,
        runAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: `Reaped: still running since ${job.lockedAt?.toISOString() ?? "?"} (worker ${job.lockedBy ?? "?"})`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));

    reportError(new Error(`Reaped stuck job ${job.type}`), {
      tags: { area: "worker", jobType: job.type, outcome: dead ? "dead" : "requeued" },
      extra: { jobId: job.id, tenantId: job.tenantId, attempts, lockedBy: job.lockedBy },
    });
  }

  return stuck.length;
}


// --- Daily task reminders (PLAN.md §13 H6) ------------------------------
//
// Same self-rescheduling chain as the pruning job. Runs on the platform's
// clock rather than per-tenant local time: the reminder is a nudge, and one
// mail a day at a fixed hour is easier to reason about than 24 wake-ups.

export const TASK_REMINDER_JOB_TYPE = "maintenance.task_reminders";
const TASK_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

registerHandler(TASK_REMINDER_JOB_TYPE, async () => {
  const { sendTaskReminders } = await import("@/modules/crm/task-reminders");
  await sendTaskReminders();
  await enqueue(TASK_REMINDER_JOB_TYPE, {}, {
    runAt: new Date(Date.now() + TASK_REMINDER_INTERVAL_MS),
  });
});


// --- Expired rate-limit windows (PLAN.md §14 I1 #1) ---------------------
//
// The limiter writes one row per bucket and never deletes: a bucket whose
// `reset_at` has passed is dead weight the moment the window ends, and the
// buckets are keyed by IP, so a scanner alone can leave thousands behind.
// The old in-memory limiter swept itself with a timer; the table needs the
// same hygiene from something that outlives a single process.

export const SWEEP_RATE_LIMITS_JOB_TYPE = "maintenance.sweep_rate_limits";
const SWEEP_RATE_LIMITS_INTERVAL_MS = 60 * 60 * 1000;

registerHandler(SWEEP_RATE_LIMITS_JOB_TYPE, async () => {
  await sweepExpiredRateLimits();
  await enqueue(
    SWEEP_RATE_LIMITS_JOB_TYPE,
    {},
    { runAt: new Date(Date.now() + SWEEP_RATE_LIMITS_INTERVAL_MS) },
  );
});

/**
 * Deletes rate-limit rows whose window has already ended. Safe at any time:
 * a swept row that is still being counted against simply starts a fresh
 * window on the next request, which is what an expired window means anyway.
 */
export async function sweepExpiredRateLimits(now: Date = new Date()): Promise<number> {
  const [result] = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.resetAt, now));
  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}
