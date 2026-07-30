// Must be the first import: it populates process.env before the module graph
// below reaches lib/config/env, which validates it at load time. Same pattern
// as drizzle.config.ts — tsx doesn't read .env on its own.
import "dotenv/config";
import { createSuperadminUser } from "@/modules/tenancy/users";

// Superadmin bootstrap (PLAN.md §10 1C follow-up #2). Better Auth's public
// /sign-up/email is gated to invited emails only (lib/auth/server.ts), and
// invitations can only be created by an existing tenant admin or superadmin
// — so the very first superadmin can't come through the app at all.
//
// Usage: npx tsx scripts/create-superadmin.ts <email> <password> <name>

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error("Usage: npx tsx scripts/create-superadmin.ts <email> <password> <name>");
    process.exit(1);
  }

  const user = await createSuperadminUser({ email, password, name });
  console.log(`Superadmin created: ${email} (${user?.id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
