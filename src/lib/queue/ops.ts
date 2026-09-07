import { and, asc, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";

// Queue operations for the superadmin console (PLAN.md §13 H3 #3). Lives in
// lib/queue rather than a module because it is platform infrastructure — the
// jobs table has no tenant scope of its own — and this directory is already
// the sanctioned raw-db home for the queue (eslint.config.mjs).

/** How long a `running` row may go untouched before the reaper treats it as
 * abandoned. Also what the console calls "stuck". */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

const LIMIT = 50;

export type OpsJob = {
  id: string;
  type: string;
  tenantId: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: Date;
  lockedAt: Date | null;
};

/** Jobs that gave up: every retry spent, or no handler at all. */
export async function listDeadJobs(limit = LIMIT): Promise<OpsJob[]> {
  return db
    .select({
      id: jobs.id,
      type: jobs.type,
      tenantId: jobs.tenantId,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      lastError: jobs.lastError,
      runAt: jobs.runAt,
      lockedAt: jobs.lockedAt,
    })
    .from(jobs)
    .where(inArray(jobs.status, ["dead", "failed"]))
    .orderBy(desc(jobs.runAt))
    .limit(limit);
}

/** Jobs still marked `running` long after their worker should have finished
 * — what the reaper is about to pick up, or what it can't fix. */
export async function listStuckJobs(now: Date = new Date(), limit = LIMIT): Promise<OpsJob[]> {
  return db
    .select({
      id: jobs.id,
      type: jobs.type,
      tenantId: jobs.tenantId,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      lastError: jobs.lastError,
      runAt: jobs.runAt,
      lockedAt: jobs.lockedAt,
    })
    .from(jobs)
    .where(
      and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(now.getTime() - STUCK_AFTER_MS))),
    )
    .orderBy(desc(jobs.lockedAt))
    .limit(limit);
}

/**
 * Puts a job back in the queue by hand. Attempts reset to zero: the operator
 * retrying it has just changed something outside the queue (a token, a
 * config row), so the job deserves its full budget again rather than one
 * last try.
 */
export async function requeueJob(jobId: string): Promise<boolean> {
  const [result] = await db
    .update(jobs)
    .set({
      status: "pending",
      attempts: 0,
      runAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["dead", "failed", "running"])));

  return ((result as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

// --- Queue health (silent-backlog guard) --------------------------------
//
// The in-process worker (worker/index.ts) ticks itself every ~2s with
// nothing external watching it: if that loop dies (an uncaught throw
// outside processJob's try/catch, the process wedging, ...) the `jobs`
// table just keeps growing pending rows and nothing notices short of a
// customer complaint. This is the read side of that gap — how stale the
// oldest still-pending job is — behind /api/health/queue.

/** Oldest pending job untouched this long is worth paging someone about.
 * Comfortably above normal tick cadence and even a slow burst of retries,
 * but well under "a customer would have noticed by now". Exported so the
 * threshold is visible/adjustable from one place. */
export const QUEUE_STALE_AFTER_MS = 10 * 60 * 1000;

export type QueueHealth = {
  healthy: boolean;
  pendingCount: number;
  oldestPendingAgeSeconds: number | null;
  staleAfterSeconds: number;
};

/**
 * Reports queue backlog health: how many jobs are waiting, and the age of
 * the longest-waiting one. `oldestPendingAgeSeconds` is null when the queue
 * is empty (nothing pending, trivially healthy) — a bare zero would be
 * indistinguishable from "a job that just landed".
 */
export async function checkQueueHealth(now: Date = new Date()): Promise<QueueHealth> {
  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(jobs)
    .where(eq(jobs.status, "pending"));

  const [oldest] = await db
    .select({ runAt: jobs.runAt })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
    .orderBy(asc(jobs.runAt))
    .limit(1);

  const oldestPendingAgeSeconds = oldest
    ? Math.max(0, Math.floor((now.getTime() - oldest.runAt.getTime()) / 1000))
    : null;

  return {
    healthy: oldestPendingAgeSeconds === null || oldestPendingAgeSeconds * 1000 < QUEUE_STALE_AFTER_MS,
    pendingCount,
    oldestPendingAgeSeconds,
    staleAfterSeconds: QUEUE_STALE_AFTER_MS / 1000,
  };
}
