import { mysqlTable, char, datetime, index, uniqueIndex } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Per-user site access (PLAN.md §5.2). The owner's network is one tenant
// with many sites, so tenant scoping alone cannot express "this dentist
// client sees only dentista.com.py". A user with no rows here is
// unrestricted; rows narrow them to exactly those sites.
export const userSites = mysqlTable(
  "user_sites",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    userId: char("user_id", { length: 26 }).notNull(),
    siteId: char("site_id", { length: 26 }).notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("user_sites_tenant_id_idx").on(table.tenantId),
    index("user_sites_user_id_idx").on(table.userId),
    uniqueIndex("user_sites_user_site_idx").on(table.userId, table.siteId),
  ],
);
