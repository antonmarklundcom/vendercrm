import { eq } from "drizzle-orm";
import { db } from "./client";
import { user } from "./schema";
import { createSuperadmin } from "@/modules/tenancy/service";

// Bootstraps the first platform superadmin from env. Idempotent: skips if a
// user with the email already exists. Run with:
//   SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... npm run db:seed
async function main() {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  const name = process.env.SEED_SUPERADMIN_NAME ?? "Superadmin";

  if (!email || !password) {
    throw new Error(
      "SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD are required",
    );
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);

  if (existing) {
    console.log(`Superadmin ${email} already exists — skipping.`);
  } else {
    const id = await createSuperadmin({ email, password, name });
    console.log(`Created superadmin ${email} (${id}).`);
  }

  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
