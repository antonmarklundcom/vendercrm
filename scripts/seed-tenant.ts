// Must be the first import: it populates process.env before the module graph
// below reaches lib/config/env, which validates it at load time. Same pattern
// as drizzle.config.ts — tsx doesn't read .env on its own.
import "dotenv/config";
import { createTenant, getTenantBySlug } from "@/modules/tenancy/tenants";
import {
  createTenantAdminUser,
  getUserByEmail,
  setUserPassword,
} from "@/modules/tenancy/users";
import type { SuperadminContext } from "@/modules/tenancy/context";

// Owner's real tenant bootstrap (PLAN.md §10 1H #1). Same reasoning as
// scripts/create-superadmin.ts: there's no admin session yet to create a
// tenant or invite its first admin through the normal app flow, so this
// inserts directly via the tenancy module. Idempotent — safe to re-run
// (e.g. to reset the admin password) since it looks up by slug/email
// before inserting.
//
// No PII is hardcoded here: everything comes from env vars or CLI args.
//
// Usage (env vars):
//   TENANT_NAME="Acme SRL" TENANT_SLUG=acme TENANT_ADMIN_EMAIL=admin@acme.com \
//   TENANT_ADMIN_PASSWORD=... TENANT_ADMIN_NAME="Admin Name" \
//   npx tsx scripts/seed-tenant.ts
//
// Usage (CLI args, same order):
//   npx tsx scripts/seed-tenant.ts <tenantName> <tenantSlug> <adminEmail> <adminPassword> <adminName> [locale] [timezone]

function required(value: string | undefined, label: string): string {
  if (!value) {
    console.error(`Missing ${label}. Set it via env var or CLI arg — see script header.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const argv = process.argv.slice(2);

  const tenantName = required(argv[0] ?? process.env.TENANT_NAME, "tenant name");
  const tenantSlug = required(argv[1] ?? process.env.TENANT_SLUG, "tenant slug");
  const adminEmail = required(argv[2] ?? process.env.TENANT_ADMIN_EMAIL, "admin email");
  const adminPassword = required(
    argv[3] ?? process.env.TENANT_ADMIN_PASSWORD,
    "admin password",
  );
  const adminName = required(argv[4] ?? process.env.TENANT_ADMIN_NAME, "admin name");
  const locale = argv[5] ?? process.env.TENANT_LOCALE;
  const timezone = argv[6] ?? process.env.TENANT_TIMEZONE;

  // Sentinel superadmin identity for the audit log — no real superadmin
  // session exists at seed time (same pattern as
  // tenancy/context.ts:buildSystemTenantContext's "system" userId).
  const systemCtx: SuperadminContext = { userId: "system", impersonatorUserId: null };

  let tenant = await getTenantBySlug(tenantSlug);
  if (tenant) {
    console.log(`Tenant already exists: ${tenant.slug} (${tenant.id})`);
  } else {
    tenant = await createTenant(systemCtx, {
      name: tenantName,
      slug: tenantSlug,
      locale,
      timezone,
    });
    if (!tenant) throw new Error("Tenant creation failed");
    console.log(`Tenant created: ${tenant.slug} (${tenant.id})`);
  }

  const existingUser = await getUserByEmail(adminEmail);
  if (existingUser) {
    if (existingUser.tenantId !== tenant.id) {
      throw new Error(
        `User ${adminEmail} already exists but belongs to a different tenant (${existingUser.tenantId}). Refusing to reassign.`,
      );
    }
    await setUserPassword(existingUser.id, adminPassword);
    console.log(`Admin user already existed, password reset: ${adminEmail} (${existingUser.id})`);
  } else {
    const user = await createTenantAdminUser({
      tenantId: tenant.id,
      email: adminEmail,
      password: adminPassword,
      name: adminName,
    });
    console.log(`Admin user created: ${adminEmail} (${user?.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
