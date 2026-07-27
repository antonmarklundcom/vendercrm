// Rate limiting for public, unauthenticated endpoints (PLAN.md §10 1H).
//
// Fixed-window counters held in memory. That is sound *because* Hostinger
// runs a single Node process (§2.1) — the same reason the job queue lives
// in MySQL instead of Redis. If the app is ever split across processes this
// must move into the database with the queue, or each process will happily
// grant the full allowance on its own.
//
// Counters reset on restart. For abuse protection that is acceptable: the
// goal is to blunt floods, not to bill anyone for requests.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounded so a flood of distinct keys (one per spoofed IP) can't grow the
// map without limit — that would turn the defence into the attack.
const MAX_KEYS = 10_000;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_KEYS) evictExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function evictExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  // Still full of live windows: drop the oldest rather than refuse service.
  if (buckets.size >= MAX_KEYS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_KEYS / 10))) buckets.delete(key);
  }
}

/** Best-effort client identity for anonymous traffic. */
export function clientKey(headers: Headers, prefix: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${prefix}:${forwarded || headers.get("x-real-ip") || "unknown"}`;
}

/** Test seam — resets all windows. */
export function __resetRateLimits() {
  buckets.clear();
}
