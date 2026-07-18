import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  int,
  mysqlEnum,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { generateId } from "@/lib/ids";

export const jobStatusEnum = ["pending", "running", "done", "failed", "dead"] as const;
export type JobStatus = (typeof jobStatusEnum)[number];

export const jobs = mysqlTable(
  "jobs",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    type: varchar("type", { length: 100 }).notNull(),
    payload: json("payload").notNull(),
    tenantId: char("tenant_id", { length: 26 }),
    runAt: datetime("run_at").notNull(),
    status: mysqlEnum("status", jobStatusEnum).notNull().default("pending"),
    attempts: int("attempts").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(5),
    lockedAt: datetime("locked_at"),
    lockedBy: varchar("locked_by", { length: 64 }),
    lastError: varchar("last_error", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
    index("jobs_tenant_id_idx").on(table.tenantId),
  ],
);
