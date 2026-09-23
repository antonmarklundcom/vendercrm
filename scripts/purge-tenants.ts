// Loads `.env` before anything imports `@/lib/config/env` — see
// scripts/grant-shared-admin.ts for why.
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import {
  executeServerPurge,
  planServerPurge,
  ServerPurgeError,
} from "@/modules/tenancy/purge";

// Wipes every business on the server so the network can be provisioned again
// from a clean slate (scripts/provision-sites.mjs).
//
// The app deletes businesses one at a time, behind a typed confirmation on
// the console's business page. This is for the one time that the whole
// server is wanted gone — a platform full of demo and trial businesses — and
// it is run by the owner, at his own keyboard, against a database he has
// backed up (docs/BACKUPS.md). There is no undo.
//
// What it removes (src/modules/tenancy/purge.ts): every business and every
// row under it, all Claude Ops history, every user who is neither a
// superadmin nor named with --keep-user (with their sessions and logins),
// and every uploaded file those businesses own in storage (quote/document/
// contract PDFs, WhatsApp media, memory-import PDFs) — swept after the
// database commit, best-effort: a storage failure is counted, never allowed
// to fail or undo the deletion itself.
// What it keeps: superadmins, the --keep-user accounts, plans, ops tokens
// (allowlists emptied) and platform-level rows.
//
// Before it deletes anything it writes every site domain to a file in
// scripts/domains.txt format, so the list to re-provision survives the wipe.
// The dry run writes it too.
//
// Usage:
//   npx tsx scripts/purge-tenants.ts --keep-user owner@example.com
//       dry run: shows what would go, writes the domains file, deletes nothing
//   npx tsx scripts/purge-tenants.ts --keep-user owner@example.com --confirm "BORRAR TODO"

const CONFIRM_PHRASE = "BORRAR TODO";

function parseArgs(argv: string[]) {
  const keepEmails: string[] = [];
  let confirm: string | null = null;
  let out = `purged-businesses-${new Date().toISOString().slice(0, 10)}.txt`;
  for (let i = 0; i < argv.length; i++) {
    const [arg, next] = [argv[i], argv[i + 1]];
    if (arg === "--keep-user" && next) keepEmails.push(next);
    else if (arg === "--confirm" && next !== undefined) confirm = next;
    else if (arg === "--out" && next) out = next;
    else {
      console.error(`Unknown or incomplete argument: ${arg}`);
      process.exit(1);
    }
    i++;
  }
  if (confirm !== null && confirm !== CONFIRM_PHRASE) {
    console.error(`--confirm must be exactly "${CONFIRM_PHRASE}".`);
    process.exit(1);
  }
  return { keepEmails, confirmed: confirm === CONFIRM_PHRASE, out };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = await planServerPurge(args.keepEmails);
  const today = new Date().toISOString().slice(0, 10);

  await writeFile(
    args.out,
    [
      `# Site domains of the businesses on the server before the purge of ${today}.`,
      "# scripts/domains.txt format — review, then feed to scripts/provision-sites.mjs.",
      "",
      ...plan.domains.map((d) => (d.businessName ? `${d.domain}, ${d.businessName}` : d.domain)),
      "",
      ...(plan.tenantsWithoutDomain.length
        ? [
            "# Businesses with no site domain (not re-provisioned by this list):",
            ...plan.tenantsWithoutDomain.map((t) => `#   ${t.name} (${t.slug})`),
          ]
        : []),
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`\nBusinesses: ${plan.tenants.length}`);
  for (const t of plan.tenants) console.log(`  - ${t.name} (${t.slug})`);
  console.log(`\nUsers kept: ${plan.keptUsers.map((u) => u.email).join(", ")}`);
  console.log(`Users deleted: ${plan.deletedUsers.length}`);
  for (const email of plan.deletedUsers) console.log(`  - ${email}`);
  console.log("\nRows under those businesses:");
  for (const r of plan.rows) console.log(`  ${r.table.padEnd(32)} ${r.rows}`);
  console.log(`\nDomains for re-provisioning written to ${args.out} (${plan.domains.length}).`);

  if (!args.confirmed) {
    console.log(`\nDry run — nothing was deleted. Re-run with --confirm "${CONFIRM_PHRASE}" to apply.\n`);
    process.exit(0);
  }

  const files = await executeServerPurge(plan);
  console.log(`\nDeleted ${plan.tenants.length} businesses and ${plan.deletedUsers.length} users.`);
  console.log(
    `Storage: ${files.deleted} file(s) deleted${files.failed ? `, ${files.failed} failed (see logs above)` : ""}.\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof ServerPurgeError ? `${err.message}. Nothing done.` : err);
  process.exit(1);
});
