import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { opsTokens } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { SuperadminContext } from "@/modules/tenancy/context";

// Ops tokens (PLAN.md §18.1.1). The credential a Claude Code session on the
// owner's PC sends as `X-Ops-Token`.
//
// Hashing, prefix and last-used bookkeeping are `modules/sites/keys.ts`'s,
// deliberately: it is the same problem (a machine-held 32-byte secret that is
// compared, never read back) and a second scheme would be a second thing to
// get wrong. SHA-256 rather than a slow KDF for the same reason as there —
// CSPRNG output has no dictionary to defend against.

const TOKEN_PREFIX = "vc_ops_";

export type OpsTokenRow = typeof opsTokens.$inferSelect;

export type GeneratedOpsToken = {
  /** Full token — returned exactly once, at creation, and never stored. */
  plaintext: string;
  hash: string;
  displayPrefix: string;
};

export function generateOpsToken(): GeneratedOpsToken {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    hash: hashOpsToken(plaintext),
    displayPrefix: plaintext.slice(0, 16),
  };
}

export function hashOpsToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export type CreateOpsTokenInput = {
  label: string;
  /** Existing tenants this token may add new sites to (§18.1.3). */
  allowedTenantIds?: string[];
  expiresAt?: Date | null;
};

export type CreatedOpsToken = {
  id: string;
  /** Shown once, in the creation response. There is nothing to fetch later. */
  plaintext: string;
  prefix: string;
};

/**
 * Only a superadmin may mint one, and the token acts as that superadmin
 * forever after — which is why `ownerUserId` is taken from the context and
 * never from an argument.
 */
export async function createOpsToken(
  ctx: SuperadminContext,
  input: CreateOpsTokenInput,
): Promise<CreatedOpsToken> {
  const token = generateOpsToken();
  const id = newId();

  await db.insert(opsTokens).values({
    id,
    ownerUserId: ctx.userId,
    label: input.label,
    tokenHash: token.hash,
    tokenPrefix: token.displayPrefix,
    allowedTenantIds: input.allowedTenantIds ?? [],
    expiresAt: input.expiresAt ?? null,
  });

  return { id, plaintext: token.plaintext, prefix: token.displayPrefix };
}

/**
 * How stale `last_used_at` may get before it is written again — the same
 * throttle `site_api_keys` uses, for the same reason. `call_count` is
 * incremented on every call regardless: it is the number the owner reads to
 * see whether a token he forgot about is still being used, and a throttled
 * counter would understate exactly the case worth noticing.
 */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Resolves a presented token to its row, or null. Runs before any context
 * exists, so it is one of this module's raw-db reads (see eslint.config.mjs).
 *
 * Revoked and expired tokens resolve to null — the endpoints turn that into
 * a 401, and no caller ever learns whether the token merely expired.
 */
export async function resolveOpsToken(plaintext: string | null): Promise<OpsTokenRow | null> {
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) return null;

  const hash = hashOpsToken(plaintext);
  const [row] = await db.select().from(opsTokens).where(eq(opsTokens.tokenHash, hash));
  if (!row) return null;

  // Belt-and-braces against a storage layer that returns a near-match, as in
  // modules/sites/keys.ts.
  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  await touchOpsToken(row);
  return row;
}

async function touchOpsToken(row: OpsTokenRow): Promise<void> {
  const now = Date.now();
  const stale = !row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;

  try {
    await db
      .update(opsTokens)
      .set({
        callCount: sql`${opsTokens.callCount} + 1`,
        ...(stale ? { lastUsedAt: new Date(now) } : {}),
      })
      .where(eq(opsTokens.id, row.id));
  } catch {
    // Best-effort bookkeeping: a failed counter write must never cost the
    // owner a provisioning call.
  }
}

/**
 * Superadmin console reads (the O2 page). Never exposes a hash — and, like
 * `listTenants()`, they take no context argument: their only callers are
 * server actions that have already passed `requireSuperadminContext()`.
 */
export type OpsTokenSummary = Omit<OpsTokenRow, "tokenHash">;

function summarize({ tokenHash, ...rest }: OpsTokenRow): OpsTokenSummary {
  // `tokenHash` is destructured out and deliberately not referenced: it is
  // the one field these console reads must never hand upward.
  void tokenHash;
  return rest;
}

export async function listOpsTokens(): Promise<OpsTokenSummary[]> {
  const rows = await db.select().from(opsTokens).orderBy(desc(opsTokens.createdAt));
  return rows.map(summarize);
}

export async function getOpsToken(id: string): Promise<OpsTokenSummary | null> {
  const [row] = await db.select().from(opsTokens).where(eq(opsTokens.id, id));
  return row ? summarize(row) : null;
}

/**
 * The full row, hash included — `getOpsToken` above is what the console page
 * renders, this is what the console's own server actions need to reuse a
 * token-scoped write (e.g. minting a batch under it). Never returned from a
 * route or rendered; stays inside modules/ops.
 */
export async function getOpsTokenRow(id: string): Promise<OpsTokenRow | null> {
  const [row] = await db.select().from(opsTokens).where(eq(opsTokens.id, id));
  return row ?? null;
}

/** Revocation is a timestamp, not a delete (§18.1.1). */
export async function revokeOpsToken(id: string): Promise<void> {
  await db
    .update(opsTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(opsTokens.id, id), sql`${opsTokens.revokedAt} IS NULL`));
}

/** Replaces the allowlist wholesale — an explicit list, never a wildcard. */
export async function setOpsTokenAllowlist(id: string, tenantIds: string[]): Promise<void> {
  await db
    .update(opsTokens)
    .set({ allowedTenantIds: [...new Set(tenantIds)] })
    .where(eq(opsTokens.id, id));
}

export function allowedTenantIds(token: Pick<OpsTokenRow, "allowedTenantIds">): string[] {
  const raw = token.allowedTenantIds;
  return Array.isArray(raw) ? (raw as string[]) : [];
}
