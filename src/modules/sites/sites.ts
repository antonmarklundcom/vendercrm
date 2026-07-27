import { eq } from "drizzle-orm";
import { sites } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { filterBySiteScope, siteInScope } from "@/modules/access/scope";
import { generateApiKey } from "./keys";

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
  const key = generateApiKey();

  await tenantDb(ctx)
    .insert(sites)
    .values({
      id,
      name: input.name,
      slug: input.slug,
      domain: input.domain,
      apiKeyHash: key.hash,
      apiKeyPrefix: key.displayPrefix,
      isActive: true,
      defaultPipelineId: input.defaultPipelineId,
      defaultStageId: input.defaultStageId,
      defaultOwnerUserId: input.defaultOwnerUserId,
      defaultTagIds: input.defaultTagIds ?? [],
      waAccountId: input.waAccountId,
    });

  return { id, apiKey: key.plaintext };
}

export type UpdateSiteInput = Partial<Omit<CreateSiteInput, "slug">> & {
  isActive?: boolean;
};

export async function updateSite(ctx: TenantContext, id: string, input: UpdateSiteInput) {
  await tenantDb(ctx).update(sites).set(input).where(eq(sites.id, id));
  return getSite(ctx, id);
}

/** Rotation is issue-new + overwrite-hash; the old key stops working at once. */
export async function rotateApiKey(ctx: TenantContext, id: string): Promise<string> {
  const key = generateApiKey();
  await tenantDb(ctx)
    .update(sites)
    .set({ apiKeyHash: key.hash, apiKeyPrefix: key.displayPrefix })
    .where(eq(sites.id, id));
  return key.plaintext;
}

export async function getSite(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(sites, eq(sites.id, id));
  if (!row) return null;
  if (!siteInScope(ctx, row.id)) return null;
  return row;
}

export function listSites(ctx: TenantContext) {
  return tenantDb(ctx)
    .select(sites)
    .then((rows) =>
      filterBySiteScope(ctx, rows, (row) => row.id).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
}

export async function deleteSite(ctx: TenantContext, id: string) {
  await tenantDb(ctx).delete(sites, eq(sites.id, id));
}
