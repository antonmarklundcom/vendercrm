# Phase W8 — Wave 2 link pass. SONNET session. Wave 2, last phase.

Read ONLY: this file, PLAN.md §15.10 and §15.11, `plan-booking.md` §4,
`prompts/_handoff-p.md`, `docs/log/w1.md` … `docs/log/w7.md`,
`docs/HANDOFF.md`, `docs/SMOKE_TEST.md`, `KNOWN-ISSUES.md`, and the nav files.
Run this only after W1–W7 have all merged.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W8 row of PLAN.md §15.10. Plus `docs/log/w8.md`.

Budget: ≤ 60 min. Branch `phase/w8` off latest main.

**No feature code.** This phase is cross-cutting only, exactly as P8 was.

Phase rules:
- **Reachability audit.** Walk every surface W1–W7 added — the transcript in
  the inbox bubble, `/campaigns`, `/contratos` and `/c/[token]`, the briefing
  card, `/reportes` v2's new filters and export, the forms editor, `/empresas`
  and the merge screen — and confirm each is reachable from somewhere a user
  naturally lands. Add nav entries only where one is genuinely missing; say in
  the log what you audited and what you changed, including "nothing".
- **`docs/HANDOFF.md`** — a Part 4 for wave 2: every migration by number, every
  new or newly-required env var with its setup command, the new job kinds and
  what schedules them, and the human checks that only Anton can perform
  (a real WhatsApp campaign against a real WABA, a contract accepted on a real
  phone, a transcription against a real voice note).
- **`docs/SMOKE_TEST.md`** — a new section with one checklist row per W1–W7
  exit criterion a click-through can verify.
- **`KNOWN-ISSUES.md`** — promote the still-open items from `docs/log/w1.md`
  through `w7.md`; **remove** any wave-1 item wave 2 actually fixed (the
  `contract_accepted` emitter is one — W3 built it; check the rest rather than
  assuming), and say in the log which ones you retired and why.
- **PLAN.md §15.11** — every phase line present, with its PR number and log
  path. Fix any that a phase forgot.
- Verify the four commands still pass on the merged tip:
  `npm run lint && npm run typecheck && npm test && npm run build`.

Exit: every wave-2 surface reachable or explicitly noted as reached from an
existing page; HANDOFF, SMOKE_TEST and KNOWN-ISSUES current; §15.11 complete;
lint/typecheck/test/build green; PR merged.

## After this phase
Stop with the closing report: what merged (PR numbers), the migrations and env
vars Anton must apply in order, the human checks still outstanding, and what
wave 3 would hold (J8 conversational coach once J6/J7 have a month of use, J9
embedded signup once Meta approves, SIFEN once §15.2's five prerequisites
exist). Spawn nothing.
