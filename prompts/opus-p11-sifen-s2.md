# Phase P11 — SIFEN S2: ports, tables, state machines. OPUS session. Wave 2 lane 1.

Read ONLY: this file, `PLAN-SIFEN.md` in full (it is the spec; §2–§4 are
literal), PLAN.md §9 (boundary + S1), §17.4, §17.2 (P11 row),
`prompts/_handoff-w2.md`, `plan-booking.md` §4, then `src/modules/sifen/**`
(all of it, including `boundary.test.ts`), `src/modules/documents/numbering.ts`
(the FOR UPDATE pattern), `src/modules/tenancy/db.ts`, `src/lib/crypto/index.ts`,
`src/modules/whatsapp/accounts.ts` (how a secret is stored encrypted),
`src/db/schema/documents.ts` (the boundary comment you must honor),
`src/modules/automations/engine.ts` `claimWaitingRun` (the compare-and-set shape).

Owns: the P11 row of §17.2. Plus `docs/log/p11.md`.
Hard limits: **no fiscal field, code table value, window or rate is asserted
in code.** Anything `PLAN-SIFEN.md` §6 lists as a Manual Técnico question is a
`SifenPolicy` field with the default the file states, a named constant with a
`// MANUAL TÉCNICO: §6 Qn` comment, or a `SifenNotImplementedError`. The
"Factura electrónica — Próximamente" nav item stays disabled. No issuing UI.

Budget: one session, ≤ 90 min. Branch `phase/p11` off latest main.

Phase rules:
- `modules/sifen/ports.ts` and `types.ts` exactly per `PLAN-SIFEN.md` §2.1 and
  §4; `modules/sifen/testing/memory-store.ts` (Map-backed `SifenStore`) so
  the engine's own tests need no database. `boundary.test.ts` must stay green
  — run it first and last.
- State machines (`modules/sifen/timbrado.ts`, `document-state.ts`) per §3.1
  and §3.2, every transition a compare-and-set through the port, every rule
  a unit test against the memory store, including: allocation refused on
  each non-active status; overlap picks the earliest `valid_to`; gap →
  `to_inutilizar` after the policy window (injected clock); `onRejected`
  both ways; cancellation refused outside the window with the window in the
  error; a number never re-allocated. `SifenPolicy` with §3's defaults.
- Facade: replace the six `never`s with the §4.3 signatures. `generateDE`,
  `signDE`, `submit`, `queryStatus`, `generateKuDE`, `submitEvent` still
  throw `SifenNotImplementedError` naming the S-phase and the §6 question,
  **but** the state transitions around them are real: e.g. `submitEvent` for
  inutilización moves `to_inutilizar → inutilizado` only after the (stubbed)
  transport returns, so S5 plugs in without touching the machine.
- Schema `src/db/schema/sifen.ts` (`sifen_certificates`, `sifen_timbrados`,
  `sifen_documents`, `sifen_submissions`, `sifen_events`) and
  `src/db/schema/invoicing.ts` (`invoices`, `invoice_items`) per §4, plus
  `contacts.ruc`. Header comment on `sifen.ts` per §2.2. One migration.
- `modules/invoicing/`: `sifen-store.ts` (`SifenStore` over `tenantDb`/
  `tenantTransaction`, `allocateNumber` runs the FOR UPDATE + insert in one
  transaction), `keyring.ts` (decrypt per call, hold nothing), `transport.ts`
  (a stub that throws `SifenNotImplementedError` for S5), `ports.ts`
  (`sifenPortsFor(ctx)` deriving `IssuerRef` from `ctx.tenantId` and refusing a
  mismatch), `certificates.ts` (upload PEM/PKCS#12 → encrypt → row; parse
  `not_after`/subject with `node:crypto` X509Certificate), `timbrados.ts`
  (register/close), `invoices.ts` (draft CRUD only: from a quote or a nota by
  value, exactly as 1Q copies lines; `issue` allocates a number and stops at
  `reserved` with a clear "S3 pending" error so nothing half-issues),
  `isolation.test.ts` (two tenants, every adapter method).
- Jobs: `sifen.timbrado_sweep` (daily status flips) and `sifen.inutilizar`
  (daily, groups gaps, calls the stubbed transport, leaves rows unchanged on
  the stub error) registered in the worker.
- UI `/invoicing/settings` (admin): certificate upload with expiry shown,
  timbrado register/close with range usage and "N números sin reportar";
  nothing else. `contacts.ruc` on the contact form with the módulo-11 check.
- Add a coach rule file hook only if lane 2's P14 has merged
  `modules/coach/**` changes you would conflict with — otherwise leave the
  §3.1/§3.4 coach rows to S8 and note it.

Exit: `boundary.test.ts` green; the two state machines fully unit-tested
against the memory store; `isolation.test.ts` green with MySQL; a draft
invoice from a quote reaches `reserved` with a number and a CDC, and a second
issue in the same second gets the next number; the nav item unchanged;
lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. This is the last lane 1 phase: stop with the
closing report described in `prompts/opus-wave2-lane1.md`. Spawn nothing.
