import { and, desc, eq, gte, like, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, tenants, users } from "@/db/schema";
import { newId } from "@/lib/ids";

// Audit trail writer (PLAN.md §3.2, §4). Every impersonated action is
// recorded with both the real actor (impersonatorUserId) and the effective
// user (actorUserId) — this module is one of the few allowed raw-db callers
// (eslint.config.mjs), same as the rest of src/modules/tenancy.

export type AuditEntry = {
  tenantId?: string | null;
  actorUserId: string;
  impersonatorUserId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  payload?: Record<string, unknown>;
};

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    tenantId: entry.tenantId ?? null,
    actorUserId: entry.actorUserId,
    impersonatorUserId: entry.impersonatorUserId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    payload: entry.payload ?? {},
  });
}

export async function listAuditLogForTenant(tenantId: string, limit = 50) {
  const rows = await db
    .select({ entry: auditLog, actorEmail: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row.entry, actorEmail: row.actorEmail ?? null }));
}

/**
 * Platform-wide audit feed for the superadmin console (PLAN.md §13 H4). The
 * tenant-scoped reader above is what a tenant admin sees; this one exists
 * precisely to look across tenants, so it takes no tenant id — its only
 * caller is behind requireSuperadminContext().
 *
 * Rows are raw on purpose (comment on AuditTable), but raw ids are still
 * useless to the superadmin scanning the feed — hence the joins to the
 * business name and the actor's e-mail here rather than a client-side
 * lookup per row.
 */
export type AuditLogFilters = {
  tenantId?: string;
  /** Substring match on the action column, e.g. "payment" for every
   * payment.* action. */
  action?: string;
  actorEmail?: string;
  from?: Date;
  to?: Date;
};

export const AUDIT_LOG_PAGE_SIZE = 50;

export async function listAuditLog(
  filters: AuditLogFilters = {},
  { limit = AUDIT_LOG_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
) {
  const where = auditLogWhere(filters);

  const rows = await db
    .select({ entry: auditLog, tenantName: tenants.name, actorEmail: users.email })
    .from(auditLog)
    .leftJoin(tenants, eq(tenants.id, auditLog.tenantId))
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...row.entry,
    tenantName: row.tenantName ?? null,
    actorEmail: row.actorEmail ?? null,
  }));
}

/** Total rows matching the filters, for pagination — the same `where` as
 * listAuditLog above, counted rather than fetched. */
export async function countAuditLog(filters: AuditLogFilters = {}): Promise<number> {
  const where = auditLogWhere(filters);
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(auditLog)
    .where(where);
  return Number(row?.value ?? 0);
}

function auditLogWhere(filters: AuditLogFilters): SQL | undefined {
  const clauses: SQL[] = [];
  if (filters.tenantId) clauses.push(eq(auditLog.tenantId, filters.tenantId));
  if (filters.action) clauses.push(like(auditLog.action, `%${filters.action}%`));
  if (filters.actorEmail) {
    // Filtering by e-mail rather than user id needs the join above; a
    // subquery keeps this function usable for both the list and the count.
    clauses.push(
      sql`${auditLog.actorUserId} in (select ${users.id} from ${users} where ${users.email} like ${`%${filters.actorEmail}%`})`,
    );
  }
  if (filters.from) clauses.push(gte(auditLog.createdAt, filters.from));
  if (filters.to) clauses.push(lte(auditLog.createdAt, filters.to));
  return clauses.length > 0 ? and(...clauses) : undefined;
}
