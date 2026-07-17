import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  userAc,
} from "better-auth/plugins/admin/access";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import { env } from "@/lib/config/env";
import { newId } from "@/lib/ids";
import { user, session, account, verification } from "@/db/schema";

// Access control for the admin plugin. We define a single platform role,
// `superadmin`, granted the full admin statement set (including `impersonate`).
// `adminRoles: ["superadmin"]` then gates all admin/impersonation endpoints on
// this role. Regular users get the built-in `user` role (no admin powers).
const ac = createAccessControl(defaultStatements);
const superadminRole = ac.newRole({
  ...adminAc.statements,
});

// Better Auth operates on the platform-level auth tables (user/session/account/
// verification), which are intentionally NOT tenant-scoped — login must resolve
// a user by email across the whole platform. This is why the auth module is on
// the raw-`db` allowlist (PLAN.md §3.3): tenant isolation is enforced above this
// layer by getTenantContext/tenantDb, not inside Better Auth.
//
// Role model reconciliation (flagged for the 1B review gate): the admin
// plugin's `role` field carries the PLATFORM role (`superadmin` | `user`) and
// gates impersonation via `adminRoles`. The tenant role from PLAN.md §3.2
// (`admin` | `agent`) lives in the separate `tenant_role` column. Superadmins
// are `role === "superadmin"` with `tenant_id = NULL`.
export const auth = betterAuth({
  appName: "VenderCRM",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "mysql",
    schema: { user, session, account, verification },
  }),
  advanced: {
    // char(26) ULID PKs everywhere (PLAN.md §2.3).
    database: { generateId: () => newId() },
  },
  emailAndPassword: {
    enabled: true,
    // No public self-service signup in Phase 1: superadmin creates tenants +
    // their first admin; tenant admins invite the rest. Verification/reset
    // email delivery is wired in 1G (Sentry/email); tokens are persisted now.
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      tenantId: { type: "string", required: false, input: false },
      tenantRole: { type: "string", required: false, input: false },
    },
  },
  plugins: [
    admin({
      ac,
      roles: { superadmin: superadminRole, user: userAc },
      defaultRole: "user",
      adminRoles: ["superadmin"],
    }),
    // Must be last: lets server actions set auth cookies (Next.js).
    nextCookies(),
  ],
});

export type Auth = typeof auth;
