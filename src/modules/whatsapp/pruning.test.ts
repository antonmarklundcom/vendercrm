import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// webhook_events pruning (PLAN.md §10 1H). Real MySQL only.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("webhook_events pruning", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let pruneWebhookEvents: (typeof import("./pruning"))["pruneWebhookEvents"];
  let RETENTION_DAYS: number;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ pruneWebhookEvents, RETENTION_DAYS } = await import("./pruning"));
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("deletes processed events past the retention window, keeps recent ones, and never deletes failures", async () => {
    const old = new Date(Date.now() - (RETENTION_DAYS + 5) * 86400000);
    const recent = new Date();

    const oldProcessed = newId();
    const oldFailed = newId();
    const recentProcessed = newId();

    await db.insert(schema.webhookEvents).values([
      { id: oldProcessed, payload: {}, status: "processed", createdAt: old },
      // Failures are the ones worth investigating, so age alone must not
      // remove them — the health view lists exactly these.
      { id: oldFailed, payload: {}, status: "failed", createdAt: old },
      { id: recentProcessed, payload: {}, status: "processed", createdAt: recent },
    ]);

    await pruneWebhookEvents();

    const survives = async (id: string) =>
      (await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, id))).length > 0;

    expect(await survives(oldProcessed)).toBe(false);
    expect(await survives(oldFailed)).toBe(true);
    expect(await survives(recentProcessed)).toBe(true);
  });
});
