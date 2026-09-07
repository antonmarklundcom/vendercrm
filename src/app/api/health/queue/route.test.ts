import { afterAll, beforeAll, describe, expect, it } from "vitest";

// DB-backed, like worker/index.integration.test.ts: only runs against a real
// MySQL (CI's service container, or a local one via DATABASE_URL).
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("GET /api/health/queue", () => {
  let route: typeof import("./route");
  let db: (typeof import("@/db/client"))["db"];
  let jobs: (typeof import("@/db/schema"))["jobs"];
  let newId: (typeof import("@/lib/ids"))["newId"];
  let env: (typeof import("@/lib/config/env"))["env"];
  let QUEUE_STALE_AFTER_MS: (typeof import("@/lib/queue/ops"))["QUEUE_STALE_AFTER_MS"];

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ jobs } = await import("@/db/schema"));
    ({ newId } = await import("@/lib/ids"));
    ({ env } = await import("@/lib/config/env"));
    ({ QUEUE_STALE_AFTER_MS } = await import("@/lib/queue/ops"));
    route = await import("./route");

    // Fresh table: an unrelated leftover pending row would otherwise be
    // "the oldest pending job" instead of the one each test inserts.
    await db.delete(jobs);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(jobs);
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  function request(): Request {
    return new Request("http://localhost:3000/api/health/queue", {
      headers: { "x-cron-secret": env.CRON_SECRET },
    });
  }

  it("rejects a request without the cron secret", async () => {
    const response = await route.GET(new Request("http://localhost:3000/api/health/queue"));
    expect(response.status).toBe(401);
  });

  it("reports healthy with no pending jobs", async () => {
    await db.delete(jobs);

    const response = await route.GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      healthy: true,
      pendingCount: 0,
      oldestPendingAgeSeconds: null,
      staleAfterSeconds: QUEUE_STALE_AFTER_MS / 1000,
    });
  });

  it("flags a backlog once the oldest pending job outlives the staleness threshold", async () => {
    await db.delete(jobs);

    const staleAge = QUEUE_STALE_AFTER_MS + 60_000;
    await db.insert(jobs).values([
      {
        id: newId(),
        type: "queue.test.stale",
        payload: {},
        runAt: new Date(Date.now() - staleAge),
      },
      {
        id: newId(),
        type: "queue.test.fresh",
        payload: {},
        runAt: new Date(),
      },
    ]);

    const response = await route.GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);
    expect(body.pendingCount).toBe(2);
    expect(body.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(Math.floor(staleAge / 1000));
  });
});
