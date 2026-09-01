# clientes.com.py — next-steps plan (for the executing model)

> Written 2026-09-01 on branch `claude/clientes-frontend-service-offer-osgdkc`
> (PR #79). This is the working plan for finishing and launching the marketing
> site. Positioning and architecture stay governed by `MARKETING_SITE_PLAN.md`
> (do not reopen its locked decisions §1.2); resolved design decisions live in
> `MARKETING_DESIGN.md`. Execute on **Opus or Sonnet** per the phase table —
> never schedule or spawn Fable for any of this (fable-cost-guardrail).

## How to execute (phased-autonomous-build)

| Phase | Model | Prompt file | Covers |
|---|---|---|---|
| M1 — launch: config, imagery, QA | Opus | `prompts/opus-m1-launch-imagery.md` | §2, §3.1–3.2, §6 |
| M2 — /recursos content hub | Sonnet | `prompts/sonnet-m2-recursos.md` | §3.4, `MARKETING_SITE_PLAN.md` §7 |

Start (after PR #79 is merged): fresh Opus window, auto-accept permission mode,
paste exactly: `Read prompts/opus-m1-launch-imagery.md in this repo and execute
it.` M1 spawns M2 on Sonnet when its PR is merged. Recovery rule: if a phase's
session dies, re-paste that phase's prompt in a fresh window — prompts are
re-runnable and resume from the first unmet exit criterion; find the current
phase in §8. §3.3 (GBP) and §3.5 (first case study) are off-site/owner work,
not build phases. §5 (CRM backlog) is advisory only — no phase builds it.

---

## 1. Current status — what is already built

Build-sequence steps 1–5 of `MARKETING_SITE_PLAN.md` §6 are **done** on this branch:

- Routing shell, host-aware middleware, redirects (step 1).
- Design tokens + shared marketing components, EDITORIAL track (step 2, see `MARKETING_DESIGN.md`).
- Core pages `/`, `/metodo`, `/contacto` (form wired to `/api/v1/leads`), `/nosotros` (step 3).
- **Five vertical sales pages** `/soluciones/{clinicas,constructoras,inmobiliarias,servicios-profesionales,empresas-b2b}` (step 4): one template (`src/app/(marketing)/soluciones/[vertical]/page.tsx`), all copy in `messages/{es,en,sv}.json` under `marketing.soluciones` (es is the site language; en/sv exist for key parity). Home vertical cards and the footer link to them.
- SEO plumbing + legal (step 5, code part): sitemap with all 11 pages, disallow-all `robots.txt` + `X-Robots-Tag: noindex` on the `crm.*` host (middleware, unit-tested), JSON-LD (`Organization` sitewide; `Service` + `BreadcrumbList` + `FAQPage` per vertical), `/privacidad` + `/terminos`, code-generated og-images (brand card + per-vertical card via `next/og`).

Validated: `lint`, `typecheck`, marketing-relevant tests, production build, and a
rendered smoke test (200s, one `h1`, no placeholder text, both robots variants,
og PNGs render). The remaining test failures in `npm test` are pre-existing
env/DB-dependent CRM tests, unrelated to the marketing site.

## 2. Launch blockers — need Anton's input (one-file edits, do these first)

1. **`src/lib/site-config.ts`** — every `TODO(owner)` field is `null`:
   `whatsappNumber` (biggest gap: half the conversion pair is hidden until set),
   `phoneE164`/`phoneDisplay`, `email`, `address`, `ruc`. Ask Anton for the
   values; each element appears automatically once filled.
2. **Lead round-trip env vars** — `VENDERCRM_API_KEY` (create a `sites` row for
   clientes.com.py under the owner tenant in **Sitios**, key shown once) and
   optionally `VENDERCRM_URL`. Then verify per `MARKETING_DESIGN.md` §7: submit
   the real form, confirm contact + deal in the CRM, confirm dedupe on second
   submit.
3. Deploy is the existing Hostinger pipeline — same app, same domains, nothing
   changes in hPanel. No GitHub Actions in the deploy path
   (budgeted-runner-deploy): Hostinger's webhook builds it.

## 3. Next build work, in order

1. **Imagery pass** — the one big visual gap. All image slots are empty by
   design (`MARKETING_DESIGN.md` §5). Run the `higgsfield-web-imagery` skill:
   consistent art direction, believable Paraguayan business contexts, fill
   `hero-bleed` on `/`, one `section-break` per vertical page, `card-motif`s
   for the verticals grid. Respect the credit budget in that skill; convert to
   WebP, real `alt` text in Spanish. When `hero-bleed` lands, the closing
   overlap can move to the P6 image treatment without touching copy.
2. **Lighthouse / CWV pass** on the live host once images exist (LCP < 2.5s,
   CLS < 0.1, INP < 200ms at 390px).
3. **Google Business Profile** for the brand (`gbp-optimizer` skill) once the
   contact details exist.
4. **Phase 2 `/recursos`** — static MDX content hub per `MARKETING_SITE_PLAN.md`
   §7: one cluster per vertical, every article links its vertical page + 2–3
   siblings, never targeting a keyword a vertical page owns.
5. **First real case study with numbers** when one exists — it unlocks the
   social-proof sections that are deliberately absent today. Never fabricate.

## 4. Offer & packaging (recommendation for Anton — copy already aligns with this)

What the site sells is the **outcome** (más clientes + proceso ordenado), with
the method as the product and the CRM invisible inside it. Recommended package
ladder — three levels plus the free entry, all month-to-month (the trust ribbon
already promises "sin permanencia"):

1. **Diagnóstico (free, 30 min)** — the funnel entry; already the sitewide CTA.
   Its output is a written mini-report of where consultas are being lost. That
   artifact is the sales tool: it makes the problem concrete and prices the fix.
2. **Puesta en orden (one-time setup fee)** — implement the system: entry
   channels consolidated, lead capture + WhatsApp registered into the platform,
   pipeline configured for the client's vertical, follow-up reminders, the
   written process, team training. This is high-margin, fast to deliver with
   VenderCRM, and creates the monthly dependency.
3. **Sistema (base monthly)** — the platform + follow-up system kept running:
   monitoring, monthly numbers review (the "medición" meeting), small fixes,
   support. Low churn because the CRM holds their data and history.
4. **Crecimiento (growth monthly)** — adds paid acquisition on top: Google/Meta
   ads managed, landing/conversion work, monthly report of consultas por canal
   y costo. Ad spend always paid by the client directly (already promised in the
   services fineprint).
5. **Add-ons, productized:** automatización IA de respuesta WhatsApp, agenda
   online (the booking module), contenido/redes, SEO local. Priced per add-on.

Pricing guidance: keep "a medida, según diagnóstico" publicly (locked decision —
no pricing page until confirmed). Internally, anchor by vertical ticket size:
clínicas/constructoras/inmobiliarias support materially higher retainers than
generic SMBs because one recovered client pays the month. Quote the monthly as a
fraction of one recovered sale and say so in the proposal. Sell the setup fee as
crossing out the diagnostic's findings one by one.

Rationale: this matches the four-stage method page (diagnóstico → captación →
seguimiento → medición) 1:1 — each paid tier is a stage made permanent — so no
site copy needs to change to launch it.

## 5. CRM improvement backlog (crm.clientes.com.py) — ADVISORY ONLY

Anton asked for ideas, not changes: **do not implement any of these without his
explicit go-ahead, and never mix them into marketing-site PRs.** Ranked by
expected impact on the service the site sells; each should be validated against
the real UI before building.

Functions:

1. **"Hoy" action queue on the dashboard** — one list of follow-ups due today
   across pipeline, inbox and quotes. The site promises "nada depende de la
   memoria de alguien"; this is that promise as a screen.
2. **First-response-time metric** per channel in Reports — the sales pages argue
   "gana el que responde primero"; measuring it makes the pitch demonstrable to
   clients.
3. **Attribution-to-close report** — join the `vc-attribution` first-touch data
   to won deals: consultas y cierres por canal, closing the "sabés qué costó
   cada consulta" loop.
4. **"Presupuestos sin respuesta" view** — quotes sent N days ago with no next
   action, one click to schedule the follow-up (the constructoras/B2B pitch).
5. **Follow-up sequences in Automations** — e.g. presupuesto enviado → reminder
   at day 3/14/60 via WhatsApp template, per vertical preset.
6. **Per-vertical pipeline presets** at onboarding (clínica: consulta → turno →
   asistió; inmobiliaria: consulta → visita → oferta …), mirroring the booking
   vertical presets that already exist.
7. **Weekly owner digest** (email or WhatsApp): consultas entradas, respondidas
   a tiempo, presupuestos abiertos, cierres — the "medición" stage without
   logging in.
8. **Client-facing monthly PDF report** reusing the renderable-document module —
   retention tool for the service (and the inmobiliaria "informe al propietario").

Design:

1. Dashboard hierarchy: lead with the action queue + 3 numbers, charts second.
2. Mobile-first pass on pipeline/inbox (sellers in PY live on phones): list
   view toggle for the kanban, thumb-reach quick actions (llamar / WhatsApp /
   nota).
3. Empty states that teach the next step everywhere (the `empty-state`
   component exists — audit coverage).
4. Voseo/microcopy consistency audit across app screens (same guard the
   marketing copy has).
5. Onboarding checklist visible in the app shell until the tenant is fully set
   up (WhatsApp connected, pipeline configured, first form wired).

## 6. Definition of "page that sells" — QA before calling it done

- Every page: CTA pair visible at 390px without scrolling, WhatsApp deep link
  live (needs §2.1), form round-trip verified (§2.2).
- No fabricated proof anywhere, ever. Sections stay absent until real.
- `web-design-system` QA gate re-run after the imagery pass.
- OG preview checked by actually sharing each money page in WhatsApp.

## 7. Autonomy rules for the phase sessions

1. Work until the phase's exit criteria pass; never ask permission for in-plan
   work. Stop and ask ONLY for a missing credential with no graceful fallback
   or a decision where guessing wrong forces a rewrite.
2. One PR per phase, branch `phase/<id>` off latest main; arm GitHub auto-merge
   (squash) on it if the repo settings allow — if the call fails, say so in the
   phase report and watch the PR through the GitHub MCP tools instead. Never
   start on top of an unmerged previous phase. All GitHub state checks go
   through `mcp__github__*` tools, never curl/gh. Never end a turn "waiting for
   CI": end merged, or end with a stated blocker.
3. Minor non-blocking issues → `KNOWN-ISSUES.md`, keep building. Scope creep →
   §9 Backlog. Missing env/config values never block — degrade gracefully and
   record what's pending.
4. Model guardrail: phases run on Opus or Sonnet exactly as the table says.
   Fable is never spawned, scheduled, or written into a phase
   (fable-cost-guardrail); if a session believes it needs Fable, it stops and
   asks Anton with the reason.
5. Hard rules from Anton, all phases: no CRM code/behavior changes on
   `crm.clientes.com.py`; no fabricated proof of any kind; voseo Spanish through
   `next-intl` with en/sv key parity; validate before every push (`lint`,
   `typecheck`, `npx vitest run src/middleware.test.ts src/i18n/messages.test.ts`,
   production build).
6. Before merging, append a build-log entry to §8 (date, phase + PR, what now
   exists, decisions/deviations, where the next phase should look first).

## 8. Build log & handoff

- 2026-09-01 — pre-phase (Fable planning session, PR #79): built steps 4–5 of
  `MARKETING_SITE_PLAN.md` §6 — five `/soluciones/*` vertical pages, JSON-LD,
  host-aware robots/noindex for crm.*, sitemap, `/privacidad` + `/terminos`,
  og-images; wrote this plan and the M1/M2 prompts. All copy lives in
  `messages/*.json` under `marketing.soluciones` / `marketing.legal`. Next
  phase (M1) starts after PR #79 merges; look first at §2 launch blockers and
  `src/lib/site-config.ts`.

## 9. Backlog

- P6 bleed-image overlap on the closing bands once `hero-bleed` exists
  (`MARKETING_DESIGN.md` §3 records the swap is copy-compatible).
- Named method branding ("Método Clientes") — plan §8 open question 4.
- More /recursos articles beyond the first 10, one cluster at a time.
- First real case study page + social-proof sections when real material exists.
