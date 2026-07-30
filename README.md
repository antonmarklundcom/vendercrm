# VenderCRM

WhatsApp-first multi-tenant sales CRM for Paraguay. See `PLAN.md` for the
full architecture and build plan.

## Getting started

```bash
cp .env.example .env   # fill in DATABASE_URL, APP_ENCRYPTION_KEY, CRON_SECRET
npm install
npm run db:migrate
npm run dev
```

The job queue worker starts in-process automatically (via
`src/instrumentation.ts`). To run it standalone: `npm run worker`.

## First login (there is no default account)

Nothing is seeded automatically and there is no default password. Public sign-up is
closed — Better Auth's `/sign-up/email` only accepts invited addresses — so the first
two accounts have to be created from a shell that can reach the database. Run these
from a **local machine** against the database (for production, via Hostinger's Remote
MySQL host — see `docs/DEPLOY.md` §2–3; not Hostinger SSH).

Both scripts read `.env` (as does `db:migrate`), so fill that in first rather than
exporting variables by hand. They import the app's validated config, so **every**
mandatory var in `.env.example` must be present — not just `DATABASE_URL` — or they
exit before touching the database.

```bash
# Platform superadmin — no tenant, manages all tenants
npm run create-superadmin -- <email> <password> "<Full Name>"

# A tenant plus its first admin user (idempotent; re-run to reset the password)
npm run seed-tenant -- "<Tenant Name>" <tenant-slug> <admin-email> <admin-password> "<Admin Name>"
```

Both write directly through the tenancy module. Pick real passwords here — they are the
live credentials, not placeholders.

### Where to log in

There is one login page for everyone; where you land depends on the account. Route
groups don't add a URL prefix, so there is no `/superadmin` path:

| Role | URL | What you get |
|---|---|---|
| Everyone | `/login` | Single sign-in page |
| Superadmin | `/tenants`, `/plans`, `/whatsapp-health` | Create/suspend tenants, record payments, "ver como" impersonation, platform WhatsApp health |
| Tenant admin/agent | `/dashboard`, `/contacts`, `/pipeline`, `/inbox`, `/quotes`, `/automations`, … | The CRM itself |

Superadmin is the `users.is_superadmin` flag with `tenant_id = NULL`; app authorization
never trusts `users.role` alone (PLAN.md §3.2).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run lint` / `typecheck` / `test` | CI checks |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run worker` | Run the job queue worker as a standalone process |

## Deploy on Vercel

Not applicable — this project targets Hostinger managed Node.js hosting per
`PLAN.md` §2.1.
