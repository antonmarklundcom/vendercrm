import { eq } from "drizzle-orm";
import { sites } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { issueApiKey } from "./keys";

// Sites CRUD (PLAN.md §5.1). One tenant owns many sites — connecting a new
// project is: create a site, copy the key once, point the site's form
// handler at /api/v1/leads.

export type CreateSiteInput = {
  name: string;
  slug: string;
  domain?: string;
  defaultPipelineId?: string;
  defaultStageId?: string;
  defaultOwnerUserId?: string;
  defaultTagIds?: string[];
  waAccountId?: string;
  /**
   * Defaults to true — a site an admin creates in the UI is live at once.
   * Claude Ops (PLAN.md §18.1.4) passes false: a site provisioned by a
   * session is born inactive and goes live on the owner's click. Set at
   * INSERT rather than by a follow-up update, so there is no window, however
   * short, in which such a site would accept a lead.
   */
  isActive?: boolean;
};

export type CreatedSite = {
  id: string;
  /** Shown to the admin exactly once — never recoverable afterwards. */
  apiKey: string;
};

export async function createSite(
  ctx: TenantContext,
  input: CreateSiteInput,
): Promise<CreatedSite> {
  const id = newId();

  await tenantDb(ctx)
    .insert(sites)
    .values({
      id,
      name: input.name,
      slug: input.slug,
      domain: input.domain,
      isActive: input.isActive ?? true,
      defaultPipelineId: input.defaultPipelineId,
      defaultStageId: input.defaultStageId,
      defaultOwnerUserId: input.defaultOwnerUserId,
      defaultTagIds: input.defaultTagIds ?? [],
      waAccountId: input.waAccountId,
    });

  // The site's first key. Keys live in their own table since §5.2 so a site
  // can hold two at once; a brand-new site simply starts with one.
  const issued = await issueApiKey(ctx, id, "inicial");
  if (!issued.ok) throw new Error("No se pudo emitir la clave del sitio");

  return { id, apiKey: issued.plaintext };
}

export type UpdateSiteInput = Partial<Omit<CreateSiteInput, "slug">> & {
  isActive?: boolean;
};

export async function updateSite(ctx: TenantContext, id: string, input: UpdateSiteInput) {
  await tenantDb(ctx).update(sites).set(input).where(eq(sites.id, id));
  return getSite(ctx, id);
}

export async function getSite(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(sites, eq(sites.id, id));
  return row ?? null;
}

/** Slug is unique per tenant (sites_tenant_slug_idx) — used to answer a
 * duplicate slug inline instead of letting the index raise a 500. */
export async function getSiteBySlug(ctx: TenantContext, slug: string) {
  const [row] = await tenantDb(ctx).select(sites, eq(sites.slug, slug));
  return row ?? null;
}

export function listSites(ctx: TenantContext) {
  return tenantDb(ctx)
    .select(sites)
    .then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
}

