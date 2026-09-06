import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { tenantEmailDomains } from "@/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/config/env";
import type { TenantContext } from "./context";
import { tenantDb } from "./db";

// Own-domain email identity (PLAN.md §15.1, §15.8 P4). Every tenant still
// sends through the platform's one Resend account — a verified domain here
// only changes the `From` header senderFor(ctx) builds (src/lib/email/sender.ts).
//
// Absent RESEND_API_KEY degrades the same way the rest of the app treats an
// unconfigured provider (lib/email/index.ts, notifications/push.ts): the row
// is still created so the admin sees what they asked for, but it stays
// `pending` forever with no DNS records to show, and the settings section
// says so rather than crashing.

const client = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export function isResendDomainsConfigured(): boolean {
  return client !== null;
}

export async function listTenantEmailDomains(ctx: TenantContext) {
  const rows = await tenantDb(ctx).select(tenantEmailDomains);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getTenantEmailDomain(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(tenantEmailDomains, eq(tenantEmailDomains.id, id));
  return row ?? null;
}

/** The one domain `senderFor(ctx)` may use — verified, and only that. */
export async function getVerifiedDomainForTenant(ctx: TenantContext) {
  const rows = await tenantDb(ctx).select(tenantEmailDomains, eq(tenantEmailDomains.status, "verified"));
  return rows[0] ?? null;
}

function mapStatus(resendStatus: string): "pending" | "verified" | "failed" {
  if (resendStatus === "verified") return "verified";
  if (resendStatus === "failed") return "failed";
  // pending, not_started, partially_verified, partially_failed — all still
  // "keep polling" from this app's point of view (§15.1: poll for 72h, then
  // fail).
  return "pending";
}

export async function createTenantEmailDomain(ctx: TenantContext, domain: string) {
  const id = newId();

  if (client) {
    const result = await client.domains.create({ name: domain });
    if (result.error) throw new Error(`resend_domain_create_failed: ${result.error.message}`);

    await tenantDb(ctx)
      .insert(tenantEmailDomains)
      .values({
        id,
        domain,
        resendDomainId: result.data!.id,
        status: mapStatus(result.data!.status),
        dnsRecords: result.data!.records,
      });
  } else {
    // No Resend key: the row records the tenant's intent, but there is
    // nothing to poll and no records to show — the settings section
    // explains this rather than pretending the domain got created.
    await tenantDb(ctx).insert(tenantEmailDomains).values({ id, domain, status: "pending" });
  }

  const [row] = await tenantDb(ctx).select(tenantEmailDomains, eq(tenantEmailDomains.id, id));
  return row ?? null;
}

/**
 * Admin-triggered retry, and the job's own poll (below) — same call.
 * `domains.verify` only returns `{id}`, no status or records, so this
 * triggers the check and then reads the result back with `domains.get`.
 */
export async function refreshTenantEmailDomain(ctx: TenantContext, id: string) {
  const domain = await getTenantEmailDomain(ctx, id);
  if (!domain || !domain.resendDomainId || !client) return domain;

  await client.domains.verify(domain.resendDomainId).catch(() => {});
  const result = await client.domains.get(domain.resendDomainId);
  if (result.error) return domain;

  const status = mapStatus(result.data!.status);
  await tenantDb(ctx)
    .update(tenantEmailDomains)
    .set({
      status,
      dnsRecords: result.data!.records,
      verifiedAt: status === "verified" ? new Date() : domain.verifiedAt,
    })
    .where(eq(tenantEmailDomains.id, id));

  return getTenantEmailDomain(ctx, id);
}

export async function markTenantEmailDomainFailed(ctx: TenantContext, id: string) {
  await tenantDb(ctx).update(tenantEmailDomains).set({ status: "failed" }).where(eq(tenantEmailDomains.id, id));
}

export async function removeTenantEmailDomain(ctx: TenantContext, id: string) {
  const domain = await getTenantEmailDomain(ctx, id);
  if (domain?.resendDomainId && client) {
    // Best-effort: Resend not having the row anymore must not block removing
    // it from our own table.
    await client.domains.remove(domain.resendDomainId).catch(() => {});
  }
  await tenantDb(ctx).delete(tenantEmailDomains, eq(tenantEmailDomains.id, id));
}

export async function setTenantEmailFromLocalPart(ctx: TenantContext, id: string, fromLocalPart: string) {
  await tenantDb(ctx)
    .update(tenantEmailDomains)
    .set({ fromLocalPart })
    .where(eq(tenantEmailDomains.id, id));
}
