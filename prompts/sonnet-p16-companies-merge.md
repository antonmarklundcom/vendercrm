# Phase P16 — Companies + contact merge (J11c). SONNET session. Wave 2 lane 2.

Read ONLY: this file, PLAN.md §17.3 "P16" (the merge rules are the spec),
§17.2 (P16 row), §10 1S (deletion guard — the shape to mirror),
`prompts/_handoff-w2.md`, `plan-booking.md` §4, then `src/modules/crm/`
(`contacts.ts`, `deletion.ts`, `contact-list.ts`), `src/db/restore-check.ts`
(deriving a list from the schema), `src/db/schema/index.ts`,
`src/app/(app)/contacts/**`, `src/lib/phone.ts`.

Owns: the P16 row of §17.2. Plus `docs/log/p16.md`.
Hard limits: no fuzzy-matching library; no soft delete; the loser row is
deleted in the same transaction or the merge does not happen.

Budget: one session, ≤ 90 min. Branch `phase/p16` off latest main.

Phase rules:
- Schema: `companies` (tenant, name, ruc?, phone?, email?, address?, custom
  json, notes; unique (tenant, name)), `contacts.company_id` nullable. One
  migration.
- `crm/companies.ts`: CRUD (create/edit admin+agent, delete admin-only and
  only with no contacts — the 1S pattern), list with contact and open-deal
  counts. `/companies` list + `/companies/[id]` (its contacts, its deals,
  edit form); a company picker on the contact form; company name on the
  contact detail header. Custom-field definitions (P5) are not extended to
  companies in this phase.
- `crm/merge.ts`: `contactReferenceColumns()` derived from the Drizzle schema
  — every table exporting a column named `contactId`/`contact_id` (plus
  `contact_tags`), never a hand-typed list — and `mergeContacts(ctx, winnerId,
  loserId, fieldChoices)` in one `tenantTransaction`: re-point every derived
  column, union tags, union `custom` (winner wins on conflict), fill winner's
  empty scalar fields from the loser where `fieldChoices` says so, keep the
  earliest `created_at` and first-touch UTMs, delete the loser, `writeAuditLog`
  with both ids, counts moved per table and the field decisions. Admin only.
  Refuse to merge a contact with itself or across tenants (tenantDb makes
  the second impossible — test it anyway).
- `crm/duplicates.ts` (pure over rows + one query): candidates by exact
  normalized email, or same name (case/accents folded) with the same first
  six digits of phone. `/contacts` gains a "posibles duplicados" panel
  listing pairs with a "revisar" link to the merge dialog.
- Merge dialog on `contacts/[id]`: pick the other contact (search), a
  side-by-side of the scalar fields with a radio per row, the counts that
  will move, a confirm that names them, no undo — `useActionState`-shaped.
- Tests: `duplicates.test.ts`; `merge.integration.test.ts` — derived column
  list non-empty and covers every known table; after a merge no row in any
  derived table carries the loser id (assert by scanning the derived list);
  tags and custom unioned; audit row complete; self-merge refused;
  cross-tenant refused.

Exit: the integration suite above green with MySQL; a merged contact's
timeline shows both histories; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session: `prompts/sonnet-p17-forms-editor.md`.
