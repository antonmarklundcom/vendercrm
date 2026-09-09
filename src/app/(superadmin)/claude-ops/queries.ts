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

export async function getBatchRowViews(batchId: string): Promise<OpsRowView[]> {
  const rows = await listRowsForBatch(batchId);
  return Promise.all(rows.map(enrichOpsRow));
}

export async function listNeedsYouViews(): Promise<OpsRowView[]> {
  const rows = await listRowsAwaitingOwner();
  return Promise.all(rows.map(enrichOpsRow));
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
