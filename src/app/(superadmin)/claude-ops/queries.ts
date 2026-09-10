import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { getSite } from "@/modules/sites/sites";
import { listApiKeys } from "@/modules/sites/keys";
import { getPipeline, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listAuditLog } from "@/modules/tenancy/audit";
import {
  listAllOpsBatches,
  listRowsForBatch,
  listRowsAwaitingOwner,
  type OpsRow,
} from "@/modules/ops";

// Read-only joins the O2 page needs and O1's tables don't carry on their own
// — a row only holds ids (tenant_id, site_id, pipeline_id, api_key_id), and
// the worksheet is meaningless without the names behind them. Nothing here
// writes; nothing here is reachable from an ops token.

export type OpsRowView = {
  row: OpsRow;
  tenantName: string | null;
  siteSlug: string | null;
  siteActive: boolean | null;
  pipelineName: string | null;
  stageCount: number;
  keyPrefix: string | null;
  keyLabel: string | null;
};

export async function enrichOpsRow(row: OpsRow): Promise<OpsRowView> {
  let tenantName: string | null = null;
  let siteSlug: string | null = null;
  let siteActive: boolean | null = null;
  let pipelineName: string | null = null;
  let stageCount = 0;
  let keyPrefix: string | null = null;
  let keyLabel: string | null = null;

  if (row.tenantId) {
    const tenant = await getTenant(row.tenantId);
    tenantName = tenant?.name ?? null;

    const ctx = await buildSystemTenantContext(row.tenantId);
    if (ctx) {
      if (row.siteId) {
        const site = await getSite(ctx, row.siteId);
        siteSlug = site?.slug ?? null;
        siteActive = site?.isActive ?? null;
      }
      if (row.pipelineId) {
        const pipeline = await getPipeline(ctx, row.pipelineId);
        pipelineName = pipeline?.name ?? null;
        stageCount = (await listStagesForPipeline(ctx, row.pipelineId)).length;
      }
      if (row.apiKeyId && row.siteId) {
        const key = (await listApiKeys(ctx, row.siteId)).find((k) => k.id === row.apiKeyId);
        keyPrefix = key?.apiKeyPrefix ?? null;
        keyLabel = key?.label ?? null;
      }
    }
  }

  return { row, tenantName, siteSlug, siteActive, pipelineName, stageCount, keyPrefix, keyLabel };
}

export function listOpsBatchesForConsole() {
  return listAllOpsBatches();
}

/**
 * How many rows are enriched at once.
 *
 * `Promise.all(rows.map(enrichOpsRow))` is the obvious way to write this and
 * it does not survive a real batch: each row opens its own tenant context and
 * runs half a dozen queries, so N rows put ~6N queries in flight at once. The
 * pool is deliberately small — `connectionLimit: 6`, `queueLimit: 24` in
 * src/db/client.ts, sized against Hostinger's per-user connection ceiling —
 * and past those 30 mysql2 does not wait, it rejects. A console that renders
 * fine for five rows then throws for fifty is exactly the failure that shape
 * produces, and it lands on the page whose whole job is approving a bulk run.
 *
 * Four keeps a batch of any size inside the pool with room for the rest of
 * the request, at a cost of a few hundred milliseconds on a large page.
 */
const ENRICH_CONCURRENCY = 4;

/** Maps with a bounded number of workers, preserving input order. */
async function enrichAll(rows: OpsRow[]): Promise<OpsRowView[]> {
  const views = new Array<OpsRowView>(rows.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= rows.length) return;
      views[index] = await enrichOpsRow(rows[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, rows.length) }, worker),
  );
  return views;
}

export async function getBatchRowViews(batchId: string): Promise<OpsRowView[]> {
  return enrichAll(await listRowsForBatch(batchId));
}

export async function listNeedsYouViews(): Promise<OpsRowView[]> {
  return enrichAll(await listRowsAwaitingOwner());
}

/** Every audit row a Claude Ops call — token-driven or console-driven —
 * wrote, newest first. Filters on the `via` marker both writers set
 * (`ops_token:<prefix>` and `console:<userId>`), the same idea the rest of
 * the platform uses to tell an impersonated action apart in the log. */
export async function listOpsAuditEntries(
  limit = 200,
): Promise<Awaited<ReturnType<typeof listAuditLog>>> {
  const entries = await listAuditLog(limit);
  return entries.filter((entry) => {
    const via = (entry.payload as Record<string, unknown> | null)?.via;
    return typeof via === "string" && (via.startsWith("ops_token:") || via.startsWith("console:"));
  });
}
