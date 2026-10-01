# Fix: tenant admin gets the global error page on /dashboard

Run this in **Claude Code on my Windows PC** (not a cloud session): the
production MySQL only accepts my whitelisted IP. Repo: antonmarklundcom/vendercrm.

## Symptom
- https://crm.clientes.com.py/dashboard, logged in as marklundfaktura@gmail.com
  (normal tenant admin with ~27 businesses) shows the *global* error page:
  "Algo salió mal / La aplicación no pudo cargarse…", digest `3937366000`.
- Superadmin login works.
- That copy is `errors.global` → `src/app/global-error.tsx`, which means the crash
  is in a layout (most likely `src/app/(app)/layout.tsx`), not in the dashboard page
  (that would show `errors.app`, "No pudimos mostrar esta página").

## Main hypothesis: migrations not applied in production
The app does not migrate on boot (docs/DEPLOY.md §2). Recent migrations:
- `0042_add_user_telegram.sql`: new `users` columns
- `0043_add_tenant_mailbox.sql`: `tenants.mailbox_enabled`, `tenants.outbound_suspended_at`
- `0044_add_mailboxes.sql`: mailbox tables

`getTenantContext()` → `getTenant()` and `getUserById()` do `SELECT *`, so a
missing column = "Unknown column" on every admin page. The superadmin overview
selects explicit columns, so it survives.

## Steps
1. **Diagnose read-only first. Do not change data before step 3.**
   - Ask me for the DB password; I type it into my own shell as `$env:DATABASE_URL`
     (`mysql://u210059163_vendercrm:<pw>@srv1724.hstgr.io:3306/u210059163_vendercrm`,
     fallback host 193.203.175.171, URL-encode special chars). Never print or log it.
   - Read the `__drizzle_migrations` table and compare its row count and latest hashes
     with `src/db/migrations/meta/_journal.json`.
   - `SHOW COLUMNS FROM tenants;` and `SHOW COLUMNS FROM users;`: are
     `mailbox_enabled`, `outbound_suspended_at` and `telegram_chat_id` there?
   - Quick confirmation from the UI: as superadmin, open the console's Tenants list
     (`src/modules/tenancy/console.ts` also does `SELECT *` on tenants). If it errors too,
     that confirms the hypothesis.
2. Report to me what's missing **before** migrating. Remind me about a backup
   (docs/BACKUPS.md) and wait for my OK.
3. With my OK: `git pull origin main`, `npm install`, `npx drizzle-kit migrate`.
   Report which migrations were applied.
4. I reload /dashboard as marklundfaktura@gmail.com. If it works, we're done: update
   docs/DEPLOY.md with a one-line reminder that every deploy that adds a migration must run
   `drizzle-kit migrate` (if that's not already clear enough), and nothing else.

## If the migrations were already applied: other suspects
Get the real error first: hPanel → Node.js app → runtime logs, search for digest
`3937366000` (or Sentry, tag `area: global`). Then check, in `src/app/(app)/layout.tsx`
order:
- `getTenantContext()` (`src/modules/tenancy/context.ts`): an active tenant id in the
  session/cookie pointing at a deleted/purged business (recent `purge-tenants` script),
  or a membership row whose tenant is gone. That only hits users with many businesses.
- `listMembershipsForUser()`: a join that breaks on an orphaned membership, or a role
  value with no translation in `app.users.roles`.
- `listNotifications` / `countUnread` (changed in #164, "bell count").
- `isMailboxAvailable()`: only reads the DB if all Cloudflare env vars are set in hPanel.
- Reproduce locally against prod data read-only if needed; fix the smallest thing, add a
  test, branch + PR. Do not widen scope.
