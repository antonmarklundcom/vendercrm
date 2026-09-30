# Phase R3 — Goals, streaks, agreements, earnings, admin panel. SONNET 5.5 session (medium effort).

Read first:
- `PLAN-PROSPECTING.md` §1, §4.2 (R3 tables), §6 and §10.
- `docs/log/r2.md`.
- `src/modules/prospecting/**` (outcomes, queue, profiles).
- `src/modules/reports/sales.ts` (`reportWindow`), `src/app/(app)/reports/page.tsx` (CSS bars).
- `src/modules/coach/jobs.ts` (the hourly chain + tenant-local hour pattern), `src/worker/maintenance.ts`.
- `src/modules/crm/export.ts` (`toCsv`).

Branch: `phase/r3-goals-money` off the latest `main`. One PR. Log in `docs/log/r3.md`.

## Hard rules
- **Build only plan §6.** No AI, no Places, no lead forwarding.
- **Money:**
  - PYG integers (`bigint`), percentages in basis points.
  - `computeAmountDue`, `computeStreak` and the commission math are pure functions with unit tests (proration, minimum, per-sale bps, a 0/empty seller %).
- **Scoping and audit:**
  - `seller_days` is updated inside the R2 `recordOutcome` transaction, idempotent with `clientOpId` (a replay must not double-count).
  - Agreements and charges: admin-only mutations with `writeAuditLog`. Sellers get read-only views of their own.
  - `/ganancias` is hidden when the seller has no %. The leaderboard shows only with ≥ 2 sellers and when the setting is on.
- **Celebrations:** no dependency; respect `prefers-reduced-motion`.
- **Tables:** one migration, every table tenant-scoped, and the isolation tests extended.
- **i18n:** es/en/sv, parity green.
- **No new GitHub workflow.**

## Exit
Everything in plan §6.7:
- Gates green.
- The integration test won → agreement → monthly job → payment → commission.
- The browser walk at 375 px; screenshots in the PR.
- `docs/log/r3.md`.
- PR merged.

Then **stop and report to Anton**. Do not start R4. Spawn nothing. Never Fable.
