import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { claimNextJob } from "./claim";
import { processJob } from "./process-job";
// "./handlers" must be imported (and fully initialized) before any module
// that registers its own handlers into it — e.g. whatsapp/jobs.ts calls
// registerHandler() at import time, and would hit its `handlers` Map before
// initialization if handlers.ts imported whatsapp/jobs.ts itself (a real
// cycle, since ESM hoists all static imports ahead of a module's own body).
import "./handlers";
import "@/modules/whatsapp/jobs";
import "@/modules/automations/jobs";
import "@/modules/booking/jobs";
import "@/modules/notifications/jobs";
import "@/modules/tenancy/email-jobs";
import "@/modules/quotes/jobs";
import "@/modules/coach/jobs";
import "@/modules/coach/briefing-jobs";
import { ensureMaintenanceScheduled } from "./maintenance";

const TICK_MS = 2000;

// Standalone entry point — importable and runnable on its own (`npm run
// worker`), and started in-process via instrumentation.ts. If the platform
// outgrows a single Node process, this file can be lifted into its own
// process pointed at the same MySQL without changes (PLAN.md §2.1).
export async function tick(workerId: string): Promise<boolean> {
  const job = await claimNextJob(db, workerId);
  if (!job) return false;

  await processJob(db, job);
  return true;
}

export function startWorker(): () => void {
  const workerId = `${process.pid}-${randomUUID()}`;
  let stopped = false;

  // Seeds the recurring maintenance chains (webhook_events pruning, PLAN.md
  // §10 1H #3; stuck-job reaping, §13 H3) if they aren't already running —
  // idempotent, safe on every worker start.
  void ensureMaintenanceScheduled().catch((err) => {
    console.error("[worker] failed to schedule maintenance", err);
  });

  const loop = async () => {
    while (!stopped) {
      let didWork = false;
      try {
        didWork = await tick(workerId);
      } catch (err) {
        console.error("[worker] tick failed", err);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, didWork ? 0 : TICK_MS),
      );
    }
  };

  void loop();

  return () => {
    stopped = true;
  };
}

if (require.main === module) {
  startWorker();
}
