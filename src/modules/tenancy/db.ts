import { and, eq, type SQL, type InferInsertModel } from "drizzle-orm";
import { MySqlTable, type MySqlColumn } from "drizzle-orm/mysql-core";
import { db } from "@/db/client";
import type { TenantContext } from "./types";

// A table that participates in tenant isolation: it must expose a `tenantId`
// column. The generic constraint means passing a non-tenant table to tenantDb
// is a compile error, not a runtime surprise.
export type TenantScopedTable = MySqlTable & { tenantId: MySqlColumn };

// Insert values with tenantId removed. Written as a homomorphic (key-remapped)
// mapped type rather than `Omit<…>` so excess-property checking still fires on
// object literals passed through the generic insert methods — a plain
// `Omit<InferInsertModel<T>, "tenantId">` silently loses that check.
type WithoutTenantId<T extends TenantScopedTable> = {
  [K in keyof InferInsertModel<T> as K extends "tenantId" ? never : K]: InferInsertModel<T>[K];
};

// The scoped data-access layer (PLAN.md §3.3, layer 2). Every query built here
// auto-injects `eq(table.tenantId, ctx.tenantId)`; callers cannot widen it.
// Additional filters are AND-ed onto the tenant scope, never replace it.
//
// Raw `db` is lint-banned outside src/db|worker|lib/queue|modules/{tenancy,auth},
// so tenant modules physically cannot bypass this layer.
export class TenantDb {
  constructor(private readonly ctx: TenantContext) {}

  get tenantId(): string {
    return this.ctx.tenantId;
  }

  private scope(table: TenantScopedTable): SQL {
    return eq(table.tenantId, this.ctx.tenantId);
  }

  select<T extends TenantScopedTable>(table: T, where?: SQL) {
    const scope = this.scope(table);
    return db
      .select()
      .from(table)
      .where(where ? and(scope, where) : scope);
  }

  // Force tenantId onto the inserted row — a caller-supplied tenantId is
  // overwritten, never trusted.
  insert<T extends TenantScopedTable>(
    table: T,
    values: WithoutTenantId<T>,
  ) {
    return this.insertMany(table, [values]);
  }

  insertMany<T extends TenantScopedTable>(
    table: T,
    values: WithoutTenantId<T>[],
  ) {
    const rows = values.map((v) => ({
      ...v,
      tenantId: this.ctx.tenantId,
    })) as InferInsertModel<T>[];
    return db.insert(table).values(rows);
  }

  update<T extends TenantScopedTable>(
    table: T,
    set: Partial<InferInsertModel<T>>,
    where?: SQL,
  ) {
    const scope = this.scope(table);
    // Guard against a caller trying to move a row into another tenant.
    const { tenantId: _dropped, ...safeSet } = set as Record<string, unknown>;
    void _dropped;
    return db
      .update(table)
      .set(safeSet as Partial<InferInsertModel<T>>)
      .where(where ? and(scope, where) : scope);
  }

  delete<T extends TenantScopedTable>(table: T, where?: SQL) {
    const scope = this.scope(table);
    return db.delete(table).where(where ? and(scope, where) : scope);
  }
}

export function tenantDb(ctx: TenantContext): TenantDb {
  return new TenantDb(ctx);
}
