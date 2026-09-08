import { writeAuditLog } from "@/modules/tenancy/audit";
import type { OpsRow } from "./batches";
import type { OpsTokenRow } from "./tokens";

// Every ops call is an ordinary audit entry (PLAN.md §18.1.6) — there is no
// second trail. The actor is the token's owner, because a token is a
// credential rather than an identity; `payload.via` carries the prefix, which
// is what the Claude Ops log filters on and what tells the owner *which* of
// his PCs did this.

export function opsVia(token: OpsTokenRow): string {
  return `ops_token:${token.tokenPrefix}`;
}

export async function writeOpsAudit(
  token: OpsTokenRow,
  row: OpsRow | null,
  entry: {
    tenantId?: string | null;
    action: string;
    entity: string;
    entityId: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog({
    tenantId: entry.tenantId ?? null,
    actorUserId: token.ownerUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    payload: {
      ...(entry.payload ?? {}),
      via: opsVia(token),
      batch_id: row?.batchId ?? null,
      row_id: row?.id ?? null,
    },
  });
}
