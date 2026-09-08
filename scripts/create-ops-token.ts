import { createOpsToken } from "@/modules/ops";
import { getUserByEmail } from "@/modules/tenancy/users";

// Claude Ops bootstrap (PLAN.md §18.6). The Claude Ops page (phase O2) is
// where the owner mints tokens; until it ships — and afterwards, from a
// server shell if the page is ever unreachable — this prints one.
//
// Usage: npx tsx scripts/create-ops-token.ts <superadmin-email> <label>
//
// The token is shown exactly once. Nothing stores the plaintext, so a lost
// token is replaced rather than recovered: revoke it on the page and run this
// again.

async function main() {
  const [email, label] = process.argv.slice(2);
  if (!email || !label) {
    console.error("Usage: npx tsx scripts/create-ops-token.ts <superadmin-email> <label>");
    process.exit(1);
  }

  const user = await getUserByEmail(email);
  if (!user) {
    console.error(`No user with e-mail ${email}`);
    process.exit(1);
  }
  if (!user.isSuperadmin) {
    // The token acts as this user forever: minting one for a tenant admin
    // would hand a machine credential more reach than the person holding it.
    console.error(`${email} is not a superadmin`);
    process.exit(1);
  }

  const token = await createOpsToken(
    { userId: user.id, impersonatorUserId: null },
    { label },
  );

  console.log(`\nOps token created (${label}) — shown once, copy it now:\n`);
  console.log(`VCRM_OPS_URL=${process.env.APP_URL ?? "https://crm.example.com"}`);
  console.log(`VCRM_OPS_TOKEN=${token.plaintext}\n`);
  console.log(`Prefix (what the console shows afterwards): ${token.prefix}`);
  console.log(
    "Allowlisted tenants: none. Add existing businesses on /claude-ops if this token should be able to create sites inside them.\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
