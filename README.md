# VenderCRM

WhatsApp-first sales CRM for Paraguay. See [`PLAN.md`](./PLAN.md) for the full
architecture and build plan.

## Stack

Next.js 15, Drizzle ORM, MySQL, Tailwind + shadcn/ui, next-intl (`es`).

## Local setup

1. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — MySQL connection string.
   - `APP_ENCRYPTION_KEY` — 32-byte hex key, generate with `openssl rand -hex 32`.
   - `BETTER_AUTH_SECRET` — random secret, generate with `openssl rand -hex 32`.
2. Install dependencies: `npm install`.
3. Apply database migrations: `npm run db:migrate`.
4. Start the dev server: `npm run dev`.

No public sign-up page exists. Create the first superadmin directly against the
database, e.g. with a one-off script calling `auth.api.createUser({ body: {
email, password, name, role: "superadmin" } })` (no `headers` — see
`src/lib/auth.ts` for why that's a trusted internal call).

The job queue worker starts automatically in-process via `instrumentation.ts`
whenever the Next.js server boots (dev or production) — no separate process to
run locally.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio against the configured database |
| `npm run test` | Run the test suite (vitest) |
