import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Platform-level audit trail (PLAN.md §3.2/§3.3). Every impersonated action is
// written with both the real (impersonator) and effective (actor) user.
// tenant_id is nullable so platform-level actions are captured too, and so the
// log can be filtered per tenant.
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }),
    actorUserId: char("actor_user_id", { length: 26 }),
    impersonatorUserId: char("impersonator_user_id", { length: 26 }),
    action: varchar("action", { length: 100 }).notNull(),
    entity: varchar("entity", { length: 100 }),
    entityId: char("entity_id", { length: 26 }),
    payload: json("payload"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_log_tenant_id_idx").on(table.tenantId),
    index("audit_log_actor_idx").on(table.actorUserId),
  ],
);
