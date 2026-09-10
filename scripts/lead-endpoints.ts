// Loads `.env` before anything imports `@/lib/config/env` — see
// scripts/grant-shared-admin.ts for why.
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { env } from "@/lib/config/env";
import { listTenants } from "@/modules/tenancy/tenants";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { listSites } from "@/modules/sites/sites";
import { issueApiKey, listActiveApiKeys, revokeApiKey } from "@/modules/sites/keys";

// One page listing every business, its site, and what a website needs to post
// leads into it (PLAN.md §5.1) — so wiring a contact form is a copy rather
// than a hunt through the console, and so a coding session can be handed the
// whole network at once.
//
// The awkward part is the key, and it is awkward on purpose. Keys are stored
// SHA-256 hashed and never encrypted (`src/modules/sites/keys.ts`): nothing
// can read one back, only compare one. A key whose plaintext was not captured
// at issue time is therefore gone, and the site holding it is the only thing
// that still knows it. So this script has two modes:
//
//   default        report what exists, including how many keys each site
//                  holds. Writes no key, changes nothing.
//   --revoke-superseded
//                  keep each site's newest active key and revoke the rest.
//                  After an --issue-keys run a site provisioned earlier holds
//                  two: the fresh one, in the file you just generated, and the
//                  original, whose plaintext was never captured and which
//                  nobody can therefore use or rotate. A live credential no
//                  one holds is only risk, and it occupies the second of the
//                  two slots. Newest-first is exact here, not a guess:
//                  listApiKeys sorts by createdAt descending.
//   --issue-keys   issue a *fresh* key per site and print it, which is the
//                  only way to get a usable list when the originals were not
//                  kept. A site may hold two at once (MAX_ACTIVE_KEYS_PER_SITE),
//                  so this does not disturb a key already deployed on a live
//                  site — both keep working until you revoke one.
//
// Usage:
//   npx tsx scripts/lead-endpoints.ts                        # report only
//   npx tsx scripts/lead-endpoints.ts --issue-keys           # + new keys
//   npx tsx scripts/lead-endpoints.ts --issue-keys --out ../lead-endpoints.md
//   npx tsx scripts/lead-endpoints.ts --revoke-superseded
//
// The output holds live credentials for every site in the network. It is
// written outside the repository by default for that reason; keep it out of
// any site repo, and put each site's own key in that site's hosting
// environment rather than committing the list.

type Row = {
  business: string;
  tenantId: string;
  domain: string;
  siteSlug: string;
  siteId: string;
  isActive: boolean;
  activeKeys: number;
  newKey: string | null;
  revoked: number;
  note: string | null;
};

function mdEscape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function buildMarkdown(rows: Row[], endpoint: string, issued: boolean): string {
  const withSite = rows.filter((r) => r.siteId);
  const noSite = rows.filter((r) => !r.siteId);
  const live = withSite.filter((r) => r.isActive).length;

  const lines: string[] = [];

  lines.push("# VenderCRM — lead endpoints");
  lines.push("");
  lines.push(
    "Everything a website needs to post a lead into the CRM. One row per site.",
  );
  lines.push("");
  lines.push(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  lines.push("");

  if (issued) {
    lines.push("> **This file contains live API keys.** Do not commit it to any");
    lines.push("> repository. Copy each site's key into that site's own hosting");
    lines.push("> environment variable, then keep this file somewhere private or");
    lines.push("> delete it — a key is recoverable only by issuing a new one.");
    lines.push("");
  }

  lines.push("## How to post a lead");
  lines.push("");
  lines.push("```http");
  lines.push(`POST ${endpoint}`);
  lines.push("Content-Type: application/json");
  lines.push("X-Api-Key: <the site's key from the table below>");
  lines.push("");
  lines.push("{");
  lines.push('  "phone": "+595981123456",');
  lines.push('  "name": "Nombre del cliente",');
  lines.push('  "email": "cliente@example.com",');
  lines.push('  "message": "Consulta desde el formulario",');
  lines.push('  "source": "web",');
  lines.push('  "idempotency_key": "<unique per submission>"');
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push(
    "`phone` is the identity — a lead with the same phone updates the existing",
  );
  lines.push(
    "contact rather than creating a second one. `idempotency_key` makes a retry",
  );
  lines.push("safe. The lead lands in the pipeline stage configured for that site.");
  lines.push("");
  lines.push(
    "**A site must be active to accept leads.** An inactive site answers 403 — go",
  );
  lines.push("live from **Sitios** inside that business.");
  lines.push("");
  lines.push("### Responses");
  lines.push("");
  lines.push("| Status | Meaning |");
  lines.push("| --- | --- |");
  lines.push("| 200 / 201 | Accepted. The contact and deal exist in the CRM. |");
  lines.push("| 401 | The key is wrong, or was revoked. |");
  lines.push("| 403 | The site is not active yet. Approve it in Claude Ops. |");
  lines.push("| 422 | The body failed validation — the message names the field. |");
  lines.push("| 429 | Too many submissions from this key. Back off and retry. |");
  lines.push("");
  lines.push("### PHP (static site with a form handler)");
  lines.push("");
  lines.push("```php");
  lines.push("<?php");
  lines.push("$payload = [");
  lines.push("  'phone'           => $_POST['telefono'],");
  lines.push("  'name'            => $_POST['nombre'],");
  lines.push("  'message'         => $_POST['mensaje'] ?? '',");
  lines.push("  'source'          => 'web',");
  lines.push("  'idempotency_key' => bin2hex(random_bytes(16)),");
  lines.push("];");
  lines.push("");
  lines.push("$ch = curl_init(getenv('VCRM_ENDPOINT'));");
  lines.push("curl_setopt_array($ch, [");
  lines.push("  CURLOPT_POST           => true,");
  lines.push("  CURLOPT_RETURNTRANSFER => true,");
  lines.push("  CURLOPT_TIMEOUT        => 10,");
  lines.push("  CURLOPT_HTTPHEADER     => [");
  lines.push("    'Content-Type: application/json',");
  lines.push("    'X-Api-Key: ' . getenv('VCRM_API_KEY'),");
  lines.push("  ],");
  lines.push("  CURLOPT_POSTFIELDS     => json_encode($payload),");
  lines.push("]);");
  lines.push("$response = curl_exec($ch);");
  lines.push("$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);");
  lines.push("curl_close($ch);");
  lines.push("");
  lines.push("// Never block the visitor on the CRM. Show the thank-you page either");
  lines.push("// way and log the failure for yourself.");
  lines.push("if ($status >= 300) { error_log(\"VenderCRM $status: $response\"); }");
  lines.push("header('Location: /gracias.html');");
  lines.push("```");
  lines.push("");
  lines.push("### Next.js (route handler)");
  lines.push("");
  lines.push("```js");
  lines.push("export async function POST(request) {");
  lines.push("  const form = await request.json();");
  lines.push("");
  lines.push("  const response = await fetch(process.env.VCRM_ENDPOINT, {");
  lines.push("    method: 'POST',");
  lines.push("    headers: {");
  lines.push("      'Content-Type': 'application/json',");
  lines.push("      'X-Api-Key': process.env.VCRM_API_KEY,");
  lines.push("    },");
  lines.push("    body: JSON.stringify({");
  lines.push("      phone: form.phone,");
  lines.push("      name: form.name,");
  lines.push("      email: form.email,");
  lines.push("      message: form.message,");
  lines.push("      source: 'web',");
  lines.push("      idempotency_key: crypto.randomUUID(),");
  lines.push("    }),");
  lines.push("  });");
  lines.push("");
  lines.push("  if (!response.ok) console.error('VenderCRM', response.status, await response.text());");
  lines.push("  return Response.json({ ok: true });");
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("### Rules that are easy to get wrong");
  lines.push("");
  lines.push("1. **The key is a server-side secret.** It goes in the hosting");
  lines.push("   environment, never in client JavaScript and never in the repo. A key");
  lines.push("   in a browser bundle can be used by anyone to write into the CRM.");
  lines.push("2. **Post from the server, not the browser.** Besides leaking the key,");
  lines.push("   the endpoint sets no CORS headers for arbitrary origins.");
  lines.push("3. **Never block the visitor on this call.** If the CRM is slow or down,");
  lines.push("   still show the thank-you page and log the failure.");
  lines.push("4. **Send a fresh `idempotency_key` per submission** — a UUID is fine.");
  lines.push("   Reusing one silently drops the second lead as a duplicate.");
  lines.push("5. **`phone` is the identity.** Include it, in international format");
  lines.push("   (`+595...`). Without it the CRM cannot match a returning customer,");
  lines.push("   and WhatsApp replies will not thread onto the contact.");
  lines.push("6. **One key per site.** Do not reuse a key across domains — the key is");
  lines.push("   what tells the CRM which business the lead belongs to.");
  lines.push("");
  lines.push(
    `The repository's \`vendercrm-lead-capture\` skill has fuller examples for`,
  );
  lines.push("static HTML+PHP, Node/Express, Next.js and WordPress.");
  lines.push("");

  lines.push("## Sites");
  lines.push("");
  lines.push(`${withSite.length} sites, ${live} live.`);
  lines.push("");

  const header = issued
    ? "| Domain | Business | Site slug | Live | API key |"
    : "| Domain | Business | Site slug | Live | Keys held |";
  const rule = issued
    ? "| --- | --- | --- | --- | --- |"
    : "| --- | --- | --- | --- | --- |";

  lines.push(header);
  lines.push(rule);

  for (const row of withSite.sort((a, b) => a.domain.localeCompare(b.domain))) {
    const last = issued
      ? row.newKey
        ? `\`${row.newKey}\``
        : `_${row.note ?? "not issued"}_`
      : String(row.activeKeys);
    lines.push(
      `| ${mdEscape(row.domain || "—")} | ${mdEscape(row.business)} | \`${row.siteSlug}\` | ${row.isActive ? "yes" : "no"} | ${last} |`,
    );
  }
  lines.push("");

  if (noSite.length > 0) {
    lines.push("## Businesses with no site yet");
    lines.push("");
    lines.push(
      "These exist in the CRM but have nothing to post leads at. Provision a site",
    );
    lines.push("for them, or leave them if the domain is retired.");
    lines.push("");
    for (const row of noSite.sort((a, b) => a.business.localeCompare(b.business))) {
      lines.push(`- ${mdEscape(row.business)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const issue = args.includes("--issue-keys");
  const revokeSuperseded = args.includes("--revoke-superseded");
  const outIndex = args.indexOf("--out");
  const out =
    outIndex >= 0 && args[outIndex + 1]
      ? args[outIndex + 1]!
      : "../vendercrm-lead-endpoints.md";

  const endpoint = `${env.APP_URL.replace(/\/$/, "")}/api/v1/leads`;
  const rows: Row[] = [];

  for (const tenant of await listTenants()) {
    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) continue;

    const sites = await listSites(ctx);
    if (sites.length === 0) {
      rows.push({
        business: tenant.name,
        tenantId: tenant.id,
        domain: "",
        siteSlug: "",
        siteId: "",
        isActive: false,
        activeKeys: 0,
        newKey: null,
        revoked: 0,
        note: null,
      });
      continue;
    }

    for (const site of sites) {
      let active = await listActiveApiKeys(ctx, site.id);
      let newKey: string | null = null;
      let note: string | null = null;
      let revoked = 0;

      // Before issuing, not after: a site already holding two keys would
      // otherwise be refused, and the key being dropped here is by
      // construction one nobody can use.
      if (revokeSuperseded && active.length > 1) {
        for (const key of active.slice(1)) {
          await revokeApiKey(ctx, site.id, key.id);
          revoked++;
        }
        active = await listActiveApiKeys(ctx, site.id);
      }

      if (issue) {
        const result = await issueApiKey(ctx, site.id, "lead-form");
        if (result.ok) {
          newKey = result.plaintext;
        } else {
          // Two live keys already. Refusing beats silently revoking one the
          // site may still be posting with.
          note = "2 keys already active — revoke one in Sitios, then re-run";
        }
      }

      rows.push({
        business: tenant.name,
        tenantId: tenant.id,
        domain: site.domain ?? "",
        siteSlug: site.slug,
        siteId: site.id,
        isActive: site.isActive,
        activeKeys: active.length,
        newKey,
        revoked,
        note,
      });
    }
  }

  await writeFile(out, buildMarkdown(rows, endpoint, issue), "utf8");

  const withSite = rows.filter((r) => r.siteId);
  const issued = rows.filter((r) => r.newKey).length;
  const blocked = rows.filter((r) => r.note).length;
  const noSite = rows.length - withSite.length;

  console.log(`\nWrote ${out}`);
  console.log(`  ${withSite.length} sites across ${new Set(rows.map((r) => r.tenantId)).size} businesses`);
  console.log(`  ${withSite.filter((r) => r.isActive).length} live, ${withSite.length - withSite.filter((r) => r.isActive).length} inactive`);
  if (noSite > 0) console.log(`  ${noSite} business(es) with no site yet`);
  const revokedTotal = rows.reduce((sum, r) => sum + r.revoked, 0);
  if (revokedTotal > 0) {
    console.log(`  ${revokedTotal} superseded key(s) revoked`);
  }
  if (issue) {
    console.log(`  ${issued} new key(s) issued`);
    if (blocked > 0) console.log(`  ${blocked} site(s) already at the 2-key limit`);
    console.log("\n  That file holds live keys — keep it out of every repository.");
  } else {
    console.log("\n  No keys written. Re-run with --issue-keys to get usable ones.");
  }
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
