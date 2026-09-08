# Phase O1 — Ops token, guard and create-only endpoints. OPUS session. First of two (PLAN.md §18).

Read ONLY: this file, `prompts/_handoff-o.md`, PLAN.md §18 (all of it), then
`src/db/schema/sites.ts`, `src/modules/sites/keys.ts`, `src/modules/sites/ingest.ts`,
`src/modules/sites/sites.ts`, `src/modules/tenancy/{tenants,users,audit,context}.ts`,
`src/modules/crm/pipelines.ts`, `src/lib/api/guards.ts`, `src/app/api/v1/leads/route.ts`,
`skills/vendercrm-lead-capture/SKILL.md`. Do not read the rest.
Execute under the autonomy protocol (PLAN.md §17 rules apply). Build nothing outside §18.

Owns: `src/db/schema/ops.ts` + one migration, `src/modules/ops/**`,
`src/app/api/ops/**`, `scripts/create-ops-token.ts`, `skills/vendercrm-ops/**`,
`docs/log/o1.md`. Append-only edits: `src/db/schema/index.ts`,
`src/modules/sites/ingest.ts` (add an `allowInactive` option to
`ingestLeadForSite`, default false, never read from a request),
`src/lib/api/guards.ts` (one `requireOpsToken(request)` in the existing
GuardResult shape). No UI. No edits to existing tables.

Budget: one Opus session, ≤ 2 h. Branch `phase/o1` off latest main. WIP commit every 30 min.

Phase rules:
- Tables exactly §18.2. Token hashing, prefix and last-used throttling copied
  from `modules/sites/keys.ts` (same helpers if exportable, else the same code).
- `modules/ops/guard.ts` is the whole security story: `resolveOpsToken`
  (hash lookup, revoked/expired → 401), `assertMayTouch(token, entity, id)`
  (member of `ops_objects` for this token, or tenant in `allowed_tenant_ids`
  and the action is site-create). Every endpoint calls it. Write the isolation
  test FIRST: a token must get 404 (not 403 — do not confirm existence) on a
  pre-existing tenant, site, pipeline and key, on another token's batch, and on
  activating any site; and must succeed on its own objects and on site-create
  in an allowlisted tenant. Model it on `src/modules/crm/isolation.test.ts`.
- Endpoints exactly §18.3, in the `lib/api/guards` error shape, zod-validated
  bodies, idempotent per (row, step): a repeat returns the stored object with
  200. On failure: store `last_error` on the row, set `steps.<step>=failed`,
  state `failed`, return the same status + verbatim reason.
- Tenant creation reuses `createTenant` + `createTenantAdminUser` under a
  SuperadminContext built from the token's owner; the admin gets the existing
  reset-password email path; no password is ever returned or logged.
- Pipeline step: stages from the row (fallback: tenant default via
  `createPipelineWithDefaultStages`), create missing tags in the tenant,
  resolve owner by email among the tenant's users (unknown → 422 with the
  reason, do not guess), then `updateSite` with the defaults.
- Test lead: `ingestLeadForSite(..., { allowInactive: true })`, payload fixed
  (`source: "ops-test"`, `idempotency_key: "ops-test-<rowId>"`, phone from
  `OPS_TEST_PHONE` env, default `+595981000000`), store contact/deal ids on the
  row, state `awaiting_approval`.
- Audit per call as §18.1.6. Rate limit per token with the existing helper.
- `scripts/create-ops-token.ts <superadmin-email> <label>` prints a token once
  (O2 ships the page; this is the bootstrap).
- `skills/vendercrm-ops/SKILL.md` (+ `references/endpoints.md`): how a session
  provisions a new site end to end — read `VCRM_OPS_URL` and `VCRM_OPS_TOKEN`
  from env, `GET /me`, create or reuse a batch, one row per domain, the five
  steps in order, put the key into the site's `VENDERCRM_API_KEY`, send the
  test lead, then tell the owner "awaiting your approval at /claude-ops". State
  the limits plainly: the token cannot see or change existing businesses;
  on 404/422 write `needs_input` on the row and stop that row. Frontmatter
  description < 1024 chars; the skill is copied to the owner's PC by hand.
- Tests: isolation (above), idempotency of each step, tenant-mode `existing`
  requires allowlist, `allowInactive` false blocks inactive sites on the public
  route (regression), audit payload carries `via` and `batch_id`.

Exit: `npm run lint && npm run typecheck && npm test && npm run build` green;
`npm run check:migrations` green; the isolation test passes; a scripted run
against the dev DB (document the commands in the log) creates a tenant, site
(inactive), pipeline, key and test lead for one row and repeats each call
without duplicates; PR merged; `docs/log/o1.md` + §18.7 line.

## After this phase
Follow `prompts/_handoff-o.md`. Spawn nothing. End with the phase report and
the line: "Next: open a Sonnet window and paste `Read prompts/sonnet-o2-ops-console.md in this repo and execute it.`"
