import { db } from "@/db/client";
import { tenants, tenantMemberships, users } from "@/db/schema/tenancy";
import { inArray, eq } from "drizzle-orm";

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("Usage: npx tsx scripts/check-slug-owner.ts <slug> [slug...]");
    process.exit(1);
  }

  const rows = await db.select().from(tenants).where(inArray(tenants.slug, slugs));
  for (const tenant of rows) {
    console.log(`\nTenant: ${tenant.name} (slug: ${tenant.slug}, id: ${tenant.id})`);
    const memberships = await db
      .select({ email: users.email, role: tenantMemberships.role })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(eq(tenantMemberships.tenantId, tenant.id));
    for (const m of memberships) console.log(`  member: ${m.email} (${m.role})`);
  }
  if (rows.length === 0) console.log("No matching tenants found.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
