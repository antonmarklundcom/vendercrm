# Phase M1 — clientes.com.py launch: config, imagery, QA. Paste into a fresh OPUS session, ONLY after PR #79 (marketing steps 4–5) is merged.

Read `docs/MARKETING_NEXT_STEPS.md` FIRST, in full — then `docs/MARKETING_SITE_PLAN.md`
(§1.2 locked decisions are not up for debate) and `docs/MARKETING_DESIGN.md`. Execute
MARKETING_NEXT_STEPS §2 (launch blockers) and §3.1–3.2 (imagery pass, CWV) under its
§7 autonomy rules. Build nothing outside the plan; CRM code is untouchable.

Phase rules:
- Branch `phase/m1-launch` off latest main. PR #79 unmerged ⇒ finish that first.
- Load skills at the matching step: `web-design-system` (any markup change, and the QA
  gate before done), `higgsfield-web-imagery` (imagery pass — mind its credit budget),
  `vendercrm-lead-capture` (form round-trip check), `seo-web-builds` (alt text, og),
  `nextjs-deploy-hostinger` (env vars / deploy). A missing skill is never a stopper:
  use the nearest equivalent and note the substitution in the build log.
- Human inputs (ask Anton once, at the start): WhatsApp number, phone, email, address,
  RUC for `src/lib/site-config.ts`; `VENDERCRM_API_KEY` from a Sitios row on his
  tenant. Missing values never block — the site renders correctly without them; fill
  what he gives, record the rest as pending in the build log.
- Imagery: fill `hero-bleed` on `/`, `section-break` per vertical page, `card-motif`s
  for the verticals grid. Paraguayan business contexts, no stock gloss, WebP,
  Spanish alt text. `proof-photo` slots stay empty — never AI-generate proof.
- No fabricated testimonials/cases/numbers, anywhere, ever.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; validate before every push:
  `npm run lint && npm run typecheck`, `npx vitest run src/middleware.test.ts
  src/i18n/messages.test.ts`, `npm run build`.

Exit: images in place and pages pass the web-design-system QA gate at 360px and
1280px; lead form round-trip verified in the CRM (or its blocker named in the build
log); CI green; PR merged; build-log entry appended to MARKETING_NEXT_STEPS §8.

## After this phase — hand off to the next (fresh session)
Verify the merge through the GitHub MCP tools (PR merged, origin/main contains the
commit, checks green), re-run the validation commands on main, append the build-log
entry, then spawn a NEW session via claude-code-remote `create_session` — model
**Sonnet** (never Fable — fable-cost-guardrail), inherit environment and permission
mode (never `plan`), prompt exactly: `Read prompts/sonnet-m2-recursos.md in this repo
and execute it.` If `create_session` is unavailable, stop and report that M2 is ready
to paste. Never hand off on an unmerged or unverifiable PR — report the blocker
instead.
