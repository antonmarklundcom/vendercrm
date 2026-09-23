"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { createSite, getSite, getSiteBySlug, updateSite } from "@/modules/sites/sites";
import { issueApiKey, revokeApiKey } from "@/modules/sites/keys";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { slugFromDomain } from "@/modules/ops/provision";
import { listRowsAwaitingOwner, markRowLive, retireTestLead } from "@/modules/ops";

// Sites and API keys, run from the console's business page. The same things
// a tenant admin does on /sites, without having to impersonate someone to get
// there — the owner runs ~50 sites and the key is the one thing every one of
// them needs. Every action re-checks superadmin and works through a system
// context scoped to the business named in the form (§3.3), and each leaves an
// audit entry naming the superadmin, as the WhatsApp actions next door do.

/** A freshly issued key is shown exactly once (§5.1): it travels back in
 * this state, never stored anywhere readable. */
export type SiteKeyState = {
  error: string | null;
  apiKey: string | null;
  /** Which site the key belongs to, so only that row reveals it. */
  siteId: string | null;
};

const initialError = (error: string): SiteKeyState => ({ error, apiKey: null, siteId: null });

const createSiteSchema = z.object({
  tenantId: z.string().min(1).max(26),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(255)
    .transform((value) =>
      value.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "",
    )
    .refine((value) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)),
});

export async function createTenantSiteAction(
  _prev: SiteKeyState,
  formData: FormData,
): Promise<SiteKeyState> {
  const superadmin = await requireSuperadminContext();
  const parsed = createSiteSchema.safeParse({
    tenantId: formData.get("tenantId"),
    domain: formData.get("domain"),
  });
  if (!parsed.success) return initialError("domainInvalid");

  const { tenantId, domain } = parsed.data;
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return initialError("unknown");

  const slug = slugFromDomain(domain);
  if (await getSiteBySlug(ctx, slug)) return initialError("siteExists");

  // Where its leads land. Without a default pipeline a lead is accepted and
  // then has nowhere to put the deal — which reads as "the form is broken".
  const [pipeline] = await listPipelines(ctx);
  if (!pipeline) return initialError("noPipeline");
  const [stage] = await listStagesForPipeline(ctx, pipeline.id);

  const site = await createSite(ctx, {
    name: domain,
    slug,
    domain,
    isActive: true,
    defaultPipelineId: pipeline.id,
    defaultStageId: stage?.id,
  });

  await writeAuditLog({
    tenantId,
    actorUserId: superadmin.userId,
    action: "site.created_by_superadmin",
    entity: "site",
    entityId: site.id,
    payload: { domain, slug },
  });

  revalidatePath(`/tenants/${tenantId}`);
  return { error: null, apiKey: site.apiKey, siteId: site.id };
}

const siteRefSchema = z.object({
  tenantId: z.string().min(1).max(26),
  siteId: z.string().min(1).max(26),
});

export async function issueTenantSiteKeyAction(
  _prev: SiteKeyState,
  formData: FormData,
): Promise<SiteKeyState> {
  const superadmin = await requireSuperadminContext();
  const parsed = siteRefSchema.safeParse({
    tenantId: formData.get("tenantId"),
    siteId: formData.get("siteId"),
  });
  if (!parsed.success) return initialError("unknown");

  const ctx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!ctx || !(await getSite(ctx, parsed.data.siteId))) return initialError("unknown");

  const issued = await issueApiKey(ctx, parsed.data.siteId, "consola");
  if (!issued.ok) return { error: "tooManyKeys", apiKey: null, siteId: parsed.data.siteId };

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: "site.key_issued_by_superadmin",
    entity: "site",
    entityId: parsed.data.siteId,
    payload: { keyId: issued.keyId },
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, apiKey: issued.plaintext, siteId: parsed.data.siteId };
}

export async function revokeTenantSiteKeyAction(formData: FormData) {
  const superadmin = await requireSuperadminContext();
  const parsed = siteRefSchema
    .extend({ keyId: z.string().min(1).max(26) })
    .safeParse({
      tenantId: formData.get("tenantId"),
      siteId: formData.get("siteId"),
      keyId: formData.get("keyId"),
    });
  if (!parsed.success) return;

  const ctx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!ctx) return;
  await revokeApiKey(ctx, parsed.data.siteId, parsed.data.keyId);

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: "site.key_revoked_by_superadmin",
    entity: "site",
    entityId: parsed.data.siteId,
    payload: { keyId: parsed.data.keyId },
  });
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
}

export async function setTenantSiteActiveAction(formData: FormData) {
  const superadmin = await requireSuperadminContext();
  const parsed = siteRefSchema
    .extend({ active: z.enum(["true", "false"]) })
    .safeParse({
      tenantId: formData.get("tenantId"),
      siteId: formData.get("siteId"),
      active: formData.get("active"),
    });
  if (!parsed.success) return;

  const ctx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!ctx || !(await getSite(ctx, parsed.data.siteId))) return;
  const isActive = parsed.data.active === "true";
  await updateSite(ctx, parsed.data.siteId, { isActive });

  // A site Claude Ops provisioned is waiting on exactly this click. Turning
  // it on here must mean what approving it on /claude-ops means — the test
  // lead goes and the row is marked live — or the two pages disagree.
  const opsRow = isActive
    ? (await listRowsAwaitingOwner()).find((row) => row.siteId === parsed.data.siteId)
    : undefined;
  if (opsRow) {
    await retireTestLead(ctx, { contactId: opsRow.testContactId, dealId: opsRow.testDealId });
    await markRowLive(opsRow.id);
  }

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: isActive ? "site.activated" : "site.deactivated",
    entity: "site",
    entityId: parsed.data.siteId,
    payload: { via: `console:${superadmin.userId}`, row_id: opsRow?.id ?? null },
  });
  revalidatePath("/tenants", "layout");
}
