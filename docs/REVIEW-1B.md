# 1B review notes — for the Fable review gate

Sub-phase 1B (auth, tenancy & superadmin) is built and its exit criteria pass.
This note flags the decisions that reconcile the spec with Better Auth's actual
behavior, per the plan's instruction to surface genuine gaps rather than
improvise silently.

## 1. Role model reconciliation (the one real deviation from §4)

**Gap:** PLAN.md §4 lists `users.role (admin|agent)` + `users.is_superadmin`.
Better Auth's admin plugin — which §2.3 mandates for impersonation — owns its
own `role` field and uses it to gate every admin/impersonation endpoint. Two
different meanings of "role" cannot share one column.

**Decision:**
- The admin plugin's `role` column holds the **platform** role: `superadmin` or
  `user`. `adminRoles: ["superadmin"]` gates impersonation on it. A dedicated
  access-control role (`superadmin`) is defined with the full admin statement
  set including `impersonate`.
- The **tenant** role from §3.2 (`admin` | `agent`) lives in a separate
  `tenant_role` column.
- `is_superadmin` is **not** stored as a redundant boolean; it is derived
  (`role === "superadmin"`) and surfaced as `SessionContext.isSuperadmin`. This
  avoids two out-of-sync sources of truth for "is this a superadmin".

Net effect matches §3.2's intent (superadmin has `tenant_id = NULL`; tenant
users have a tenant role) with one column rename (`is_superadmin` flag →
derived) that the review gate should bless or override.

## 2. "Middleware" is layout-level, not edge middleware

§1B says "tenant suspension/expiry middleware". Implemented as a guard in the
tenant app layout (`src/app/(app)/layout.tsx`) rather than Next.js edge
`middleware.ts`, because the gate needs a DB lookup (subscription state) and
mysql2 can't run on the edge runtime. Correct for the single-process Hostinger
target (§2.1). Grace → read-only banner; expired/suspended → locked screen.

## 3. User creation bypasses signUpEmail on purpose

All server-side user creation (superadmin seed, tenant admin, invited users)
goes through one helper that inserts the user + a credential account with a
Better-Auth-hashed password, and deliberately does **not** create a session —
so an admin creating a user is never silently logged in as them. Verified:
every such user signs in normally afterward.

## 4. CSRF / Origin

Better Auth enforces an Origin check on admin endpoints. In production this
requires `APP_URL` (→ `baseURL`/trustedOrigins) to match the deployed origin.
Same-origin server actions (the console) satisfy this automatically; noted for
the 1G deploy runbook.

## Exit criteria — verified

- Cross-tenant isolation suite green (`src/modules/tenancy/isolation.integration.test.ts`).
- Superadmin creates a tenant, records a payment, impersonates — verified over
  HTTP against a real MySQL (impersonation session carries the tenant user +
  `impersonatedBy` = superadmin, and routes to `/app`).
- Expired subscription and suspended tenant both lock the tenant out.
