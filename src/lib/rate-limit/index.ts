import { env } from "@/lib/config/env";
import { createMemoryDriver } from "./memory";
import { createMysqlDriver } from "./mysql";
import type { RateLimitDriver, RateLimitResult } from "./types";

// Shared fixed-window rate limiter for public-facing routes (PLAN.md §10 1H
// #2, rebuilt in §14 I1 #1). Every public route gets the same behavior
// instead of reinventing it; only *where the count lives* is pluggable.
//
// The window now lives in MySQL, so it survives deploys and holds across
// processes. The in-memory driver stays as the dev/test default (no database
// round-trip in a unit test) and as the MySQL driver's own fallback when the
// database is unreachable.

export type { RateLimitResult, RateLimitDriver };

function defaultDriverName(): "memory" | "mysql" {
  if (env.RATE_LIMIT_DRIVER) return env.RATE_LIMIT_DRIVER;
  return env.NODE_ENV === "test" ? "memory" : "mysql";
}

let driver: RateLimitDriver | null = null;

function activeDriver(): RateLimitDriver {
  if (!driver) {
    driver = defaultDriverName() === "mysql" ? createMysqlDriver() : createMemoryDriver();
  }
  return driver;
}

/**
 * Fixed-window limiter keyed by an arbitrary string (site id, IP, token,
 * etc.). Call once per request; each namespace should use its own key
 * prefix so unrelated routes can't collide on the same bucket.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return activeDriver().check(key, limit, windowMs);
}

/** Test seam: run the next checks against a specific driver. */
export function setRateLimitDriver(next: RateLimitDriver | null): void {
  driver = next;
}

export { createMemoryDriver, createMysqlDriver };
