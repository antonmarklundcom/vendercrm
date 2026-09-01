import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { reportError } from "@/lib/observability";
import { createMemoryDriver } from "./memory";
import type { RateLimitDriver, RateLimitResult } from "./types";

// MySQL-backed fixed window (PLAN.md §14 I1 #1). One row per bucket, so a
// deploy no longer hands every caller a fresh budget and a second app
// process can't silently double every limit.
//
// Both the comparison and the stored window end come from the app's clock,
// never MySQL's NOW(): mixing the two would make a window longer or shorter
// than requested by exactly the clock skew between app and database.

const MAX_KEY_LENGTH = 191;

/** Keys are caller-supplied and can carry an email or a token; anything past
 * the column width is stored as its digest so the row is still unique. */
function storageKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

type BucketRow = { hitCount: number; resetAt: Date | string };

export function createMysqlDriver(): RateLimitDriver {
  // The fallback is per-driver rather than module-global so a test can build
  // an isolated driver without inheriting another test's counts.
  const fallback = createMemoryDriver();
  let lastReportedAt = 0;

  return {
    name: "mysql",
    async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
      const now = new Date();
      const resetAt = new Date(now.getTime() + windowMs);
      const bucketKey = storageKey(key);

      try {
        // One transaction, so the upsert and the read-back run on the same
        // pooled connection: a concurrent request can only ever push the
        // count *up* between them, which errs toward limiting rather than
        // toward letting a flood through.
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`
            INSERT INTO rate_limit_buckets (bucket_key, hit_count, reset_at)
            VALUES (${bucketKey}, 1, ${resetAt})
            ON DUPLICATE KEY UPDATE
              hit_count = IF(reset_at <= ${now}, 1, hit_count + 1),
              reset_at = IF(reset_at <= ${now}, ${resetAt}, reset_at)
          `);

          const result = await tx.execute(sql`
            SELECT hit_count AS hitCount, reset_at AS resetAt
            FROM rate_limit_buckets
            WHERE bucket_key = ${bucketKey}
          `);

          const rows = (Array.isArray(result) ? result[0] : result) as unknown as BucketRow[];
          return rows[0] ?? null;
        });

        if (!row) {
          // The row we just wrote is gone (a concurrent sweep). Treat it as
          // a fresh window rather than failing the request.
          return { limited: false, remaining: limit - 1, resetAt: resetAt.getTime() };
        }

        const count = Number(row.hitCount);
        const windowEnd = new Date(row.resetAt).getTime();
        return {
          limited: count > limit,
          remaining: Math.max(0, limit - count),
          resetAt: windowEnd,
        };
      } catch (error) {
        // A database blip must not take down every public page at once, so
        // the limiter degrades to per-process counting instead of throwing.
        // Reported at most once a minute — a database outage would otherwise
        // report once per request.
        if (Date.now() - lastReportedAt > 60_000) {
          lastReportedAt = Date.now();
          reportError(error, { tags: { area: "rate-limit" } });
        }
        return fallback.check(key, limit, windowMs);
      }
    },
  };
}
