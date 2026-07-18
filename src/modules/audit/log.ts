import { db } from "@/db/client";
import { auditLog } from "@/db/schema/audit";

export type AuditLogEntry = {
  tenantId?: string | null;
  actorUserId: string;
  impersonatorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Writes an audit trail row. Bypasses tenant scoping on purpose — audit
 * entries span both platform-level actions (tenantId null) and
 * impersonated tenant actions, and are never read back through tenantDb.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.insert(auditLog).values({
    tenantId: entry.tenantId ?? null,
    actorUserId: entry.actorUserId,
    impersonatorUserId: entry.impersonatorUserId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    payload: entry.payload ?? null,
  });
}
