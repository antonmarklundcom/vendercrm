import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { siteApiKeys, sites } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// API key handling for the ingest endpoint (PLAN.md §5.1, rotation in §5.2).
//
// Keys are stored HASHED, never encrypted: nothing ever needs to read a key
// back, only compare one. SHA-256 rather than a slow KDF because the key is
// 32 bytes of CSPRNG output, not a human password — there is no dictionary
// to defend against, and ingest verifies a key on every request.
//
// A site may hold up to TWO live keys (§5.2) so rotation is issue new →
// deploy it → revoke old, with no window where the site can't post.

const KEY_PREFIX = "vc_live_";

/** Two, not N: enough for a rotation, few enough that "which keys are live"
 * stays a question with a glanceable answer. A third would mostly mean a key
 * nobody remembers issuing is still accepted. */
export const MAX_ACTIVE_KEYS_PER_SITE = 2;

export type GeneratedApiKey = {
  /** Full key — returned exactly once, at creation, and never stored. */
  plaintext: string;
  hash: string;
  displayPrefix: string;
};

export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, 16),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * How stale a `last_used_at` may get before ingest writes it again. Ingest is
 * on the hot path, so this is a throttle rather than a per-request write: a
 * site posting 500 leads an hour writes the column once a minute, not 500
 * times. One minute of staleness is far finer than the human question the
 * column answers ("is the old key still in use?").
 */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Ingest routing (§5.1): key → site → tenant. Runs before any TenantContext
 * can exist — structurally identical to the WhatsApp webhook's
 * phone_number_id lookup (§6.3), and covered by the same lint exemption.
 *
 * The lookup is by hash, so it's a single indexed equality match rather than
 * a scan-and-compare; the constant-time compare below is belt-and-braces
 * against a storage layer that might return a near-match.
 */
export async function resolveSiteByApiKey(plaintext: string) {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(plaintext);
  const [key] = await db
    .select()
    .from(siteApiKeys)
    .where(and(eq(siteApiKeys.apiKeyHash, hash), isNull(siteApiKeys.revokedAt)));
  if (!key) return null;

  const a = Buffer.from(key.apiKeyHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [site] = await db.select().from(sites).where(eq(sites.id, key.siteId));
  if (!site) return null;

  await touchApiKey(key.id, key.lastUsedAt);

  return { ...site, apiKeyId: key.id };
}

/**
 * Diagnostics only (§5.2 health): when a key is rejected, find out whether
 * it is a key this CRM once issued and later revoked. A site still posting
 * with the old key after a rotation fails with a bare 401 on THEIR server;
 * from here it looked identical to a typo. Matching the hash against
 * revoked rows lets the failure be attributed to the right site and shown
 * on /sites as "still sending a revoked key". Never grants access: the
 * caller records health and still answers 401.
 */
export async function findSiteByRevokedApiKey(plaintext: string) {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(plaintext);
  const [key] = await db
    .select()
    .from(siteApiKeys)
    .where(and(eq(siteApiKeys.apiKeyHash, hash), isNotNull(siteApiKeys.revokedAt)));
  if (!key) return null;

  const [site] = await db.select().from(sites).where(eq(sites.id, key.siteId));
  return site ?? null;
}

/** Records that this key is the one a site is really sending with — the
 * evidence that makes revoking the other one safe (§5.2). Best-effort: a
 * failed bookkeeping write must never cost the tenant a lead. */
async function touchApiKey(keyId: string, lastUsedAt: Date | null): Promise<void> {
  const now = Date.now();
  if (lastUsedAt && now - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;

  try {
    await db
      .update(siteApiKeys)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(siteApiKeys.id, keyId));
  } catch {
    // Ignored on purpose: see above.
  }
}

export type SiteApiKeyRow = typeof siteApiKeys.$inferSelect;

export function listApiKeys(ctx: TenantContext, siteId: string): Promise<SiteApiKeyRow[]> {
  return tenantDb(ctx)
    .select(siteApiKeys, eq(siteApiKeys.siteId, siteId))
    .then((rows) =>
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
}

export function listActiveApiKeys(ctx: TenantContext, siteId: string) {
  return listApiKeys(ctx, siteId).then((rows) => rows.filter((row) => !row.revokedAt));
}

export type IssueApiKeyResult =
  | { ok: true; plaintext: string; keyId: string }
  | { ok: false; error: "tooManyKeys" };

/**
 * Issues an additional key for a site, up to MAX_ACTIVE_KEYS_PER_SITE.
 * Rotation is: issue here, deploy the new key on the site, watch its
 * `last_used_at` move, then revoke the old one. Nothing is overwritten, so
 * there is no moment where the live site holds a key the CRM no longer
 * accepts.
 */
export async function issueApiKey(
  ctx: TenantContext,
  siteId: string,
  label?: string,
): Promise<IssueApiKeyResult> {
  const active = await listActiveApiKeys(ctx, siteId);
  if (active.length >= MAX_ACTIVE_KEYS_PER_SITE) {
    return { ok: false, error: "tooManyKeys" };
  }

  const key = generateApiKey();
  const id = newId();
  await tenantDb(ctx).insert(siteApiKeys).values({
    id,
    siteId,
    apiKeyHash: key.hash,
    apiKeyPrefix: key.displayPrefix,
    label,
  });

  return { ok: true, plaintext: key.plaintext, keyId: id };
}

/** Revokes one key by id, leaving the site's other key working. */
export async function revokeApiKey(
  ctx: TenantContext,
  siteId: string,
  keyId: string,
): Promise<void> {
  await tenantDb(ctx)
    .update(siteApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(siteApiKeys.id, keyId), eq(siteApiKeys.siteId, siteId)));
}
