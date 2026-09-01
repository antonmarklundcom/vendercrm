import type { RateLimitDriver, RateLimitResult } from "./types";

// The original process-local limiter (PLAN.md §10 1H #2), kept as a driver
// rather than deleted: it is what tests and `npm run dev` run against, and
// it is what the MySQL driver falls back to when the database is unreachable
// — a limiter that degrades to per-process counting still refuses a flood,
// where one that throws would take the public pages down with it.

type Bucket = { count: number; resetAt: number };

export function createMemoryDriver(): RateLimitDriver & { reset: () => void } {
  const buckets = new Map<string, Bucket>();

  // Periodic sweep so long-lived processes don't accumulate stale buckets
  // forever. Harmless if it never fires in short-lived contexts (tests,
  // serverless) — it's just memory hygiene.
  if (typeof setInterval !== "undefined") {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (now >= bucket.resetAt) buckets.delete(key);
      }
    }, 5 * 60_000);
    sweep.unref?.();
  }

  return {
    name: "memory",
    async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now >= bucket.resetAt) {
        const resetAt = now + windowMs;
        buckets.set(key, { count: 1, resetAt });
        return { limited: false, remaining: limit - 1, resetAt };
      }

      bucket.count += 1;
      return {
        limited: bucket.count > limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt,
      };
    },
    /** Test seam: forget every window. Never called in production code. */
    reset() {
      buckets.clear();
    },
  };
}
