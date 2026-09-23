import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { db } from "@/db/client";
import { sites, tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { issueApiKey, listActiveApiKeys, revokeApiKey } from "@/modules/sites/keys";

// One-off recovery: the plaintext keys from the original provisioning run
// were deleted before being saved anywhere. A key's plaintext only ever
// exists at issue time (the CRM stores just a hash), so the lost ones are
// gone for good — this issues a fresh key per site, then revokes whatever
// key it had before, leaving exactly one known-good key per site.
//
// Usage: npx tsx scripts/reissue-all-keys.ts

async function main() {
  const rows = await db
    .select({
      siteId: sites.id,
      domain: sites.domain,
      slug: sites.slug,
      tenantId: sites.tenantId,
      tenantName: tenants.name,
    })
    .from(sites)
    .innerJoin(tenants, eq(tenants.id, sites.tenantId));

  const results: { domain: string | null; slug: string; tenant: string; apiKey: string }[] = [];

  for (const row of rows) {
    const ctx = await buildSystemTenantContext(row.tenantId);
    if (!ctx) {
      console.log(`  SKIP ${row.domain} — tenant not found`);
      continue;
    }

    const before = await listActiveApiKeys(ctx, row.siteId);

    const issued = await issueApiKey(ctx, row.siteId, "reissued after lost provisioning file");
    if (!issued.ok) {
      console.log(`  SKIP ${row.domain} — ${issued.error}`);
      continue;
    }

    for (const oldKey of before) {
      await revokeApiKey(ctx, row.siteId, oldKey.id);
    }

    results.push({
      domain: row.domain,
      slug: row.slug,
      tenant: row.tenantName,
      apiKey: issued.plaintext,
    });
    console.log(`  OK ${row.domain} (${row.slug})`);
  }

  const out = `vendercrm-site-keys-${new Date().toISOString().slice(0, 10)}.md`;
  const lines = [
    "# VenderCRM site API keys",
    "",
    "One key per site. Keep this file out of every repository.",
    "",
    "| Domain | Slug | Tenant | API key |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.domain} | ${r.slug} | ${r.tenant} | \`${r.apiKey}\` |`),
    "",
  ];
  await writeFile(out, lines.join("\n"), "utf8");

  console.log(`\nDone: ${results.length} key(s) issued.`);
  console.log(`Written to ${out} — keep it out of every repository.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
