import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { claimNextJob } from "./claim";
import { processJob } from "./process-job";
import "./handlers";
// Module job handlers self-register on import — pull them in so they're live
// before the worker claims any job.
import "@/modules/whatsapp/jobs";
import "@/modules/quotes/jobs";
import "@/modules/automations/jobs";

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
