import { randomUUID } from "crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, type JobStatus } from "@/db/schema/jobs";
import { env } from "@/lib/config/env";
import { getJobHandler } from "@/lib/queue/handlers";

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

type ClaimedJob = {
  id: string;
  type: string;
  payload: unknown;
  tenantId: string | null;
  attempts: number;
  maxAttempts: number;
};

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending" satisfies JobStatus), lte(jobs.runAt, new Date())))
      .orderBy(asc(jobs.runAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!row) return null;

    const nextAttempts = row.attempts + 1;

    await tx
      .update(jobs)
      .set({
        status: "running",
        attempts: nextAttempts,
        lockedAt: new Date(),
        lockedBy: WORKER_ID,
      })
      .where(eq(jobs.id, row.id));

    return {
      id: row.id,
      type: row.type,
      payload: row.payload,
      tenantId: row.tenantId,
      attempts: nextAttempts,
      maxAttempts: row.maxAttempts,
    };
  });
}

async function completeJob(id: string): Promise<void> {
  await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, id));
}

async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const isDead = job.attempts >= job.maxAttempts;

  await db
    .update(jobs)
    .set({
      status: isDead ? "dead" : "pending",
      ...(isDead ? {} : { runAt: new Date(Date.now() + backoffMs(job.attempts)) }),
      lastError: message.slice(0, 2000),
    })
    .where(eq(jobs.id, job.id));
}

async function processJob(job: ClaimedJob): Promise<void> {
  const handler = getJobHandler(job.type);

  if (!handler) {
    await failJob(job, new Error(`No handler registered for job type "${job.type}"`));
    return;
  }

  try {
    await handler(job.payload, {
      jobId: job.id,
      tenantId: job.tenantId,
      attempts: job.attempts,
    });
    await completeJob(job.id);
  } catch (error) {
    await failJob(job, error);
  }
}

let running = false;

export async function runWorkerLoop(): Promise<void> {
  if (running) return;
  running = true;

  console.log(`[worker ${WORKER_ID}] started, polling every ${env.QUEUE_POLL_INTERVAL_MS}ms`);

  while (running) {
    let claimed: ClaimedJob | null = null;

    try {
      claimed = await claimNextJob();
    } catch (error) {
      console.error(`[worker ${WORKER_ID}] claim error`, error);
    }

    if (claimed) {
      await processJob(claimed);
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, env.QUEUE_POLL_INTERVAL_MS));
  }
}

export function stopWorkerLoop(): void {
  running = false;
}
