import { listTenants } from "@/modules/tenancy/tenants";
import { getUserByEmail } from "@/modules/tenancy/users";
import {
  addMembership,
  getMembership,
  listMembershipsForTenant,
  removeMembership,
} from "@/modules/tenancy/memberships";

// Backfill for the shared-operator grant (PLAN.md §18.3).
//
// The provisioning API now grants `OPS_SHARED_ADMIN_EMAIL` an admin
// membership in every business it creates, so the owner reaches all of them
// from the sidebar switcher under one login. Businesses provisioned *before*
// that change have no such grant — each got its own per-tenant admin account
// instead, reachable only by opening a password-reset e-mail per business.
// This hands them to the shared account after the fact.
//
// It never creates, renames or deletes a user: e-mail is unique per account,
// so 23 businesses cannot share one address by relabelling them. Access to
// many businesses from one login is a membership per business, which is
// exactly what this adds.
//
// Idempotent: a business the account already reaches is reported and skipped,
// so a re-run after a partial failure costs nothing.
//
// Usage:
//   npx tsx scripts/grant-shared-admin.ts <email> [results.json ...]
//
// With no file, every business on the server is granted. With one or more
// JSON files, only the businesses they name: each file is scanned for
// `tenant_id` / `tenantId` values at any depth, so a provisioning-run log can
// be passed straight in whatever shape it happens to have.
//
// `--prune-aliases` additionally drops the per-tenant admin each of those
// businesses was provisioned with, where its address is a plus-alias of the
// shared account (owner+taller@example.com for owner@example.com). Only an
// alias of the operator's *own* address is ever touched, because that is the
// shape the old provisioning flow generated and nobody else's login can look
// like it. The user row itself stays: audit entries, deal ownership and
// timelines point at it, and nothing in this codebase deletes a user for that
// reason. Removing the membership is what takes the account out of the team
// list, and it runs after the grant above, so the business is never left
// without an admin.
//
//   npx tsx scripts/grant-shared-admin.ts owner@example.com --dry-run
//   npx tsx scripts/grant-shared-admin.ts owner@example.com results.json
//   npx tsx scripts/grant-shared-admin.ts owner@example.com results.json --prune-aliases

/** Every `tenant_id`/`tenantId` string anywhere in a parsed JSON value. */
function collectTenantIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTenantIds(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if ((key === "tenant_id" || key === "tenantId") && typeof child === "string" && child) {
      into.add(child);
    }
    collectTenantIds(child, into);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [email, ...files] = args.filter((arg) => !arg.startsWith("--"));

  if (!email) {
    console.error(
      "Usage: npx tsx scripts/grant-shared-admin.ts <email> [results.json ...] [--dry-run]",
    );
    process.exit(1);
  }

  const user = await getUserByEmail(email.trim().toLowerCase());
  if (!user) {
    console.error(`No user with e-mail ${email}`);
    process.exit(1);
  }
  if (user.isSuperadmin && !args.includes("--allow-superadmin")) {
    // §3.2: a superadmin already reaches every business by impersonation, and
    // a membership drops a platform account into a client's team list where a
    // tenant admin could demote it — which is why the superadmin console
    // refuses this outright. Here it is a warning rather than a wall: an
    // owner who is the only person on the platform may legitimately want the
    // switcher, and may already have memberships from an earlier manual
    // setup. Saying it out loud once is the point.
    console.error(
      `${email} is a superadmin.\n\n` +
        `  It already reaches every business through impersonation, and a membership also puts\n` +
        `  a platform account inside each client's team list, where a tenant admin could demote\n` +
        `  or deactivate it. The superadmin console refuses this for that reason.\n\n` +
        `  Re-run with --allow-superadmin if you want the sidebar switcher anyway.\n`,
    );
    process.exit(1);
  }

  // Resolve which businesses to touch, and their names, in one read: a
  // tenant id in a stale results file that no longer exists should be named
  // as skipped rather than fail an insert on a foreign key.
  const all = await listTenants();
  const byId = new Map(all.map((tenant) => [tenant.id, tenant]));

  let wanted: string[];
  if (files.length === 0) {
    wanted = all.map((tenant) => tenant.id);
  } else {
    const ids = new Set<string>();
    for (const file of files) {
      const { readFile } = await import("node:fs/promises");
      collectTenantIds(JSON.parse(await readFile(file, "utf8")), ids);
    }
    wanted = [...ids];
  }

  if (wanted.length === 0) {
    console.error("No businesses named. Pass a results file with tenant ids, or no file for all.");
    process.exit(1);
  }

  const prune = args.includes("--prune-aliases");
  const [localPart, domain] = user.email.toLowerCase().split("@");
  const aliasPrefix = `${localPart}+`;

  const granted: string[] = [];
  const already: string[] = [];
  const missing: string[] = [];
  const pruned: string[] = [];

  for (const tenantId of wanted) {
    const tenant = byId.get(tenantId);
    if (!tenant) {
      missing.push(tenantId);
      continue;
    }

    if (await getMembership(user.id, tenantId)) {
      already.push(tenant.name);
    } else {
      if (!dryRun) {
        await addMembership({ userId: user.id, tenantId, role: "admin" });
      }
      granted.push(tenant.name);
    }

    if (!prune) continue;

    // Only now, with the shared account holding admin here, is it safe to
    // drop the alias: `removeMembership` refuses to remove the last active
    // admin, and on a dry run that grant has not actually happened, so the
    // removal is reported rather than attempted.
    for (const { user: member } of await listMembershipsForTenant(tenantId)) {
      const email = member.email.toLowerCase();
      if (member.id === user.id) continue;
      if (!email.startsWith(aliasPrefix) || !email.endsWith(`@${domain}`)) continue;

      if (!dryRun) {
        await removeMembership(tenantId, member.id);
      }
      pruned.push(`${member.email} (${tenant.name})`);
    }
  }

  const verb = dryRun ? "would grant" : "granted";
  console.log(`\n${email} — ${verb} admin in ${granted.length} business(es):`);
  for (const name of granted.sort()) console.log(`  + ${name}`);
  if (already.length > 0) {
    console.log(`\nAlready a member of ${already.length}:`);
    for (const name of already.sort()) console.log(`  = ${name}`);
  }
  if (pruned.length > 0) {
    const pruneVerb = dryRun ? "would remove" : "removed";
    console.log(`\nPer-tenant alias admins ${pruneVerb} from their business (${pruned.length}):`);
    for (const line of pruned.sort()) console.log(`  - ${line}`);
    console.log("  (the user rows stay — audit history and deal ownership point at them)");
  }
  if (missing.length > 0) {
    console.log(`\nNamed in the file but not on this server (${missing.length}):`);
    for (const id of missing) console.log(`  ? ${id}`);
  }
  console.log(
    dryRun
      ? "\nDry run — nothing was written. Re-run without --dry-run to apply.\n"
      : "\nSign out and back in to see them in the sidebar switcher.\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
