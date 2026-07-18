import { and, eq, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import { db as rawDb } from "@/db/client";
import type { TenantContext } from "./context";

type TenantScopedTable = MySqlTable & { tenantId: AnyMySqlColumn };

/**
 * The sanctioned data-access layer for tenant-scoped tables. Every operation
 * forces the `tenant_id` filter from `ctx` — callers cannot construct a query
 * against a tenant-scoped table that omits it. `ctx` must come from
 * `getTenantContext()`.
 */
export function tenantDb(ctx: TenantContext) {
  function scope<T extends TenantScopedTable>(table: T, extra?: SQL): SQL {
    const tenantFilter = eq(table.tenantId, ctx.tenantId);
    return extra ? and(tenantFilter, extra)! : tenantFilter;
  }

  return {
    /** Builds a `tenant_id = ctx.tenantId [AND ...extra]` where-clause for ad-hoc queries. */
    scope,

    async findMany<T extends TenantScopedTable>(table: T, where?: SQL) {
      return rawDb
        .select()
        .from(table)
        .where(scope(table, where));
    },

    async findFirst<T extends TenantScopedTable>(table: T, where?: SQL) {
      const [row] = await rawDb.select().from(table).where(scope(table, where)).limit(1);
      return row ?? null;
    },

    // Not `async` on purpose: the return value is drizzle's query builder,
    // which callers may chain further (e.g. `.$returningId()`) before it's
    // awaited. Wrapping it in an async function would collapse it into a
    // plain Promise and break that chaining.
    insert<T extends TenantScopedTable>(
      table: T,
      values: Omit<T["$inferInsert"], "tenantId">,
    ) {
      return rawDb.insert(table).values({ ...values, tenantId: ctx.tenantId } as T["$inferInsert"]);
    },

    update<T extends TenantScopedTable>(
      table: T,
      set: Partial<T["$inferInsert"]>,
      where?: SQL,
    ) {
      return rawDb.update(table).set(set).where(scope(table, where));
    },

    delete<T extends TenantScopedTable>(table: T, where?: SQL) {
      return rawDb.delete(table).where(scope(table, where));
    },
  };
}
