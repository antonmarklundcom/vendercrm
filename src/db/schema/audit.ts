import { mysqlTable, char, varchar, json, datetime, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { generateId } from "@/lib/ids";

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 }),
    actorUserId: char("actor_user_id", { length: 26 }).notNull(),
    impersonatorUserId: char("impersonator_user_id", { length: 26 }),
    action: varchar("action", { length: 100 }).notNull(),
    entity: varchar("entity", { length: 100 }).notNull(),
    entityId: char("entity_id", { length: 26 }),
    payload: json("payload").$type<Record<string, unknown>>(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_log_tenant_id_idx").on(table.tenantId),
    index("audit_log_actor_user_id_idx").on(table.actorUserId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ],
);
