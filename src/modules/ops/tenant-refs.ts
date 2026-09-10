// Pure helper behind the Claude Ops allowlist form. Kept free of db imports
// so it can be unit-tested without an environment.

export type TenantRef = { id: string; name: string; slug: string };

export type ResolvedTenantRefs = {
  /** Tenant ids, in input order, de-duplicated. */
  ids: string[];
  /** Entries that matched nothing — the caller must refuse to save these. */
  unknown: string[];
};

/**
 * Turns what the owner typed into tenant ids. Each entry may be an id, a
 * slug or a name (name and slug case-insensitively). Only ids are ever
 * stored: `/me` resolves the allowlist with `getTenant(id)`, so a name saved
 * as-is would look allowlisted on the console and be invisible to the API —
 * which is exactly what happened on 2026-09-10.
 */
export function resolveTenantRefs(refs: string[], tenants: TenantRef[]): ResolvedTenantRefs {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    const lower = ref.toLowerCase();
    const match =
      tenants.find((t) => t.id === ref) ??
      tenants.find((t) => t.slug.toLowerCase() === lower) ??
      tenants.find((t) => t.name.toLowerCase() === lower);
    if (!match) {
      unknown.push(ref);
      continue;
    }
    if (!ids.includes(match.id)) ids.push(match.id);
  }
  return { ids, unknown };
}
