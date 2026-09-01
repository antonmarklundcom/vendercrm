import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRateLimit, createMemoryDriver } from "./index";

// The default driver in tests is the in-memory one (env.RATE_LIMIT_DRIVER
// unset + NODE_ENV=test), so these cases describe the behavior every driver
// owes its callers. The MySQL driver is exercised against a real database
// below — that is the one §14 I1 actually changed.

describe("checkRateLimit", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(key, 3, 60_000)).limited).toBe(false);
    }
    expect((await checkRateLimit(key, 3, 60_000)).limited).toBe(true);
  });

  it("keeps separate buckets per key", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 2; i++) await checkRateLimit(a, 2, 60_000);
    expect((await checkRateLimit(a, 2, 60_000)).limited).toBe(true);
    expect((await checkRateLimit(b, 2, 60_000)).limited).toBe(false);
  });

  it("resets after the window elapses", async () => {
    const key = `window-${Math.random()}`;
    expect((await checkRateLimit(key, 1, 10)).limited).toBe(false);
    expect((await checkRateLimit(key, 1, 10)).limited).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await checkRateLimit(key, 1, 10)).limited).toBe(false);
  });
});

describe("memory driver", () => {
  it("forgets every window when the process does", async () => {
    // The behavior that made the in-memory limiter unsound in production
    // (PLAN.md §14 I1 #1), asserted rather than assumed: a fresh driver is a
    // fresh process, and the caller gets a brand-new budget.
    const key = `restart-${Math.random()}`;
    const before = createMemoryDriver();
    expect((await before.check(key, 1, 60_000)).limited).toBe(false);
    expect((await before.check(key, 1, 60_000)).limited).toBe(true);

    const after = createMemoryDriver();
    expect((await after.check(key, 1, 60_000)).limited).toBe(false);
  });
});

// --- MySQL driver (integration) ----------------------------------------

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("mysql driver (MySQL integration)", () => {
  let createMysqlDriver: (typeof import("./mysql"))["createMysqlDriver"];

  beforeAll(async () => {
    ({ createMysqlDriver } = await import("./mysql"));
  });

  it("counts up to the limit, then blocks", async () => {
    const driver = createMysqlDriver();
    const key = `mysql-basic-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect((await driver.check(key, 3, 60_000)).limited).toBe(false);
    }
    expect((await driver.check(key, 3, 60_000)).limited).toBe(true);
  });

  it("survives a restart — the window is the row, not the process", async () => {
    // The whole point of I1: a redeploy used to hand every caller a fresh
    // budget. A second driver instance is a second process; the count has to
    // carry over.
    const key = `mysql-restart-${Math.random()}`;
    const before = createMysqlDriver();
    expect((await before.check(key, 2, 60_000)).limited).toBe(false);
    expect((await before.check(key, 2, 60_000)).limited).toBe(false);

    const after = createMysqlDriver();
    expect((await after.check(key, 2, 60_000)).limited).toBe(true);
  });

  it("starts a new window once the old one has expired", async () => {
    const driver = createMysqlDriver();
    const key = `mysql-window-${Math.random()}`;
    expect((await driver.check(key, 1, 50)).limited).toBe(false);
    expect((await driver.check(key, 1, 50)).limited).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await driver.check(key, 1, 50)).limited).toBe(false);
  });

  it("keeps separate buckets per key", async () => {
    const driver = createMysqlDriver();
    const a = `mysql-a-${Math.random()}`;
    const b = `mysql-b-${Math.random()}`;
    expect((await driver.check(a, 1, 60_000)).limited).toBe(false);
    expect((await driver.check(a, 1, 60_000)).limited).toBe(true);
    expect((await driver.check(b, 1, 60_000)).limited).toBe(false);
  });

  it("limits keys longer than the column, without truncating them together", async () => {
    // Two keys that share a 191-character prefix must not share a bucket.
    const driver = createMysqlDriver();
    const prefix = `mysql-long-${Math.random()}-`.padEnd(200, "x");
    const first = `${prefix}-one`;
    const second = `${prefix}-two`;
    expect((await driver.check(first, 1, 60_000)).limited).toBe(false);
    expect((await driver.check(first, 1, 60_000)).limited).toBe(true);
    expect((await driver.check(second, 1, 60_000)).limited).toBe(false);
  });

  it("sweeps expired windows and leaves live ones alone", async () => {
    const driver = createMysqlDriver();
    const expired = `mysql-sweep-old-${Math.random()}`;
    const live = `mysql-sweep-live-${Math.random()}`;
    await driver.check(expired, 5, 10);
    await driver.check(live, 5, 60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const { sweepExpiredRateLimits } = await import("@/worker/maintenance");
    await sweepExpiredRateLimits();

    const { db } = await import("@/db/client");
    const { rateLimitBuckets } = await import("@/db/schema");
    const { inArray } = await import("drizzle-orm");
    const rows = await db
      .select({ key: rateLimitBuckets.bucketKey })
      .from(rateLimitBuckets)
      .where(inArray(rateLimitBuckets.bucketKey, [expired, live]));

    expect(rows.map((row) => row.key)).toEqual([live]);
  });
});
