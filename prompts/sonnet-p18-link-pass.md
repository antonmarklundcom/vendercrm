# Phase P18 — Link pass for wave 2. SONNET session. Wave 2 lane 2, last.

Read ONLY: this file, PLAN.md §17.2 (P18 row), §17.7, `docs/log/p8.md` (the
wave 1 link pass, the shape to repeat), `docs/log/k1.md` "Open, for the next
phases", `docs/log/p9.md` … `p17.md` and `k2.md`/`k3.md` as they exist,
`prompts/_handoff-w2.md`, then `src/components/app-nav.tsx`,
`src/app/(app)/layout.tsx`, the AI card in `src/app/(app)/settings/**`,
`docs/HANDOFF.md`, `docs/SMOKE_TEST.md`, `KNOWN-ISSUES.md`.

Owns: the P18 row of §17.2. Plus `docs/log/p18.md`. No feature code.

Budget: one session, ≤ 60 min. Branch `phase/p18` off latest main, after every
other lane 2 PR has merged; lane 1 as far as it has merged (check §17.7 and
`gh`/git state; do not wait for lane 1).

Phase rules:
- Nav reachability audit of every surface wave 2 added: `/contracts`,
  `/contracts/templates`, `/companies`, `/campaigns` (if P10 merged),
  `/invoicing/settings` (if P11 merged — reachable from settings, the
  "Próximamente" nav item **stays disabled**), `/dashboard/briefings`,
  `/settings/negocio` (K1's missing nav entry — add it), `/settings/negocio/
  importar` (if K3 merged), the forms editor. Add nav entries where a surface
  is otherwise unreachable; do not add clutter for sub-pages already linked.
- The three inert `settings.ai` text fields in the AI card (K1's open item)
  become a link to `/settings/negocio`; keep the toggles (P9's included).
- `docs/HANDOFF.md` Part 4: migrations in merge order, env vars
  (`AI_AUDIO_DRIVER`, `META_*` if P12 merged), the human checks (a real
  voice note; a five-contact test campaign; a contract accepted on a phone;
  the Monday briefing arriving by push and email).
- `docs/SMOKE_TEST.md` §10: one row per merged phase's exit criterion.
- `KNOWN-ISSUES.md`: promote still-open items from each `docs/log/*.md`;
  remove items a wave 2 phase closed (`contract_accepted` emitter,
  `renderContactCustomVars` unwired if P10 wired it).
- Lint/typecheck/test/build green (unchanged counts are expected).

Exit: every wave 2 surface reachable in ≤ 2 clicks; docs updated; PR merged.

## After this phase
Stop with the closing report for wave 2: what merged (with PR numbers), what
did not (lane 1 phases still open, K3 skipped?), the migrations and env vars
to apply, the human checks outstanding, and whether §17.5's J8 trigger clock
has started (it starts when both P9 and P14 are merged). Spawn nothing.
