import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { SessionContext } from "@/modules/tenancy/types";

// The audit module writes platform-level trail rows. It uses raw `db` on
// purpose: audit rows are keyed by an explicit tenantId argument (often the
// acting superadmin's target, which may differ from any request tenant scope),
// so they must not go through tenantDb. Kept on the raw-db allowlist via the
// tenancy sibling isn't needed here — audit only ever writes its own table and
// never reads tenant data, so it's added to the ESLint allowlist explicitly.

export type AuditEntry = {
  action: string;
  tenantId?: string | null;
  entity?: string;
  entityId?: string;
  payload?: unknown;
};

// Derives actor + impersonator from the session context so every impersonated
// action is recorded with both the effective and the real user (PLAN.md §3.2).
export async function audit(
  ctx: Pick<SessionContext, "userId" | "impersonatorUserId">,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    tenantId: entry.tenantId ?? null,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    payload: entry.payload === undefined ? null : (entry.payload as object),
  });
}
