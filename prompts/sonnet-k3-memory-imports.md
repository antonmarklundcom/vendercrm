# Phase K3 — Memory imports, template variables, coach rows. SONNET session. After K2 and P8 (wave 2 lane 2 — PLAN.md §17.2).

Restored 2026-09-06 from PR #93 (§17.0 #1). Runs inside `sonnet-wave2-lane2.md`;
if K2 is not merged when the lane reaches this phase, skip it and log the gap.

Read ONLY: this file, PLAN.md §16.3 (`memory_imports`), §16.4 (consumers),
§16.6, `plan-booking.md` §4, `docs/log/k1.md`, `docs/log/k2.md`,
`docs/log/p1.md`, `docs/log/p5.md`, `docs/log/p7.md`, then `src/modules/memory/**`,
the variable resolver P1/P5 registered, `src/modules/coach/hoy.ts`.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the K3 row of PLAN.md §16.6. Plus `docs/log/k3.md`.
Hard limits: no schema changes; no edits to `lib/ai/**` or the setup module.

Budget: one session, ≤ 90 min. Branch `phase/k3` off latest main.

Phase rules:
- Imports: `/settings/negocio/importar` accepts pasted text, a PDF (storage
  driver; text extraction with `pdf-parse`; a PDF without a text layer is
  reported as such, no OCR) or a URL (server fetch, HTML → text, same-tenant
  rate limit, 200 KB cap). One `generateStructured` call extracts candidate
  facts (kind, title, body, structured) → rows with `source: ai_suggested`,
  unconfirmed → a review screen with confirm / edit / discard per row and
  "confirmar todo". Ledger kind `memory_extract`.
- Template variables `{{negocio.nombre|horario|direccion|politica.cancelacion|
  politica.senas|pagos}}` registered in the resolver; documented in the
  FlowEditor variable help.
- Coach rows in `hoy.ts`: memory below 60 % complete; facts past
  `review_after`; promos expired but still confirmed.
- Public booking page shows address + maps link; quote and nota PDFs get a
  footer line with payment methods and the deposit policy when present.
- Tests: extraction review state machine; variable resolution; the three
  coach rules; URL fetch cap.

Exit: paste a sample FAQ text → 5 suggested facts → confirm → the AI reply
test from K1 answers from one of them; variables render in a template
preview; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md` (index line in both §16.8 and §17.7). Next in
this session: `prompts/sonnet-p18-link-pass.md`.
