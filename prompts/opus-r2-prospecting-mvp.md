# Phase R2 — Prospecting MVP. OPUS 5.5 session (medium effort).

Read first:
- `PLAN-PROSPECTING.md`: §0–§5 in full, and §10.
- `AGENTS.md`.
- Tenancy: `src/modules/tenancy/{context,db,settings}.ts`.
- CRM: `src/db/schema/crm.ts`, `src/modules/crm/{contacts,contact-list,deals,activities,tasks,timeline,import,merge,deletion,export}.ts`.
- UI: `src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`, `src/components/contact-actions.tsx`, `src/app/(app)/contacts/import/*`, `src/app/(app)/pipeline/PipelineBoard.tsx`.
- Phone and PWA: `src/lib/phone.ts`, `src/app/manifest.ts`, `public/sw.js`, `src/components/push-subscribe.ts`.
- Worker: `src/worker/maintenance.ts`.
- Seed and tests: `scripts/seed-tenant.ts`, and one isolation test (`src/modules/crm/isolation.test.ts`).

Branch: `phase/r2-prospecting` off the latest `main`. One PR. Log in `docs/log/r2.md`.

## Hard rules
- **Off by default.** With both modules off, the app is unchanged. Prove it with a test (routes 404, nav unchanged).
- **Visibility `own`** must be enforced server-side on every read path listed in plan §3.2, with a seller-A-vs-seller-B integration test per path. This is the security boundary of the phase; do it before the UI.
- **Tables.** Every new table has `tenant_id` and goes through `tenantDb`. One migration, `npm run check:migrations`.
- **Outcomes** go through `POST /api/app/outcomes`: idempotent on `clientOpId`, one transaction, `Origin` check, rate limit.
- **Offline outbox.** IndexedDB and SW `sync` only. The SW `fetch` handler covers only the share-target POST and the offline navigation fallback; don't cache API responses in the SW.
- **Dependencies.** One new dependency is allowed: `read-excel-file`. No UI library.
- **i18n.** Every string in es/en/sv; `es` is natural Paraguayan Spanish (use "vos" in UI copy, as the existing `es.json` does). Parity test green.
- **DNC** is respected everywhere §1.5 lists.
- **Seed script** never prints passwords or tokens.
- **No new GitHub workflow.**

## Order
1. Module flags + superadmin toggle.
2. Visibility helper + tests.
3. Migration.
4. Prospecting services + unit tests.
5. Import (CSV/XLSX) + batches + undo.
6. Routes/UI (bottom nav, sheet, Hoy, outcome sheet, card, list/board, Nuevos, import wizard, settings).
7. Outbox + SW + manifest share target.
8. Seed + sample CSV.

## Exit
Everything in plan §5.10:
- Gates green: lint, typecheck, test with local MariaDB, build, check:migrations.
- The full browser walk at 375 × 812 done in the in-app browser; light and dark screenshots in the PR.
- `docs/log/r2.md` lists Built / Decisions / Known issues / Verification, plus the "what Anton does" steps from plan §12.
- PR merged.

Then **stop and report to Anton**:
- What works and what's left.
- Monthly cost.
- His manual steps.

Do not start R3. Spawn nothing. Never Fable. Plan questions for Anton go in `docs/decisions-needed.md`.
