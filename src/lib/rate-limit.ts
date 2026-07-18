type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * A simple in-memory fixed-window limiter. Only correct for a single Node
 * process — matches this project's one-process-per-app deployment shape
 * (see PLAN.md §2.1). Move to a shared store if the worker is ever split out.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) return false;

  bucket.count += 1;
  return true;
}
