# Phase W7 — Companies and contact merge. SONNET session. Wave 2, lane 2, phase 5.

Read ONLY: this file, PLAN.md §15.5 (J11, companies half), §15.10,
`plan-booking.md` §4, `docs/log/p5.md` (contact list, SQL pagination, custom
fields — you are extending exactly that code), and the code you own:
`src/db/schema/crm.ts`, `src/modules/crm/**`, `src/app/(app)/contacts/**`,
`src/app/(app)/empresas/**`. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W7 row of PLAN.md §15.10. Plus `docs/log/w7.md`.

Budget: ≤ 90 min. Branch `phase/w7` off latest main. WIP commit every 30 min.
Start this phase after W5 has merged — both touch the contact list queries.

Phase rules:
- Table `companies` (tenant, name, RUC?, phone, email, website, address,
  notes, owner, timestamps) and `contacts.company_id` (nullable FK, indexed).
  One additive migration. **Nullable on purpose**: a one-person client with no
  company is the common case in this market and must stay frictionless — no
  required company anywhere.
- `/empresas`: list with SQL pagination and search (copy P5's shape, do not
  invent a second pattern), detail showing the company's contacts, deals and
  documents, create/edit, and delete only when no contact references it.
- Contact detail gets a company field with a type-ahead that can create a
  company inline.
- **Merge** (`src/modules/crm/merge.ts`): pick a surviving contact and a
  losing one; move deals, activities, tasks, documents, quotes, conversations,
  submissions and tags to the survivor; union `contacts.custom` with the
  survivor's values winning; write an audit row naming both ids; soft-delete
  the loser rather than hard-deleting, so a mistaken merge is recoverable.
  `requireTenantAdmin()` + `writeAuditLog`. A merge preview screen shows
  exactly what will move before it moves.
- Merge runs in one transaction. A partial merge is worse than no merge.
- Duplicate detection is a **suggestion only**: same phone (normalised through
  `src/lib/phone.ts`) or same email surfaces a "possible duplicate" banner on
  the contact. Never merge automatically.
- Tests: the merge moving every related row kind (one assertion per table),
  transaction rollback on a mid-merge failure, custom-field union precedence,
  company delete refused while referenced, duplicate suggestion by normalised
  phone, and tenant isolation on both new surfaces.

Exit: two duplicate contacts with deals, tasks and a conversation each merge
into one with nothing lost and an audit row written; a company page lists its
contacts and deals; deleting a referenced company is refused;
lint/typecheck/test/build green; PR merged; `docs/log/w7.md` + §15.11 line.

## After this phase
Go straight to `prompts/sonnet-w8-link-pass.md` — the last phase, and only
after W3–W7 have all merged.
