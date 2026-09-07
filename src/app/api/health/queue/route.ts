import { NextResponse } from "next/server";
import { checkQueueHealth } from "@/lib/queue/ops";
import { requireCronSecret } from "@/lib/api/guards";

// Backlog watchdog for the in-process worker (worker/index.ts, PLAN.md §2.1).
// The worker ticks itself every ~2s with nothing external observing it: if
// that loop ever dies (a process wedge, an uncaught throw outside
// processJob's own try/catch), the `jobs` table just fills up silently until
// a customer notices. This reports the oldest still-pending job's age so an
// uptime monitor can page on it before that happens. Guarded the same way as
// /api/health/db — an internal check, not a public status page.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = requireCronSecret(request);
  if (!guard.ok) return guard.response;

  const health = await checkQueueHealth();
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
