import { allowedTenantIds, listOpsBatches } from "@/modules/ops";
import { authenticateOpsRequest, json, serializeBatch } from "@/modules/ops/http";
import { getTenant } from "@/modules/tenancy/tenants";

// GET /api/ops/v1/me (PLAN.md §18.3) — what a session asks first: who am I,
// which existing businesses may I add a site to, and what am I in the middle
// of. Deliberately the only place the allowlist is readable: a session that
// knows a tenant is off-limits can say so to the owner instead of failing a
// step and writing a confusing row.

export async function GET(request: Request) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;
  const { token } = auth;

  const allowed = [];
  for (const tenantId of allowedTenantIds(token)) {
    const tenant = await getTenant(tenantId);
    // A deleted or renamed tenant simply drops out of the list rather than
    // failing the call — the allowlist is the owner's note, not a foreign key.
    if (tenant) allowed.push({ id: tenant.id, name: tenant.name, slug: tenant.slug });
  }

  const batches = await listOpsBatches(token);

  return json({
    token: {
      label: token.label,
      prefix: token.tokenPrefix,
      expires_at: token.expiresAt,
      call_count: token.callCount,
    },
    allowed_tenants: allowed,
    open_batches: batches.filter((batch) => batch.status === "open").map(serializeBatch),
  });
}
