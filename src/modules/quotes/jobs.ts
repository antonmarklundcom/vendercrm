import { registerHandler } from "@/worker/handlers";
import { enqueue } from "@/lib/queue";
import { expireQuotes } from "./expiry";

// `quotes.expire` (PLAN.md §15.5 J12, §15.8 P6) — daily chain, same
// self-rescheduling shape as worker/maintenance.ts's task-reminder job.

export const QUOTE_EXPIRE_JOB_TYPE = "quotes.expire";
const QUOTE_EXPIRE_INTERVAL_MS = 24 * 60 * 60 * 1000;

registerHandler(QUOTE_EXPIRE_JOB_TYPE, async () => {
  await expireQuotes();
  await enqueue(QUOTE_EXPIRE_JOB_TYPE, {}, {
    runAt: new Date(Date.now() + QUOTE_EXPIRE_INTERVAL_MS),
  });
});
