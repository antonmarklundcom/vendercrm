// Loads `.env` before anything imports `@/lib/config/env` — see
// scripts/grant-shared-admin.ts for why.
import "dotenv/config";
import { listTenants } from "@/modules/tenancy/tenants";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { createSite, getSiteBySlug, listSites } from "@/modules/sites/sites";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";

// Gives an existing business a site, so its website can post leads.
//
// The provisioning API cannot do this for the businesses that need it. It is
// create-only and blind to what came before (PLAN.md §18.1.2): adding a site
// to a business it did not create requires that business to be allowlisted on
// the token first, and its `existing` mode wants a tenant id the owner would
// have to go and find. For the handful of businesses set up by hand before
// that API existed, naming the business is the whole input.
//
// Unlike the ops path, the site is born ACTIVE. Nothing is being reviewed
// here: these are live websites whose leads are currently going nowhere, and
// the inactive-until-approved dance exists for sites a *session* created
// unattended, not ones the owner is asking for by name at his own keyboard.
//
// The default pipeline and stage are taken from the business's own first
// pipeline, so a lead lands somewhere real rather than in a site with no
// destination configured.
//
// Usage:
//   npx tsx scripts/create-site.ts "Pozo=pozo.com.py" --dry-run
//   npx tsx scripts/create-site.ts "Pozo=pozo.com.py" "Tasacion=tasacion.com.py"
//
// The key is printed once and never stored in readable form. Copy it straight
// into that site's hosting environment.

/** `dentistaluque.com.py` → `dentistaluque`, matching slugFromDomain in the
 * ops module so a site created here is named the way every other one is. */
function slugFromDomain(domain: string): string {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  const label = (host ?? "").split(".")[0] ?? "";
  return label.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || "site";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const pairs = args.filter((arg) => !arg.startsWith("--") && arg.includes("="));

  if (pairs.length === 0) {
    console.error('Usage: npx tsx scripts/create-site.ts "Business=domain.com.py" [...] [--dry-run]');
    process.exit(1);
  }

  const tenants = await listTenants();
  const byName = new Map(tenants.map((tenant) => [tenant.name.toLowerCase(), tenant]));
  const created: string[] = [];

  for (const pair of pairs) {
    const [rawName, rawDomain] = pair.split("=").map((part) => part.trim());
    if (!rawName || !rawDomain) {
      console.error(`  ! "${pair}" is not Business=domain`);
      continue;
    }

    const tenant = byName.get(rawName.toLowerCase());
    if (!tenant) {
      console.error(`  ! no business named "${rawName}"`);
      console.error(`    known: ${tenants.map((t) => t.name).join(", ")}`);
      continue;
    }

    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) {
      console.error(`  ! could not open ${tenant.name}`);
      continue;
    }

    const slug = slugFromDomain(rawDomain);
    if (await getSiteBySlug(ctx, slug)) {
      console.error(`  ! ${tenant.name} already has a site "${slug}" — nothing to do`);
      continue;
    }

    // Where its leads will land. A site with no default pipeline accepts a
    // lead and then has nowhere to put the deal, which reads as "the form is
    // broken" long before anyone looks at the site's configuration.
    const [pipeline] = await listPipelines(ctx);
    if (!pipeline) {
      console.error(
        `  ! ${tenant.name} has no pipeline — create one in the CRM first, or its leads have nowhere to go`,
      );
      continue;
    }
    const [stage] = await listStagesForPipeline(ctx, pipeline.id);

    if (dryRun) {
      console.log(
        `  + would create ${rawDomain} in ${tenant.name} (slug ${slug}, pipeline ${pipeline.name})`,
      );
      continue;
    }

    const site = await createSite(ctx, {
      name: tenant.name,
      slug,
      domain: rawDomain,
      isActive: true,
      defaultPipelineId: pipeline.id,
      defaultStageId: stage?.id,
    });

    created.push(`${rawDomain}\n    business: ${tenant.name}\n    pipeline: ${pipeline.name}\n    key:      ${site.apiKey}`);
  }

  if (created.length > 0) {
    console.log(`\nCreated ${created.length} site(s) — each is LIVE and accepting leads:\n`);
    for (const line of created) console.log(`  + ${line}\n`);
    console.log("  Those keys are shown once. Copy them now.\n");
  } else if (!dryRun) {
    console.log("\nNothing created.\n");
  } else {
    console.log("\nDry run — nothing was written.\n");
  }

  // Existing sites for context, so it is obvious whether the business now has
  // one site or accidentally two.
  for (const pair of pairs) {
    const name = pair.split("=")[0]?.trim();
    const tenant = name ? byName.get(name.toLowerCase()) : undefined;
    if (!tenant) continue;
    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) continue;
    const sites = await listSites(ctx);
    console.log(
      `  ${tenant.name}: ${sites.length} site(s) — ${sites.map((s) => s.slug).join(", ") || "none"}`,
    );
  }
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
