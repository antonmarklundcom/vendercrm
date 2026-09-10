// Loads `.env` before anything imports `@/lib/config/env` — see
// scripts/grant-shared-admin.ts for why.
import "dotenv/config";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getUserByEmail } from "@/modules/tenancy/users";
import { updateSite, getSite } from "@/modules/sites/sites";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { listRowsAwaitingOwner, markRowLive, retireTestLead } from "@/modules/ops";

// Bulk go-live for Claude Ops rows (PLAN.md §18.4).
//
// The console approves one row at a time on purpose: §18.1.4 makes go-live
// the owner's decision rather than a session's, and one row at a time is what
// makes "decision" mean anything — you look at the site, then you approve it.
// That reasoning holds for a batch of five and collapses at fifty, where the
// realistic alternative is not fifty considered decisions but fifty clicks
// made without looking.
//
// So this is the same decision, taken once, out loud, by the owner at his own
// keyboard with his own database credentials. It does exactly what
// approveRowAction does per row — activate the site, delete the test lead and
// its deal, mark the row live, write the audit entry — so the log cannot tell
// the two apart except by the `via` marker, which says `script:<userId>`
// rather than `console:<userId>`. It is deliberately NOT reachable from an
// ops token: a session must never be able to put its own work live.
//
// Usage:
//   npx tsx scripts/approve-sites.ts <your-superadmin-email> --dry-run
//   npx tsx scripts/approve-sites.ts <your-superadmin-email>
//   npx tsx scripts/approve-sites.ts <your-superadmin-email> --only dentista,gruas

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyIndex = args.indexOf("--only");
  const only =
    onlyIndex >= 0 && args[onlyIndex + 1]
      ? new Set(
          args[onlyIndex + 1]!
            .split(",")
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean),
        )
      : null;

  const [email] = args.filter((arg) => !arg.startsWith("--") && arg.includes("@"));
  if (!email) {
    console.error(
      "Usage: npx tsx scripts/approve-sites.ts <superadmin-email> [--only a,b] [--dry-run]",
    );
    process.exit(1);
  }

  const actor = await getUserByEmail(email.trim().toLowerCase());
  if (!actor) {
    console.error(`No user with e-mail ${email}`);
    process.exit(1);
  }
  if (!actor.isSuperadmin) {
    // The audit entry names this person as having taken the decision, and
    // activating a site is a platform action. It should not be attributable
    // to someone who could not have taken it in the console either.
    console.error(`${email} is not a superadmin — only a superadmin approves a site.`);
    process.exit(1);
  }

  const rows = await listRowsAwaitingOwner();
  if (rows.length === 0) {
    console.log("\nNothing is awaiting approval.\n");
    process.exit(0);
  }

  const approved: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    if (only && !only.has(row.domain.split(".")[0]!.toLowerCase())) continue;

    if (!row.tenantId || !row.siteId) {
      skipped.push(`${row.domain} — no site to activate`);
      continue;
    }

    const ctx = await buildSystemTenantContext(row.tenantId);
    if (!ctx) {
      skipped.push(`${row.domain} — business not found`);
      continue;
    }

    const site = await getSite(ctx, row.siteId);
    if (!site) {
      skipped.push(`${row.domain} — site not found`);
      continue;
    }

    if (dryRun) {
      approved.push(`${row.domain} (${site.slug})`);
      continue;
    }

    await updateSite(ctx, row.siteId, { isActive: true });
    await retireTestLead(ctx, {
      contactId: row.testContactId,
      dealId: row.testDealId,
    });

    await markRowLive(row.id);
    await writeAuditLog({
      tenantId: row.tenantId,
      actorUserId: actor.id,
      action: "site.activated",
      entity: "site",
      entityId: row.siteId,
      payload: { via: `script:${actor.id}`, batch_id: row.batchId, row_id: row.id },
    });

    approved.push(`${row.domain} (${site.slug})`);
  }

  const verb = dryRun ? "would activate" : "activated";
  console.log(`\n${verb} ${approved.length} site(s):`);
  for (const line of approved.sort()) console.log(`  + ${line}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const line of skipped.sort()) console.log(`  ? ${line}`);
  }
  console.log(
    dryRun
      ? "\nDry run — nothing was written. Re-run without --dry-run to apply.\n"
      : "\nThose sites now accept leads. Their test leads have been removed.\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
