import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db/client";
import { storage } from "@/lib/storage";
import type { SuperadminContext } from "./context";
import { writeAuditLog } from "./audit";
import { getTenant } from "./tenants";

// Hard deletion of businesses (tenants) and everything under them.
//
// Suspending is the everyday tool and stays the reversible one; this exists
// for businesses that should never have existed — demos, trials, test runs.
// Two callers: scripts/purge-tenants.ts (wipe the whole server) and the
// "Eliminar empresa" danger zone on the console's tenant page (one at a time,
// behind a typed confirmation).
//
// Tenant data carries `tenant_id` without foreign keys (§3.3), so there is no
// cascade to lean on. The tables are found by asking information_schema for
// every `tenant_id` column instead of from a list kept here: a table added
// later is swept too, rather than silently left behind as orphans.
//
// Users are NOT deleted here. A person can belong to several businesses, and
// the one being deleted may be the least of them; losing the membership is
// what removes their access. Their active-business pointer is cleared when it
// pointed here. The whole-server script deletes users separately.

/** Tables this module handles by hand rather than by the tenant_id sweep. */
const HANDLED_BY_HAND = new Set(["users", "tenants"]);

/**
 * Every kind of file a business can own in storage, one prefix segment per
 * kind. Every writer builds its key as `<kind>/<tenantId>/...`
 * (storeDocumentPdf in modules/renderable-document/delivery.ts, and
 * whatsapp-media's own key in modules/whatsapp/webhook.ts) — never
 * `tenants/<id>/...` — so there is no single prefix that covers a business's
 * files, only one prefix per kind.
 *
 * Unlike tenantScopedTables() above, storage has no information_schema to
 * introspect this list from, so it is kept in sync by hand: a new document
 * kind (a new call to storeDocumentPdf or storage.put) needs its prefix
 * added here too, or its files outlive the business that owned them.
 */
const STORAGE_KINDS = [
  "quotes",
  "documents",
  "receipts",
  "contracts",
  "contracts-signed",
  "whatsapp-media",
  "memory-imports",
];

export type StorageCleanupResult = { deleted: number; failed: number };

/**
 * Deletes every stored file under the given businesses. Best-effort and
 * never throws: called only after the row deletion has already committed, so
 * a storage outage must not look like — or cause — the deletion failing.
 * Callers log the counts in their audit entry rather than surfacing them to
 * the actor, since there is nothing left to retry from the console.
 */
export async function purgeTenantStorage(tenantIds: string[]): Promise<StorageCleanupResult> {
  let deleted = 0;
  let failed = 0;
  for (const tenantId of tenantIds) {
    for (const kind of STORAGE_KINDS) {
      try {
        const result = await storage.deletePrefix(`${kind}/${tenantId}/`);
        deleted += result.deleted;
        failed += result.failed;
      } catch (err) {
        failed += 1;
        console.error(`tenancy/purge: storage cleanup failed for ${kind}/${tenantId}/`, err);
      }
    }
  }
  return { deleted, failed };
}

async function select<T>(conn: PoolConnection, sql: string, params: unknown[] = []) {
  const [result] = await conn.query<RowDataPacket[]>(sql, params);
  return result as unknown as T[];
}

/** Every table with a `tenant_id` column, except users and tenants. */
export async function tenantScopedTables(conn: PoolConnection): Promise<string[]> {
  const found = await select<{ name: string }>(
    conn,
    `SELECT DISTINCT TABLE_NAME AS name FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'
     ORDER BY TABLE_NAME`,
  );
  return found.map((r) => r.name).filter((name) => !HANDLED_BY_HAND.has(name));
}

/** Row counts per table for the given businesses, non-zero only. */
export async function countTenantRows(
  conn: PoolConnection,
  tenantIds: string[],
): Promise<Array<{ table: string; rows: number }>> {
  if (tenantIds.length === 0) return [];
  const counts: Array<{ table: string; rows: number }> = [];
  for (const table of await tenantScopedTables(conn)) {
    const [row] = await select<{ n: number }>(
      conn,
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE tenant_id IN (?)`,
      [tenantIds],
    );
    const n = Number(row?.n ?? 0);
    if (n > 0) counts.push({ table, rows: n });
  }
  return counts;
}

/**
 * Deletes the given businesses and every row that belongs to them. Runs on
 * the caller's connection and does not open a transaction itself, so the
 * caller decides the boundary (the script wraps this and its user cleanup in
 * one).
 */
export async function purgeTenantRows(conn: PoolConnection, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;

  // payments hang off subscriptions and carry no tenant_id of their own.
  await conn.query(
    `DELETE FROM payments WHERE subscription_id IN
       (SELECT id FROM subscriptions WHERE tenant_id IN (?))`,
    [tenantIds],
  );

  // Claude Ops rows are swept with the rest (they carry tenant_id); note which
  // ones first, so the guard's memory of them and any batch they leave empty
  // can go too — and nothing belonging to another business's batch.
  const opsRows = await select<{ id: string; batch_id: string }>(
    conn,
    "SELECT id, batch_id FROM ops_batch_rows WHERE tenant_id IN (?)",
    [tenantIds],
  );

  for (const table of await tenantScopedTables(conn)) {
    await conn.query(`DELETE FROM \`${table}\` WHERE tenant_id IN (?)`, [tenantIds]);
  }

  if (opsRows.length > 0) {
    await conn.query("DELETE FROM ops_objects WHERE row_id IN (?)", [opsRows.map((r) => r.id)]);
    await conn.query(
      `DELETE FROM ops_batches WHERE id IN (?)
         AND id NOT IN (SELECT DISTINCT batch_id FROM ops_batch_rows)`,
      [[...new Set(opsRows.map((r) => r.batch_id))]],
    );
  }
  await conn.query("DELETE FROM ops_objects WHERE entity = 'tenant' AND entity_id IN (?)", [
    tenantIds,
  ]);

  // Ops token allowlists name tenants by id.
  const tokens = await select<{ id: string; allowed: unknown }>(
    conn,
    "SELECT id, allowed_tenant_ids AS allowed FROM ops_tokens",
  );
  const doomed = new Set(tenantIds);
  for (const token of tokens) {
    const list = parseIdList(token.allowed);
    const kept = list.filter((id) => !doomed.has(id));
    if (kept.length !== list.length) {
      await conn.query("UPDATE ops_tokens SET allowed_tenant_ids = ? WHERE id = ?", [
        JSON.stringify(kept),
        token.id,
      ]);
    }
  }

  await conn.query("UPDATE users SET tenant_id = NULL WHERE tenant_id IN (?)", [tenantIds]);
  await conn.query("DELETE FROM tenants WHERE id IN (?)", [tenantIds]);
}

function parseIdList(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The console's "Eliminar empresa": one business, in one transaction, with a
 * platform-level audit entry (tenant_id NULL — the business's own audit rows
 * go with it, so the record of the deletion has to live outside it). Once
 * that transaction commits, the business's uploaded files are swept from
 * storage too (best-effort — see purgeTenantStorage) and the counts land in
 * that same audit entry's payload.
 */
export async function deleteTenant(ctx: SuperadminContext, tenantId: string): Promise<boolean> {
  const tenant = await getTenant(tenantId);
  if (!tenant) return false;

  const conn = await pool.getConnection();
  let counts: Array<{ table: string; rows: number }>;
  try {
    counts = await countTenantRows(conn, [tenantId]);
    await conn.beginTransaction();
    await purgeTenantRows(conn, [tenantId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  // Storage is cleaned up after the commit, deliberately outside the
  // transaction above: an object store has no rollback to join, and a
  // failure here must delete nothing it already deleted, not undo rows that
  // are already gone.
  const files = await purgeTenantStorage([tenantId]);

  await writeAuditLog({
    tenantId: null,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "tenant.deleted",
    entity: "tenant",
    entityId: tenantId,
    payload: {
      name: tenant.name,
      slug: tenant.slug,
      rows: Object.fromEntries(counts.map((c) => [c.table, c.rows])),
      files,
    },
  });
  return true;
}

// --- Whole-server wipe (scripts/purge-tenants.ts) ---------------------------

export type ServerPurgePlan = {
  keptUsers: Array<{ id: string; email: string; isSuperadmin: boolean }>;
  deletedUsers: string[];
  tenants: Array<{ id: string; name: string; slug: string }>;
  /** Every site domain with its business's name — the re-provisioning list. */
  domains: Array<{ domain: string; businessName: string }>;
  tenantsWithoutDomain: Array<{ name: string; slug: string }>;
  rows: Array<{ table: string; rows: number }>;
};

export class ServerPurgeError extends Error {}

/** Reads what a wipe would do. Changes nothing. */
export async function planServerPurge(keepEmails: string[]): Promise<ServerPurgePlan> {
  const conn = await pool.getConnection();
  try {
    const keep = keepEmails.map((e) => e.trim().toLowerCase());
    const kept = await select<{ id: string; email: string; is_superadmin: number }>(
      conn,
      `SELECT id, email, is_superadmin FROM users
       WHERE is_superadmin = 1 ${keep.length ? "OR LOWER(email) IN (?)" : ""}`,
      keep.length ? [keep] : [],
    );
    const missing = keep.filter((e) => !kept.some((u) => u.email.toLowerCase() === e));
    if (missing.length > 0) {
      // A typo here would delete the very account that was meant to stay.
      throw new ServerPurgeError(`No user with e-mail: ${missing.join(", ")}`);
    }
    if (!kept.some((u) => u.is_superadmin)) {
      throw new ServerPurgeError("No superadmin would survive this");
    }

    const tenants = await select<{ id: string; name: string; slug: string }>(
      conn,
      "SELECT id, name, slug FROM tenants ORDER BY name",
    );
    const sites = await select<{ tenant_id: string; domain: string }>(
      conn,
      "SELECT tenant_id, domain FROM sites WHERE domain IS NOT NULL AND domain <> ''",
    );
    const deleted = await select<{ email: string }>(
      conn,
      "SELECT email FROM users WHERE id NOT IN (?) ORDER BY email",
      [kept.map((u) => u.id)],
    );

    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const seen = new Set<string>();
    const domains: ServerPurgePlan["domains"] = [];
    for (const site of sites) {
      const domain = site.domain.trim().toLowerCase();
      if (seen.has(domain)) continue;
      seen.add(domain);
      domains.push({ domain, businessName: nameOf.get(site.tenant_id) ?? "" });
    }
    domains.sort((a, b) => a.domain.localeCompare(b.domain));

    return {
      keptUsers: kept.map((u) => ({ id: u.id, email: u.email, isSuperadmin: Boolean(u.is_superadmin) })),
      deletedUsers: deleted.map((u) => u.email),
      tenants,
      domains,
      tenantsWithoutDomain: tenants
        .filter((t) => !sites.some((s) => s.tenant_id === t.id))
        .map((t) => ({ name: t.name, slug: t.slug })),
      rows: await countTenantRows(conn, tenants.map((t) => t.id)),
    };
  } finally {
    conn.release();
  }
}

/**
 * Deletes every business in the plan, every user not kept (with their
 * sessions and logins) and all Claude Ops history, in one transaction. Ops
 * tokens stay, allowlists emptied, so the re-provisioning run can use one.
 * Once that commits, every business's uploaded files (quote/document/contract
 * PDFs, WhatsApp media, memory-import PDFs) are swept from storage too —
 * best-effort, see purgeTenantStorage — and the counts are returned for the
 * caller to report.
 */
export async function executeServerPurge(plan: ServerPurgePlan): Promise<StorageCleanupResult> {
  const keptIds = plan.keptUsers.map((u) => u.id);
  const actor = plan.keptUsers.find((u) => u.isSuperadmin);
  if (!actor) throw new ServerPurgeError("No superadmin would survive this");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await purgeTenantRows(conn, plan.tenants.map((t) => t.id));
    // Rows that failed before a business existed point at nothing either.
    await conn.query("DELETE FROM ops_objects");
    await conn.query("DELETE FROM ops_batch_rows");
    await conn.query("DELETE FROM ops_batches");
    await conn.query("DELETE FROM sessions WHERE user_id NOT IN (?)", [keptIds]);
    await conn.query("DELETE FROM accounts WHERE user_id NOT IN (?)", [keptIds]);
    await conn.query("DELETE FROM users WHERE id NOT IN (?)", [keptIds]);
    // No business left means no active business and no tenant role to mirror.
    await conn.query(
      "UPDATE users SET tenant_id = NULL, role = IF(is_superadmin = 1, 'superadmin', NULL)",
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  // Same rule as deleteTenant: after the commit, best-effort, never able to
  // fail or roll back a wipe that has already happened.
  const files = await purgeTenantStorage(plan.tenants.map((t) => t.id));

  await writeAuditLog({
    tenantId: null,
    actorUserId: actor.id,
    action: "platform.purged",
    entity: "tenant",
    entityId: "all",
    payload: {
      via: "script:purge-tenants",
      tenants: plan.tenants.length,
      users: plan.deletedUsers.length,
      files,
    },
  });
  return files;
}
