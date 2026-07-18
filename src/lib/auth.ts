import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import { generateId } from "@/lib/ids";
import { env } from "@/lib/config/env";

export const auth = betterAuth({
  baseURL: env.APP_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "mysql" }),
  advanced: {
    database: {
      generateId: () => generateId(),
    },
  },
  emailAndPassword: {
    enabled: true,
    // No public sign-up page is ever shipped — accounts are always created
    // server-side (invite acceptance, superadmin tenant creation).
    disableSignUp: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day of activity
  },
  user: {
    additionalFields: {
      tenantId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  plugins: [
    admin({
      adminRoles: ["superadmin"],
      defaultRole: "agent",
      impersonationSessionDuration: 60 * 60, // 1 hour
      // Registering "admin" (tenant admin) and "agent" here is only to widen
      // the TS role union for `auth.api.createUser`/`setRole`; neither maps
      // to Better-Auth-admin permissions (adminRoles only lists "superadmin").
      roles: {
        superadmin: adminAc,
        admin: userAc,
        agent: userAc,
      },
    }),
    // Must be last: forwards Set-Cookie from auth.api.* calls made in Server
    // Actions/Components to Next's cookies() — without it, session cookies
    // set outside the /api/auth/[...all] route handler (e.g. impersonation
    // triggered from a superadmin Server Action) are silently dropped.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
