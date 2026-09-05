# Phase P5 — Pipeline polish, custom fields, SQL pagination. SONNET session. Lane 2, parallel.

Read ONLY: this file, PLAN.md §15.5 (J4 pipeline + custom fields, J12 pagination),
§15.8, `plan-booking.md` §4, `docs/log/p1.md`, then `src/modules/crm/**`,
`src/db/schema/crm.ts`, `src/app/(app)/pipeline/**`, `src/app/(app)/contacts/**`.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the P5 row of PLAN.md §15.8. Plus `docs/log/p5.md`.
Hard limits: additive schema only; `crm/events.ts` and `deals.ts` emit lines
are P1's — do not change what they emit; no inbox, quotes, dashboard edits.

Budget: one session, ≤ 90 min. Branch `phase/p5` off latest main.

Phase rules:
- Board: value total per column (formatMoney, tenant currency), deal count,
  days-in-stage on each card, a stale badge when `stages.stale_after_days`
  (new nullable column, editable in `/pipeline/etapas`) is exceeded; real
  in-column ordering (position updates on drop); `deals.expected_close_at`
  and `deals.lost_reason` (separate from `closeReason`; won keeps closeReason).
- Custom fields: `custom_field_definitions` (tenant, key, label, type
  text|number|date|select|phone, options json, position, required, show_on_card).
  Rendered on contact detail + edit form, in import mapping (`custom.<key>`),
  export columns, saved-view filters (`custom.<key>` equals/contains), and as
  `{{contacto.custom.<key>}}` template variables (register the resolver P1's
  variable code exposes; if none, a `getContactVariables` helper here).
  Vertical presets seed 2–3 fields each (data file only).
- Pagination: move `queryContacts` filters, sort and paging into SQL (LIMIT/OFFSET
  or keyset), joining deals/stages where needed; keep the `tenantDb` boundary
  (add the join/`inArray` helper it lacks inside `tenancy/db.ts` only if
  unavoidable and note it in the log). Same results as the in-memory version:
  the existing integration tests must pass unchanged, plus one for 3 pages.
- All strings via next-intl; tests beside the module.

Exit: column totals correct in an integration test; stale badge unit-tested at
the boundary; a custom select field round-trips create → import → export →
filter; contact list integration tests green with SQL paging; lint/typecheck/
test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`. Spawn nothing.
