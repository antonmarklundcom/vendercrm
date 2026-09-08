import { randomBytes } from "node:crypto";
import { env } from "@/lib/config/env";
import type { SuperadminContext, TenantContext } from "@/modules/tenancy/context";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { createTenant, getTenantBySlug } from "@/modules/tenancy/tenants";
import {
  createTenantAdminUser,
  getUserByEmail,
  listUsersForTenant,
} from "@/modules/tenancy/users";
import { createTag, listTags } from "@/modules/crm/contacts";
import {
  createPipeline,
  createPipelineWithDefaultStages,
  createStage,
  listStagesForPipeline,
} from "@/modules/crm/pipelines";
import { createSite, getSite, getSiteBySlug, updateSite } from "@/modules/sites/sites";
import { issueApiKey, listActiveApiKeys, revokeApiKey } from "@/modules/sites/keys";
import { ingestLeadForSite } from "@/modules/sites/ingest";
import { writeOpsAudit } from "./audit";
import {
  markStepDone,
  markStepFailed,
  requireOwnRow,
  rowDetails,
  rowSteps,
  type OpsRow,
  type OpsStep,
} from "./batches";
import {
  assertMayCreateSiteInTenant,
  assertMayTouch,
  OpsAccessError,
  registerOpsObject,
} from "./guard";
import type { OpsTokenRow } from "./tokens";

// The five provisioning steps (PLAN.md §18.3). Each one is idempotent per
// (row, step): calling it twice returns what the first call created, because
// a session that lost its connection mid-run must be able to simply re-run
// the flow rather than reason about what it already did.
//
// Nothing here trusts the caller with an id. A step names a *row*; the row
// names the tenant and the site; and the guard decides whether this token may
// touch them. There is no endpoint that takes a site id from the request.

function superadminFor(token: OpsTokenRow): SuperadminContext {
  return { userId: token.ownerUserId, impersonatorUserId: null };
}

async function tenantContextFor(tenantId: string): Promise<TenantContext> {
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) throw new OpsAccessError(404, "tenant not found");
  return ctx;
}

/**
 * What the three post-site steps stand on. It asks three questions, and the
 * third one is the reason this helper exists rather than an inline pair of
 * checks: `row.tenant_id` is writable by the session (PATCH), so a row whose
 * site was created in tenant A could be re-pointed at tenant B and the next
 * step would otherwise happily build a pipeline, a key or a lead there.
 * Reading the site back through B's own tenant context answers null in that
 * case — the same tenancy wall every other module stands behind.
 */
async function resolveOpsSite(token: OpsTokenRow, row: OpsRow) {
  if (!row.siteId || !row.tenantId) {
    throw new OpsAccessError(422, "run the site step first: the row has no site");
  }
  await assertMayTouch(token, "site", row.siteId);

  const ctx = await tenantContextFor(row.tenantId);
  const site = await getSite(ctx, row.siteId);
  if (!site) throw new OpsAccessError(404, "site not found");

  return { ctx, site, tenantId: row.tenantId, siteId: row.siteId };
}

/**
 * `dentistaluque.com.py` → `dentistaluque`. The first label only: a slug is a
 * short human handle, and every site the owner runs has its own domain, so
 * the label is already unique in practice. Collisions are answered with a 409
 * naming the slug rather than silently suffixed — the session can then pass
 * an explicit one instead of guessing which "clinica-2" is whose.
 */
export function slugFromDomain(domain: string): string {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  const label = (host ?? "").split(".")[0] ?? "";
  const slug = label.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return slug || "site";
}

async function step<T>(
  token: OpsTokenRow,
  rowId: string,
  name: OpsStep,
  run: (row: OpsRow) => Promise<T>,
): Promise<T> {
  const row = await requireOwnRow(token, rowId);
  try {
    return await run(row);
  } catch (err) {
    // The row keeps the endpoint's own words (§18.1.7). An OpsAccessError is
    // a stated refusal; anything else is a bug, and the message still beats
    // "failed" for whoever has to fix it.
    const status = err instanceof OpsAccessError ? err.status : 500;
    const reason = err instanceof Error ? err.message : String(err);
    await markStepFailed(row, name, status, reason);
    throw err;
  }
}

// --- 1. Tenant ----------------------------------------------------------

export type TenantStepResult = {
  repeated: boolean;
  tenantId: string;
  adminUserId: string | null;
  /** Whether the reset e-mail could be sent. The link itself never leaves
   * the server: the admin sets their own password from their inbox. */
  resetEmailSent: boolean;
};

export function provisionTenant(token: OpsTokenRow, rowId: string): Promise<TenantStepResult> {
  return step(token, rowId, "tenant", async (row) => {
    const steps = rowSteps(row);
    if (row.tenantId && steps.tenant?.status === "done") {
      return { repeated: true, tenantId: row.tenantId, adminUserId: null, resetEmailSent: false };
    }

    // `existing` is not a create at all: the tenant must already be
    // allowlisted, and the step exists only to record that the row is bound
    // to it (§18.1.3).
    if (row.tenantMode === "existing") {
      if (!row.tenantId) {
        throw new OpsAccessError(422, "tenant_id is required when tenant_mode is existing");
      }
      await assertMayCreateSiteInTenant(token, row.tenantId);
      await markStepDone(row, "tenant", {}, "running");
      return { repeated: true, tenantId: row.tenantId, adminUserId: null, resetEmailSent: false };
    }

    const details = rowDetails(row);
    const adminEmail = (details.admin_email ?? details.owner_email ?? "").trim().toLowerCase();
    if (!adminEmail) {
      throw new OpsAccessError(422, "details.admin_email is required to create a tenant");
    }
    if (await getUserByEmail(adminEmail)) {
      // Never adopt a user that already exists: that account may belong to
      // another business, and an ops token may not reach into one.
      throw new OpsAccessError(
        422,
        `a user with e-mail ${adminEmail} already exists; provision this row into an existing tenant instead`,
      );
    }

    const name = details.tenant_name ?? row.displayName;
    const slug = details.tenant_slug ?? slugFromDomain(row.domain);
    if (await getTenantBySlug(slug)) {
      throw new OpsAccessError(
        409,
        `tenant slug "${slug}" is already in use; set details.tenant_slug to something else`,
      );
    }

    const sa = superadminFor(token);
    const tenant = await createTenant(sa, { name, slug });
    if (!tenant) throw new OpsAccessError(422, "tenant could not be created");

    await registerOpsObject({
      tokenId: token.id,
      batchId: row.batchId,
      rowId: row.id,
      entity: "tenant",
      entityId: tenant.id,
    });

    // A random password nobody ever sees: the account is reached through the
    // reset link, and there is no plaintext to return, log or leak.
    const admin = await createTenantAdminUser({
      tenantId: tenant.id,
      email: adminEmail,
      password: randomBytes(32).toString("base64url"),
      name: details.admin_name ?? name,
      role: "admin",
    });
    if (admin) {
      await registerOpsObject({
        tokenId: token.id,
        batchId: row.batchId,
        rowId: row.id,
        entity: "user",
        entityId: admin.id,
      });
    }

    const resetEmailSent = await sendAdminResetEmail(adminEmail);

    await writeOpsAudit(token, row, {
      tenantId: tenant.id,
      action: "ops.tenant_created",
      entity: "tenant",
      entityId: tenant.id,
      payload: { name, slug, admin_email: adminEmail, domain: row.domain },
    });

    await markStepDone(row, "tenant", { tenantId: tenant.id });

    return {
      repeated: false,
      tenantId: tenant.id,
      adminUserId: admin?.id ?? null,
      resetEmailSent,
    };
  });
}

/**
 * The existing reset-password path (the same one the superadmin console's
 * "send reset link" button uses). Imported lazily because Better Auth pulls
 * in the request-scoped Next runtime, which a provisioning step called from a
 * script or a test has no business booting. Never throws: a tenant that
 * exists with an admin who has no e-mail yet is recoverable; a failed
 * provisioning run is not.
 */
async function sendAdminResetEmail(email: string): Promise<boolean> {
  try {
    const { auth } = await import("@/lib/auth/server");
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${env.APP_URL}/reset-password` },
    });
    return true;
  } catch {
    return false;
  }
}

// --- 2. Site ------------------------------------------------------------

export type SiteStepResult = {
  repeated: boolean;
  siteId: string;
  slug: string;
  isActive: boolean;
};

export function provisionSite(token: OpsTokenRow, rowId: string): Promise<SiteStepResult> {
  return step(token, rowId, "site", async (row) => {
    const steps = rowSteps(row);
    if (row.siteId && steps.site?.status === "done") {
      const ctx = await tenantContextFor(row.tenantId!);
      const existing = await getSite(ctx, row.siteId);
      return {
        repeated: true,
        siteId: row.siteId,
        slug: existing?.slug ?? "",
        isActive: existing?.isActive ?? false,
      };
    }

    if (!row.tenantId) {
      throw new OpsAccessError(422, "run the tenant step first: the row has no tenant");
    }
    await assertMayCreateSiteInTenant(token, row.tenantId);

    const ctx = await tenantContextFor(row.tenantId);
    const slug = slugFromDomain(row.domain);
    if (await getSiteBySlug(ctx, slug)) {
      throw new OpsAccessError(409, `a site with slug "${slug}" already exists in this tenant`);
    }

    // Born inactive (§18.1.4): go-live is the owner's click on the Claude Ops
    // page, never a session's decision.
    const created = await createSite(ctx, {
      name: row.displayName,
      slug,
      domain: row.domain,
      isActive: false,
    });

    // `createSite` issues the site's first key and hands back its plaintext.
    // Here that plaintext goes nowhere — the key step issues the one the
    // website will actually hold — so this key is revoked rather than left
    // live and unrecoverable, which would also spend the site's rotation slot.
    for (const key of await listActiveApiKeys(ctx, created.id)) {
      await revokeApiKey(ctx, created.id, key.id);
    }

    await registerOpsObject({
      tokenId: token.id,
      batchId: row.batchId,
      rowId: row.id,
      entity: "site",
      entityId: created.id,
    });

    await writeOpsAudit(token, row, {
      tenantId: row.tenantId,
      action: "ops.site_created",
      entity: "site",
      entityId: created.id,
      payload: { name: row.displayName, slug, domain: row.domain, is_active: false },
    });

    await markStepDone(row, "site", { siteId: created.id });

    return { repeated: false, siteId: created.id, slug, isActive: false };
  });
}

// --- 3. Pipeline, tags, owner and the site's defaults --------------------

export type PipelineStepResult = {
  repeated: boolean;
  pipelineId: string;
  stageIds: string[];
  tagIds: string[];
  ownerUserId: string | null;
};

export function provisionPipeline(
  token: OpsTokenRow,
  rowId: string,
): Promise<PipelineStepResult> {
  return step(token, rowId, "pipeline", async (row) => {
    const steps = rowSteps(row);
    if (row.pipelineId && steps.pipeline?.status === "done") {
      const ctx = await tenantContextFor(row.tenantId!);
      const stages = await listStagesForPipeline(ctx, row.pipelineId);
      return {
        repeated: true,
        pipelineId: row.pipelineId,
        stageIds: stages.map((stage) => stage.id),
        tagIds: [],
        ownerUserId: null,
      };
    }

    const { ctx, tenantId, siteId } = await resolveOpsSite(token, row);
    const details = rowDetails(row);

    // The owner is resolved before anything is created: an unknown e-mail is
    // a question for the owner, not a default to guess at (§18.3).
    let ownerUserId: string | null = null;
    if (details.owner_email) {
      const wanted = details.owner_email.trim().toLowerCase();
      const members = await listUsersForTenant(tenantId);
      const match = members.find((user) => user.email.toLowerCase() === wanted);
      if (!match) {
        throw new OpsAccessError(
          422,
          `owner_email ${details.owner_email} is not a user in this business`,
        );
      }
      ownerUserId = match.id;
    }

    const stageNames = (details.stages ?? []).map((name) => name.trim()).filter(Boolean);
    let pipelineId: string;
    if (stageNames.length === 0) {
      const pipeline = await createPipelineWithDefaultStages(ctx, row.displayName);
      if (!pipeline) throw new OpsAccessError(422, "pipeline could not be created");
      pipelineId = pipeline.id;
    } else {
      const pipeline = await createPipeline(ctx, { name: row.displayName });
      if (!pipeline) throw new OpsAccessError(422, "pipeline could not be created");
      pipelineId = pipeline.id;
      for (const [index, name] of stageNames.entries()) {
        await createStage(ctx, { pipelineId, name, position: index });
      }
    }

    const stages = await listStagesForPipeline(ctx, pipelineId);

    // Tags are created only where they are missing: a business the owner
    // already tagged "urgente" keeps the one tag it has.
    const existingTags = await listTags(ctx);
    const tagIds: string[] = [];
    for (const name of details.tags ?? []) {
      const wanted = name.trim();
      if (!wanted) continue;
      const found = existingTags.find(
        (tag) => tag.name.toLowerCase() === wanted.toLowerCase(),
      );
      if (found) {
        tagIds.push(found.id);
        continue;
      }
      const created = await createTag(ctx, { name: wanted });
      if (created) {
        existingTags.push(created);
        tagIds.push(created.id);
      }
    }

    await updateSite(ctx, siteId, {
      defaultPipelineId: pipelineId,
      defaultStageId: stages[0]?.id,
      defaultOwnerUserId: ownerUserId ?? undefined,
      defaultTagIds: tagIds,
      waAccountId: details.wa_account_id,
    });

    await registerOpsObject({
      tokenId: token.id,
      batchId: row.batchId,
      rowId: row.id,
      entity: "pipeline",
      entityId: pipelineId,
    });

    await writeOpsAudit(token, row, {
      tenantId,
      action: "ops.pipeline_created",
      entity: "pipeline",
      entityId: pipelineId,
      payload: {
        site_id: siteId,
        stages: stages.map((stage) => stage.name),
        tag_ids: tagIds,
        owner_user_id: ownerUserId,
      },
    });

    await markStepDone(row, "pipeline", { pipelineId });

    return {
      repeated: false,
      pipelineId,
      stageIds: stages.map((stage) => stage.id),
      tagIds,
      ownerUserId,
    };
  });
}

// --- 4. API key ---------------------------------------------------------

export type KeyStepResult = {
  repeated: boolean;
  keyId: string;
  /** Plaintext exists in the creating response and nowhere else — a repeat
   * returns null rather than a second key, because the site already holds
   * one and re-issuing would spend its rotation slot. */
  plaintext: string | null;
};

export function provisionKey(
  token: OpsTokenRow,
  rowId: string,
  label?: string,
): Promise<KeyStepResult> {
  return step(token, rowId, "key", async (row) => {
    const steps = rowSteps(row);
    if (row.apiKeyId && steps.key?.status === "done") {
      return { repeated: true, keyId: row.apiKeyId, plaintext: null };
    }

    const { ctx, tenantId, siteId } = await resolveOpsSite(token, row);
    const issued = await issueApiKey(ctx, siteId, label ?? "claude-ops");
    if (!issued.ok) {
      throw new OpsAccessError(
        409,
        "the site already holds the maximum number of active keys",
      );
    }

    await registerOpsObject({
      tokenId: token.id,
      batchId: row.batchId,
      rowId: row.id,
      entity: "api_key",
      entityId: issued.keyId,
    });

    await writeOpsAudit(token, row, {
      tenantId,
      action: "ops.api_key_issued",
      entity: "site_api_key",
      entityId: issued.keyId,
      payload: { site_id: siteId, label: label ?? "claude-ops" },
    });

    await markStepDone(row, "key", { apiKeyId: issued.keyId });

    return { repeated: false, keyId: issued.keyId, plaintext: issued.plaintext };
  });
}

// --- 5. Test lead -------------------------------------------------------

export type TestLeadStepResult = {
  repeated: boolean;
  contactId: string;
  dealId: string | null;
};

/** Fixed, and not caller-supplied: a test lead is a fixture, not an input. */
export const OPS_TEST_LEAD_NAME = "Prueba onboarding";

export function provisionTestLead(
  token: OpsTokenRow,
  rowId: string,
): Promise<TestLeadStepResult> {
  return step(token, rowId, "test_lead", async (row) => {
    const steps = rowSteps(row);
    if (row.testContactId && steps.test_lead?.status === "done") {
      return { repeated: true, contactId: row.testContactId, dealId: row.testDealId };
    }

    const { site, tenantId, siteId } = await resolveOpsSite(token, row);

    // The only caller in the codebase that passes `allowInactive`. The site
    // is inactive by construction at this point (§18.1.4), and no public
    // route can set this flag — that is what keeps "inactive" meaningful.
    const outcome = await ingestLeadForSite(
      site,
      {
        phone: env.OPS_TEST_PHONE,
        name: OPS_TEST_LEAD_NAME,
        source: "ops-test",
        message: `Lead de prueba creado al conectar ${row.domain}.`,
        idempotency_key: `ops-test-${row.id}`,
      },
      {},
      "key",
      { allowInactive: true },
    );

    if (!outcome.ok) {
      throw new OpsAccessError(
        422,
        `test lead rejected by ingest (${outcome.status}): ${outcome.error}`,
      );
    }

    const { contactId, dealId } = outcome.result;

    await registerOpsObject({
      tokenId: token.id,
      batchId: row.batchId,
      rowId: row.id,
      entity: "contact",
      entityId: contactId,
    });
    if (dealId) {
      await registerOpsObject({
        tokenId: token.id,
        batchId: row.batchId,
        rowId: row.id,
        entity: "deal",
        entityId: dealId,
      });
    }

    await writeOpsAudit(token, row, {
      tenantId,
      action: "ops.test_lead_sent",
      entity: "contact",
      entityId: contactId,
      payload: { site_id: siteId, deal_id: dealId ?? null },
    });

    // The row now waits for a human (§18.1.4): the site is still inactive and
    // the test lead is still in the pipeline until the owner approves.
    await markStepDone(
      row,
      "test_lead",
      { testContactId: contactId, testDealId: dealId ?? null },
      "awaiting_approval",
    );

    return { repeated: false, contactId, dealId: dealId ?? null };
  });
}
