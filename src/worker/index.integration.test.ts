import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only when a real MySQL is reachable (CI provides one as a service
// container — see .github/workflows/ci.yml). Skipped locally without
// DATABASE_URL so `npm test` doesn't require a live database.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("worker (MySQL integration)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let jobs: (typeof import("@/db/schema"))["jobs"];
  let tick: (typeof import("./index"))["tick"];
  let newId: (typeof import("@/lib/ids"))["newId"];

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ jobs } = await import("@/db/schema"));
    ({ tick } = await import("./index"));
    ({ newId } = await import("@/lib/ids"));
    await import("./handlers");
  });

  afterAll(async () => {
    if (!db) return; // beforeAll failed before assigning it — nothing to close
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  // The `jobs` table is a single physical table shared across this whole
  // vitest run (it isn't reset between test files) — other suites leave
  // their own due/pending rows behind. `claimNextJob` claims whichever due
  // job has the earliest run_at, not a specific one, so a single tick() can
  // legitimately claim someone else's leftover job instead of the one this
  // test just inserted. Ticking until THIS job reaches a terminal status is
  // what a real worker loop does too — assuming "the very next tick is mine"
  // was the test bug, not the queue's claim-oldest-first behavior.
  async function tickUntil(
    id: string,
    isDone: (row: typeof jobs.$inferSelect) => boolean,
    maxTicks = 50,
  ): Promise<typeof jobs.$inferSelect> {
    let row: typeof jobs.$inferSelect;
    for (let i = 0; i < maxTicks; i++) {
      [row] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (isDone(row)) return row;
      await tick("test-worker");
    }
    [row!] = await db.select().from(jobs).where(eq(jobs.id, id));
    return row!;
  }

  it("processes a job to done on first success", async () => {
    const id = newId();
    await db.insert(jobs).values({
      id,
      type: "queue.test",
      payload: {},
      runAt: new Date(),
    });

    const row = await tickUntil(id, (r) => r.status === "done" || r.status === "dead");
    expect(row.status).toBe("done");
    expect(row.attempts).toBe(1);
  });

  it("retries with exponential backoff and eventually dead-letters", async () => {
    const id = newId();
    await db.insert(jobs).values({
      id,
      type: "queue.test",
      payload: { failUntilAttempt: 999 },
      runAt: new Date(),
      maxAttempts: 2,
    });

    // Attempt 1: fails, rescheduled ~1s out (still "pending", just not due
    // yet). Tick until OUR job shows attempts >= 1, regardless of how many
    // unrelated leftover jobs from other suites get processed in between.
    let row = await tickUntil(id, (r) => r.attempts >= 1);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("forced failure");
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() - 5000);

    // Force it due now so we don't wait out the real backoff in the test.
    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, id));

    // Attempt 2: fails, hits maxAttempts -> dead.
    row = await tickUntil(id, (r) => r.status === "dead");
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(2);
  });

  it("dead-letters jobs with no registered handler", async () => {
    const id = newId();
    await db.insert(jobs).values({
      id,
      type: "no.such.handler",
      payload: {},
      runAt: new Date(),
    });

    const row = await tickUntil(id, (r) => r.status === "dead");
    expect(row.status).toBe("dead");
    expect(row.lastError).toContain("No handler registered");
  });
});
