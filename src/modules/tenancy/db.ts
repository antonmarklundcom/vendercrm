import { and, count as countRows, eq, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import { db } from "@/db/client";
import type { TenantContext } from "./context";

// Scoped data access (PLAN.md §3.3, layer 2). Every module service takes a
// TenantContext as its first argument and reaches the database only through
// this wrapper, which auto-injects `eq(table.tenantId, ctx.tenantId)` into
// every read/write. Raw `db` import is lint-banned outside src/db,
// src/worker, and this module (eslint.config.mjs).

type TenantScopedTable = MySqlTable & { tenantId: AnyMySqlColumn };

/** `db` or an open transaction — both expose the same query-builder surface. */
type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

function tenantFilter<T extends TenantScopedTable>(
  table: T,
  tenantId: string,
  extra?: SQL,
): SQL {
  const scoped = eq(table.tenantId, tenantId);
  return extra ? (and(scoped, extra) as SQL) : scoped;
}

export type TenantDb = ReturnType<typeof tenantDb>;

/**
 * Grace-state write enforcement (PLAN.md §10 1C follow-up #1): every
 * mutating tenant service goes through tenantDb's insert/update/delete, so
 * gating them here is the single choke point — grace/locked tenants become
 * read-only at the write path itself, not just the UI banner. Exported for
 * the handful of tenancy-module writes that can't go through tenantDb
 * itself (e.g. `tenants` — a platform table keyed by its own id, not a
 * `tenant_id` column) but still need to honor the same policy.
 */
export function assertTenantWritable(ctx: TenantContext): void {
  if (ctx.accessStatus !== "active") {
    throw new Error(
      `Tenant is not writable (accessStatus: ${ctx.accessStatus})`,
    );
  }
}

function scopedBuilder(ctx: TenantContext, executor: Executor) {
  return {
    /** SELECT ... FROM table WHERE tenant_id = ctx.tenantId [AND extra] */
    select<T extends TenantScopedTable>(table: T, extra?: SQL) {
      return executor
        .select()
        .from(table)
        .where(tenantFilter(table, ctx.tenantId, extra));
    },

    /**
     * SELECT COUNT(*) ... WHERE tenant_id = ctx.tenantId [AND extra] — added
     * for SQL-side pagination (PLAN.md §15.8 P5): `select()` above has no
     * column projection, so a page's total row count without fetching every
     * row needs its own aggregate query rather than `rows.length` after an
     * unbounded read.
     */
    async count<T extends TenantScopedTable>(table: T, extra?: SQL): Promise<number> {
      const [row] = await executor
        .select({ value: countRows() })
        .from(table)
        .where(tenantFilter(table, ctx.tenantId, extra));
      return row?.value ?? 0;
    },

    /** SELECT ... FOR UPDATE — row lock, only meaningful inside a transaction. */
    selectForUpdate<T extends TenantScopedTable>(table: T, extra?: SQL) {
      return executor
        .select()
        .from(table)
        .where(tenantFilter(table, ctx.tenantId, extra))
        .for("update");
    },

    /** INSERT INTO table VALUES { ...values, tenant_id: ctx.tenantId } */
    insert<T extends TenantScopedTable>(table: T) {
      return {
        values: (values: Omit<T["$inferInsert"], "tenantId">) => {
          assertTenantWritable(ctx);
          return executor.insert(table).values({
            ...values,
            tenantId: ctx.tenantId,
          } as T["$inferInsert"]);
        },
      };
    },

    /** UPDATE table SET values WHERE tenant_id = ctx.tenantId [AND extra] */
    update<T extends TenantScopedTable>(table: T) {
      return {
        set: (values: Partial<T["$inferInsert"]>) => ({
          where: (extra?: SQL) => {
            assertTenantWritable(ctx);
            return executor
              .update(table)
              .set(values)
              .where(tenantFilter(table, ctx.tenantId, extra));
          },
        }),
      };
    },

    /** DELETE FROM table WHERE tenant_id = ctx.tenantId [AND extra] */
    delete<T extends TenantScopedTable>(table: T, extra?: SQL) {
      assertTenantWritable(ctx);
      return executor.delete(table).where(tenantFilter(table, ctx.tenantId, extra));
    },

    /** Escape hatch for callers building their own query (joins, etc.) that
     * still need the mandatory tenant predicate — never build a WHERE
     * clause on a tenant-owned table without composing this in. */
    where<T extends TenantScopedTable>(table: T, extra?: SQL): SQL {
      return tenantFilter(table, ctx.tenantId, extra);
    },
  };
}

export function tenantDb(ctx: TenantContext) {
  return scopedBuilder(ctx, db);
}

/**
 * Runs `fn` inside a database transaction with the same tenant-scoped
 * builder. Modules need this for read-modify-write sequences that must be
 * atomic — per-tenant quote numbering above all (§8, "incremented in a
 * transaction"). It lives here rather than in the calling module so the
 * raw-`db` ban stays intact everywhere else: callers get transactions
 * without ever holding an unscoped client.
 */
export function tenantTransaction<T>(
  ctx: TenantContext,
  fn: (tx: ReturnType<typeof scopedBuilder>) => Promise<T>,
): Promise<T> {
  return db.transaction((tx) => fn(scopedBuilder(ctx, tx as unknown as Executor)));
}
