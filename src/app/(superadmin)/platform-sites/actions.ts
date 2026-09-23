"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { resolveSiteTenants } from "@/modules/tenancy/console-sites";
import { issueApiKey, listActiveApiKeys, revokeApiKey } from "@/modules/sites/keys";

// Bulk key issuing for /platform-sites. The per-site version lives on the
// business page (tenants/[id]/sites-actions.ts); this is the same operation
// for many sites at once, so a network of fifty sites is one click and one
// download instead of fifty business pages.

export type IssuedKey = {
  siteId: string;
  domain: string;
  tenantName: string;
  apiKey: string | null;
  error: "tooManyKeys" | "unknown" | null;
};

export type BulkKeysState = { error: "none" | "tooMany" | null; keys: IssuedKey[] };

const MAX_SITES = 200;

const schema = z.object({
  siteIds: z.array(z.string().min(1).max(26)).min(1),
  // Replacing revokes every key the site holds first. Off by default: a live
  // site keeps sending with its current key until the new one is deployed,
  // and turning it off is a separate, later decision (§5.2's rotation).
  replace: z.boolean(),
});

export async function issueKeysForSitesAction(
  _prev: BulkKeysState,
  formData: FormData,
): Promise<BulkKeysState> {
  const superadmin = await requireSuperadminContext();
  const parsed = schema.safeParse({
    siteIds: formData.getAll("siteId").map(String),
    replace: formData.get("replace") === "on",
  });
  if (!parsed.success) return { error: "none", keys: [] };
  if (parsed.data.siteIds.length > MAX_SITES) return { error: "tooMany", keys: [] };

  const keys: IssuedKey[] = [];
  // Sequential: each site opens its own context and writes an audit row, and
  // the pool is small on purpose (src/db/client.ts).
  for (const site of await resolveSiteTenants(parsed.data.siteIds)) {
    const base = {
      siteId: site.siteId,
      domain: site.domain ?? site.slug,
      tenantName: site.tenantName,
    };
    const ctx = await buildSystemTenantContext(site.tenantId);
    if (!ctx) {
      keys.push({ ...base, apiKey: null, error: "unknown" });
      continue;
    }

    const revoked: string[] = [];
    if (parsed.data.replace) {
      for (const key of await listActiveApiKeys(ctx, site.siteId)) {
        await revokeApiKey(ctx, site.siteId, key.id);
        revoked.push(key.id);
      }
    }

    const issued = await issueApiKey(ctx, site.siteId, "consola-lote");
    if (!issued.ok) {
      keys.push({ ...base, apiKey: null, error: "tooManyKeys" });
      continue;
    }

    await writeAuditLog({
      tenantId: site.tenantId,
      actorUserId: superadmin.userId,
      action: "site.key_issued_by_superadmin",
      entity: "site",
      entityId: site.siteId,
      payload: { keyId: issued.keyId, bulk: true, revoked },
    });
    keys.push({ ...base, apiKey: issued.plaintext, error: null });
  }

  revalidatePath("/platform-sites");
  return { error: null, keys };
}
