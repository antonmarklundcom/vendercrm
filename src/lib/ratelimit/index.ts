// Minimal in-memory sliding-window rate limiter for public endpoints (forms,
// later the webhook's edges). Single-process is fine for Hostinger's one Node
// process (PLAN.md §2.1); 1G revisits durability if needed. Not a security
// boundary on its own — pairs with a honeypot on public forms.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) return { ok: false, remaining: 0 };

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count };
}
