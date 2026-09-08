# Phase O2 — The Claude Ops page. SONNET session. Second of two (PLAN.md §18). Requires O1 merged.

Read ONLY: this file, `prompts/_handoff-o.md`, PLAN.md §18.1, §18.2, §18.4,
§18.5, `docs/log/o1.md`, `docs/design/claude-ops-mockup.html` (the design:
layout, states, copy — example data, not code), then
`src/app/(superadmin)/tenants/page.tsx`, `src/app/(superadmin)/tenants/[id]/page.tsx`
and its `actions.ts`, `src/app/(superadmin)/audit/page.tsx`,
`src/components/audit-table.tsx`, `src/modules/ops/index.ts`. Do not read the rest.
Execute under the autonomy protocol (PLAN.md §17 rules apply). Build nothing outside §18.4.

Owns: `src/app/(superadmin)/claude-ops/**` (page, `actions.ts`, client
components), `src/components/ops/**`, `docs/log/o2.md`. Append-only edits:
`src/app/(superadmin)/layout.tsx` (one nav item, after WhatsApp),
`messages/en.json`, `messages/es.json`, `messages/sv.json` (one `superadmin.ops`
block, all three files, es is the product language).
Hard limits: no schema changes, no edits under `src/modules/ops/**` except
adding a read/list function O1 forgot (log it), no changes to the guard, no
new endpoints. If the page needs data O1 does not expose, add a server-side
query in `src/app/(superadmin)/claude-ops/queries.ts` using the O1 tables.

Budget: one session, ≤ 90 min. Branch `phase/o2` off latest main. WIP commit every 30 min.

Phase rules:
- Same shell and components as the other superadmin pages (`PageHeader`,
  `Button`, tables like `tenants/page.tsx`); Tailwind tokens, no new palette.
  The mockup's structure, not its CSS.
- Sections and server actions exactly §18.4. Every action starts with
  `requireSuperadminContext()` and writes an audit entry (`ops_token.created`,
  `ops_token.revoked`, `ops_token.allowlist_set`, `ops_batch.created`,
  `ops_batch.text_saved`, `site.activated`, `ops_row.rejected`).
- Token reveal: shown once in a dialog after creation with a copy button and
  the two env lines to paste (`VCRM_OPS_URL=…`, `VCRM_OPS_TOKEN=…`); after
  that only prefix, last used, call count, allowlist, revoke. Never re-fetch
  or re-display plaintext; there is none to fetch.
- Approve: activate the site, delete the test contact + deal via
  `modules/crm/deletion` under a system tenant context, row → `live`. Reject:
  a note → `needs_input`, state `needs_input`. Both from the row drawer.
- Step strip: five cells, colours by state (done/running/needs-you/failed/
  pending), accessible text alternative. Failed rows show `last_error.reason`
  verbatim. Rows link to `/tenants/[id]` for the company.
- Log section = `listAuditLog` filtered on `payload.via` starting with
  `ops_token:`; chips: this batch / failures only / all.
- Empty states: no token yet (show create form first), no batches yet, batch
  with no rows yet ("the session has not written rows for this text yet").
- Tests: an authorization test like `whatsapp-health/authorization.test.ts`
  (non-superadmin gets nothing from every action); approve activates and
  deletes the test lead; reject stores the note.

Exit: lint/typecheck/test/build green; the page renders with a real O1 batch
in the dev DB (one screenshot pass, ≤ 4 shots, CI artifact); i18n keys present
in all three files; PR merged; `docs/log/o2.md` + §18.7 line.

## After this phase
Follow `prompts/_handoff-o.md`. Spawn nothing. End with the closing report and
the §18.6 human-inputs list, verbatim, so Anton can finish setup.
