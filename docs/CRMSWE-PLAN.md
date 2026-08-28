# CRM Swe — Swedish-market adaptation plan

> **This file (`plan.md`) is the build plan for the Swedish edition.** The inherited
> 2417-line vendercrm architecture spec has been moved to `docs/VENDERCRM-PLAN.md` —
> it stays authoritative for the *architecture that already exists* (tenancy model,
> isolation rules, module layout, `§` references in code comments). This plan only
> describes what changes for Sweden. When they conflict, this plan wins.

This repo started as a full-history copy of `antonmarklundcom/vendercrm`
(copied 2026-08-28 at commit `680aa79`). It diverges from here as the Swedish
edition. Keep file structure and module names aligned with vendercrm where
possible so fixes can be cherry-picked in either direction.

## Phase table

| Phase | Model | Prompt file | Covers plan sections |
|---|---|---|---|
| O1 — Money & schema foundation | Opus | `prompts/opus-1-foundation.md` | §5.1 |
| O2 — Moms & faktura engine | Opus | `prompts/opus-2-moms-faktura.md` | §5.2 |
| O3 — Channels, e-post & GDPR | Opus | `prompts/opus-3-channels-gdpr.md` | §5.3 |
| S1 — Branding & UI sweep | Sonnet | `prompts/sonnet-1-branding.md` | §6.1 |
| S2 — Swedish marketing site | Sonnet | `prompts/sonnet-2-marketing.md` | §6.2 |
| S3 — Deploy & launch checks | Sonnet | `prompts/sonnet-3-deploy.md` | §6.3 |

One PR per phase, merged green before the next starts. Opus phases first — they
own schema, money math and fiscal logic. Sonnet phases never touch those.

---

## 1. Decisions already made — do not re-litigate

Recorded 2026-08-28. These are locked for build sessions. (Anton can override any
of them by editing this section before phase O1 starts — after that, changing
them is a new plan.)

1. **Fork, not multi-market codebase.** crmswe is a standalone Swedish product.
   vendercrm stays the Paraguay product. No runtime "market" switch. But: keep
   diffs surgical so improvements flow both ways via cherry-pick.
2. **Money is stored in öre** (integer minor units, ×100). vendercrm stores whole
   guaraníes because PYG has 0 decimals; SEK needs öre for moms math to be exact.
   Every display/parse path is audited in O1. Display: `1 495,00 kr` /
   `1 495 kr`, space as thousands separator, comma decimal (`sv-SE` Intl).
3. **Tenant-level currency setting**, default `SEK`. All per-row `currency`
   defaults flip from `PYG` to `SEK`. Multi-currency per tenant stays out of
   scope (Backlog).
4. **Moms is modeled per line** (25/12/6/0 %), never only on the total. Rates are
   configuration rows with validity dates, never hardcoded constants (see §8 of
   the sweden-business-apps skill discipline).
5. **The `documents` module becomes svensk faktura.** It already has the right
   bones: draft→issued→void lifecycle, per-tenant unbroken sequences, immutable
   issued docs, payments ledger. We extend it to meet mervärdesskattelagen
   requirements instead of building a new module. Quotes = "offert".
6. **Kreditfaktura is a document type**, referencing the original. Issued
   invoices are never edited; sequences never reuse numbers (soft delete only).
7. **E-post is the primary channel, not WhatsApp.** The WhatsApp module stays in
   the codebase (inert, feature-hidden) — deleting it makes cherry-picking from
   vendercrm painful. Nav hides it; marketing never mentions it. Email (Resend)
   carries invoices, quotes, reminders. SMS: Backlog.
8. **SIFEN module is deleted** (`src/modules/sifen/`). It is boundary-isolated
   and inert, and its seam is exactly where Swedish e-faktura/Peppol or a
   Fortnox/SIE export will later plug in (Backlog). The boundary test discipline
   (fiscal module imports nothing from other modules) is kept for the moms code.
9. **org.nr on contacts and tenants.** Dedicated nullable column, Luhn-validated,
   `NNNNNN-NNNN` formatting; enskild firma personnummer form accepted. Tenant
   company profile additionally gets momsregnr (derived `SE`+orgnr+`01`),
   bankgiro/plusgiro, F-skatt flag, betalvillkor default (30 days).
10. **Personnummer is NOT stored anywhere in v1.** ROT/RUT (which needs it) is
    Backlog; when it comes, it follows the sweden-business-apps §2/§5 rules.
11. **Locales:** keep all three (`sv`, `en`, `es`) — the parity test keeps them
    honest and the es file costs nothing. `DEFAULT_LOCALE` becomes `sv`;
    `sv.json` becomes the reference locale in the parity test. Tenant default
    locale `sv`, timezone `Europe/Stockholm`, phone country `SE`.
12. **BankID and Swish integrations are architecture-prepared only** (auth
    provider abstraction untouched; invoice shows bankgiro + OCR as MVP).
    Backlog until there's a paying reason.
13. **Sequence prefixes become per-tenant config** with Swedish defaults:
    offert `OFF-`, faktura `FA-`, kreditfaktura `KF-`.
14. **Brand placeholder is "CRM Swe"** with host placeholders in
    `src/lib/site-config.ts` until Anton supplies the real name/domain (§7).
    Everything brand-related must flow through that file so the real brand is a
    one-file change (plus icons).
15. **Stack unchanged:** Next.js 15 / Drizzle / MySQL 8 / better-auth / Hostinger
    managed Node.js, per `nodejs-mysql-hostinger-stack` + `nextjs-deploy-hostinger`.

## 2. Roles & object model

Unchanged from the inherited architecture (`docs/VENDERCRM-PLAN.md` §3): tenants,
users, `tenant_memberships` with `role ∈ {admin, agent}`, superadmin flag,
tenant-scoped `tenantDb(ctx)` access with the ESLint + isolation-test wall. No
new roles for Sweden. New objects introduced by this plan:

- `tenant_company_profile` fields (on tenants.settings or a typed table — O1
  decides, prefer typed columns for identifiers): org.nr, momsregnr, bankgiro,
  plusgiro, F-skatt flag, default betalvillkor days, invoice footer text.
- `vat_rates` config table: rate (basis points), label, valid_from/valid_to,
  source note. Seeded with 2500/1200/600/0 and a source comment; UI shows where
  the value comes from.
- Moms columns on `products`, `quote_items`, `document_items`; moms summary
  persisted on issued documents (per-rate base + amount, so the PDF snapshot
  never depends on later config).
- `document_sequences` gains kreditfaktura; documents gain `type ∈ {faktura,
  kreditfaktura}` (replacing `nota_venta`), `credits_document_id`, OCR number,
  due date, delivery date.

All code/DB identifiers in English (`vat_rate_bps`, `org_nr`, `ocr_number`);
UI strings through next-intl only, in du-form Swedish.

## 3. Feature scope

**Core (this plan):** everything vendercrm ships today, minus WhatsApp-visible
surfaces, plus: tenant currency SEK/öre, per-line moms, legally complete faktura
+ kreditfaktura with PDF, OCR/bankgiro payment block, org.nr on contacts &
tenants, Swedish defaults everywhere, e-post delivery of offert/faktura, GDPR
export + anonymization, Swedish marketing site, Hostinger deployment.

**Explicitly out (Backlog, §10):** ROT/RUT rows, Fortnox/SIE/Peppol export,
Swish Handel, BankID login, SMS channel, multi-currency, påminnelseavgift/
dröjsmålsränta automation (fields exist as config, no automation).

Dependency note: moms (O2) depends on öre + tenant currency (O1). GDPR surfaces
(O3) depend on nothing new — but come after O2 so anonymization covers invoice
fields. All Sonnet phases depend on O1–O3 merged.

## 4. Autonomy protocol

Applies to every build session in this repo.

1. Work until the phase's exit criteria pass; never ask permission for in-plan work.
2. One PR per phase: branch `phase/<id>` off latest `main`; create, watch, and
   merge the PR when green. A red build is always the session's own work. Never
   start on top of an unmerged previous phase.
3. Minor non-blocking issues → `KNOWN-ISSUES.md`, keep building.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or a
   bad-foundation decision (schema shape, auth, money math, moms logic) where a
   wrong guess forces a rewrite. Everything else: choose reasonably, record in
   the build log, continue.
5. Missing env values never block: document in `.env.example`, degrade gracefully.
6. Every phase prompt is re-runnable: check what exists on the branch first,
   continue from the first unmet exit criterion.
7. Sonnet hard limits: no schema, auth, money-math or moms-logic changes; data
   access only through existing query layers. Workaround + Backlog note instead.
8. **Model cost guardrail:** Fable/Mythos-class models are NEVER used for build
   phases, subagents, or spawned sessions. Phase table names only Opus and
   Sonnet. If a session believes Fable is needed, it stops and asks Anton first.
9. **Phase handoff** — only when four gates pass: PR merged green; exit checklist
   passed; pre-handoff audit done (re-run build + tests, adversarially re-read
   your own merged diff, fix findings); build-log entry committed. Then spawn the
   next phase as a NEW session via claude-code-remote `create_session`: inherit
   environment and permission mode (never `plan`), set `model` per the phase
   table, prompt exactly `Read prompts/<next-file>.md in this repo and execute
   it.` Fallback without `create_session`: continue in the same window if the
   model matches; stop and report at a model switch.
10. **Build log:** before merging, append a 5–10 line dated entry to §9. Fresh
    sessions orient from plan.md + §9 + KNOWN-ISSUES.md ONLY.
11. **Anti-fabrication:** never hardcode tax rates, fee amounts, or legal
    thresholds inline — config rows with source + validity date. Unsure about a
    current rule → mark it as configuration and note it in KNOWN-ISSUES.md for
    verification against Skatteverket, don't guess.

## 5. Opus phases

### §5.1 Phase O1 — Money & schema foundation

The COMPLETE Swedish schema delta is written here, even where UI comes later.
Schema is never retrofitted.

1. **Repo hygiene:** `git mv PLAN.md docs/VENDERCRM-PLAN.md` (case-collision
   hazard on Windows/macOS with this plan.md — must happen in the first commit).
   Update the few docs that link to it. Delete `src/modules/sifen/` and its
   tests; keep the boundary-test pattern for later fiscal code. Rename
   `package.json` name to `crmswe`. Env: rename `VENDERCRM_API_KEY`/
   `VENDERCRM_URL` → `CRMSWE_*` in `src/lib/vendercrm-lead.ts`, `.env.example`,
   CI (`.github/workflows/` also has `DATABASE_URL: .../vendercrm`).
2. **Öre migration:** money stays integer minor units (`src/lib/money.ts`), but
   semantics change from "whole PYG" to "öre". Audit every path that formats,
   parses, or aggregates money: `src/lib/i18n/format.ts` `formatMoney` (must use
   `Intl.NumberFormat` currency style, correct fraction digits per currency —
   fixes the `"1 500 000 PYG"` suffix style), `src/modules/renderable-document/
   format.ts`, `src/modules/crm/search.ts:107` (money search parsing —
   `1 500` / `1500,50` Swedish input), CSV import (`products-csv.ts`), reports
   (`src/modules/reports/sales.ts`), dashboard (`src/modules/dashboard/
   summary.ts:176` — kill the hardcoded `currency === "PYG"` filter).
3. **Tenant currency:** add to tenant settings (default `SEK`); thread through
   every service-layer default currently hardcoding `"PYG"`: `src/modules/crm/
   deals.ts:35`, `src/modules/quotes/{quotes,products}.ts`, `src/modules/
   documents/documents.ts:67`, `src/modules/tenancy/subscriptions.ts:112`,
   `src/modules/quotes/products-csv.ts:127`, `src/modules/reports/sales.ts:258`.
   Migrate column defaults from `'PYG'` to `'SEK'` in the 6 tables.
4. **Swedish defaults:** `DEFAULT_COUNTRY` → `SE` (`src/lib/phone.ts:15`);
   `DEFAULT_TIMEZONE` → `Europe/Stockholm` (`src/lib/i18n/format.ts:10` + the 4
   other `America/Asuncion` sites: `src/db/schema/tenancy.ts:33`, `src/modules/
   tenancy/tenants.ts:34`, `src/app/(app)/booking/actions.ts:242`,
   `src/app/(app)/settings/page.tsx:92`); `DEFAULT_LOCALE` → `sv` +
   `tenants.locale` default; parity test reference → `sv.json`. Fix the two
   `toLocaleString("es-PY")` leftovers (`src/components/audit-table.tsx:47`,
   `src/app/(superadmin)/whatsapp-health/page.tsx:203`).
5. **Schema delta (one migration set):** org.nr on contacts + tenant company
   profile fields (§2); `vat_rates` table + seed; moms columns on `products`,
   `quote_items`, `document_items` (rate bps + amount öre, nullable until O2
   activates them); document type enum `{faktura, kreditfaktura}` + migration of
   `nota_venta` rows; `credits_document_id`, `ocr_number`, `due_date`,
   `delivery_date` on documents; kreditfaktura sequence; per-tenant sequence
   prefix config (defaults `OFF-`/`FA-`/`KF-`).
6. **Validators:** `src/lib/se/identity.ts` — Luhn org.nr/personnummer-form
   validation + formatting; OCR number generation (Luhn + length digit). Unit
   tests with real-format fixtures.
7. **Seed/demo data:** `DEFAULT_STAGES` (`src/modules/crm/pipelines.ts:17-24`)
   and pipeline name `"Ventas"` → Swedish (`Ny kontakt, Kontaktad, Offert
   skickad, Förhandling, Vunnen, Förlorad`; pipeline `Försäljning`);
   `scripts/seed-demo-data.ts` → Swedish companies, `+467…` phones, SEK öre.

Exit: build + typecheck + full test suite green (including migrations against
MySQL in CI); org.nr/OCR validators tested; a seeded dev tenant shows SEK
formatting (`12 500,00 kr`) on dashboard, pipeline, quotes, documents; no
remaining `"PYG"` literal outside `messages/es.json` history and tests that
cover legacy data; PR merged.

### §5.2 Phase O2 — Moms & faktura engine

1. **Moms math** in `src/lib/money.ts` (or `src/lib/moms.ts`): per-line rate →
   line moms in öre, rounding per line (document total = sum of rounded lines;
   document the rounding rule in code); mixed rates per document; per-rate
   summary (beskattningsunderlag + momsbelopp per sats). Property-style unit
   tests: sums always reconcile, no öre lost.
2. **Products & quote/document lines:** momssats picker (from `vat_rates`,
   default 25 %), prices entered exkl. moms; totals show netto / moms / brutto.
3. **Faktura legal completeness** (mervärdesskattelagen + bokföringslagen):
   fakturadatum, unbroken number, seller name + org.nr + momsregnr, buyer name +
   address, scope of goods/services, delivery date, per-rate summary, "Godkänd
   för F-skatt" when tenant flag set, betalvillkor + förfallodatum, bankgiro/
   plusgiro + OCR block. Update `src/modules/documents/pdf.tsx` (faktura) and
   `src/modules/quotes/pdf.tsx` (offert) with the tenant-locale translator
   pattern already in place. Issued snapshot persists the moms summary.
4. **Kreditfaktura flow:** create-from-faktura, negative lines referencing
   original, own sequence, payments ledger handles it; issued faktura remains
   immutable — corrections only via kreditfaktura. Voiding restricted to drafts.
5. **7-year discipline:** verify no destructive delete path exists for issued
   documents (soft delete only); document the archival stance in code comments.
6. **UI wording:** documents module surfaces become "Fakturor"; new i18n keys in
   all three locales (sv reference).

Exit: mixed-rate faktura (25+12+6 lines) computes and renders correctly in PDF
and public `/d/[token]` page with per-rate summary and OCR; kreditfaktura
round-trip test passes; immutability test passes (no mutation path for issued
docs); reports/dashboards reconcile netto vs brutto consistently (pick netto,
state it in UI); suite green; PR merged.

### §5.3 Phase O3 — Channels, e-post & GDPR

1. **Hide WhatsApp for the Swedish product:** remove nav entries (`/inbox`,
   `/whatsapp` and the `factura-electronica` "soon" badge in
   `src/app/(app)/layout.tsx:75-128`), hide WA fields in `/sites` and settings.
   Code and tables stay; routes return 404-or-redirect when feature flag off.
   Single flag, default off, in tenant settings — flipping it back on is one line.
2. **E-post-first flows:** send offert and faktura by email (Resend, existing
   template layer `src/lib/email/templates.ts`) with the public token links;
   betalningspåminnelse email (manual trigger; automation via existing flows
   engine if cheap); make sure sender/reply-to are per-tenant configurable.
3. **GDPR surface:** per-contact data export (JSON, all tenant-scoped data for
   that contact) and anonymization action that scrubs personal fields but
   preserves issued invoices (anonymize buyer fields only after noting the
   7-year rule — anonymization of invoice buyer data is admin-confirmed and
   logged in `audit_log`). Extend `src/modules/crm/deletion.ts`. Access to
   org.nr/personal fields logged where the audit layer already hooks.
4. **Booking/forms/chat sanity pass for SE:** week starts Monday, week numbers
   visible in calendar views, date pickers `sv-SE`.

Exit: WA invisible with flag off and fully functional with flag on (test both);
faktura email lands with working public link (dev: Resend test mode or log
driver); GDPR export returns complete JSON, anonymization test proves invoices
survive scrubbed; suite green; PR merged.

## 6. Sonnet phases

Hard limits (protocol §4.7): no schema/auth/money/moms changes; UI reads through
existing modules only.

### §6.1 Phase S1 — Branding & UI sweep

1. `src/lib/site-config.ts`: brand "CRM Swe" placeholders, `APEX_HOST`/
   `APP_HOST` placeholder envs (readable from env so the real domain is
   config, not code — the file currently mixes infra + content; split them),
   `locale: "sv-SE"`, clear the Paraguay contact block.
2. `src/app/layout.tsx:18-24` metadata + `src/app/manifest.ts` + viewport theme
   color; new neutral icon (keep the rounded-square mark, different letter/hue —
   regenerate the PNG set from `public/icon.svg`).
3. Route-slug sweep, public-facing only: `/f/.../gracias` → `/tack` (redirect
   kept), marketing slugs per S2; internal `/pipeline/etapas` → `/pipeline/steg`
   only if trivially safe, else Backlog. Remove `/factura-electronica` stub.
4. `messages/*.json`: replace the six hardcoded `(PYG)` labels with ICU
   currency-aware args fed by tenant currency; sweep sv.json for LatAm phrasing
   ("WhatsApp", guaraní examples) in app + email + pdf namespaces.
5. `src/app/(app)/sites/SiteGuide.tsx` + `SiteHookGuide.tsx`: translate embedded
   code-sample comments, swap `dentista.com.py` placeholder for a `.se` example;
   `public/vc-attribution.js` / `w.js` header comments.

Exit: `rg -i "clientes\.com\.py|vendercrm|PYG|Asunción|guaraní"` over `src/`,
`public/`, `messages/` returns only deliberate legacy-data handling and
`docs/VENDERCRM-PLAN.md`; app UI walkthrough in Swedish shows no Spanish or
Paraguay artifacts; build green; PR merged.

### §6.2 Phase S2 — Swedish marketing site

Rewrite `src/app/(marketing)/` + `src/components/marketing/` for Swedish SMB:
positioning = "CRM med offert och faktura för svenska småföretag — leads in,
offert ut, faktura betald", e-post-first (WhatsApp never mentioned), pricing in
"kr/mån exkl. moms". Routes `/metodo|/nosotros|/contacto` → `/sa-funkar-det`,
`/om-oss`, `/kontakt`. GDPR-granular cookie banner on public surfaces. Load
`nextjs-national-lead-gen` + `web-design-system` skills for structure/visuals;
`higgsfield-web-imagery` only if image slots are declared. Contact form posts
into the CRM itself via the existing `/api/v1/leads` lane (dogfood).

Exit: all marketing pages render in Swedish with working lead capture into a
seeded tenant; Lighthouse sanity (no console errors, images sized); metadata/
OG in Swedish; build green; PR merged.

### §6.3 Phase S3 — Deploy & launch checks

Load `nextjs-deploy-hostinger` FIRST. Hostinger managed Node.js + MySQL setup
per that skill (Remote MySQL, env vars incl. renamed `CRMSWE_*`, subdomain
mapping per §7 inputs), run migrations, seed minimal prod tenant, smoke-test:
login, contact create, deal drag, offert PDF, faktura issue + email, lead API
end-to-end with a real key. Wire `/api/cron/*` per existing docs. Write
`docs/DEPLOY.md` deltas for this brand.

Exit: production URL serves the app + marketing; smoke checklist all green and
recorded in the build log; closing report to Anton with live URLs + §7 leftover
manual steps. STOP — no further phases.

## 7. Human-inputs checklist

| Input | Needed by | Status |
|---|---|---|
| Real brand name + domain (.se) | S1 (placeholders until then) | ☐ Anton |
| Hostinger slot + MySQL DB + Remote MySQL access | S3 | ☐ Anton |
| Resend domain verification (SPF/DKIM) for the new domain | S3 | ☐ Anton |
| Company details for the marketing footer (org.nr etc.) | S2 | ☐ Anton |
| `APP_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `CRON_SECRET` (fresh — never reuse vendercrm's) | S3 | ☐ generate at deploy |
| Sentry DSN (optional) | S3 | ☐ optional |
| Target niche confirmation (generic SMB now; hantverkare + ROT/RUT later?) | affects Backlog priority only | ☐ Anton |

## 8. Open business questions (parked — not build work)

- Pricing i SEK (t.ex. 495 kr/mån exkl. moms?) and whether prepay-only manual
  billing (inherited model) fits Sweden or Stripe/Swish is needed sooner.
- Sell as separate brand vs "VenderCRM Sverige".
- Which vertical to market first (hantverkare vs. tjänsteföretag generally) —
  decides ROT/RUT priority.
- Fortnox export: SIE-file first or API integration first.

## 9. Build log & handoff

> Every phase appends 5–10 dated lines here before merging: phase id + PR, what
> now exists, decisions/deviations, where the next phase should look first.

- **2026-08-28 — plan:** Repo created as full-history copy of vendercrm@`680aa79`.
  plan.md + prompts/ committed; inherited spec moved to `docs/VENDERCRM-PLAN.md`
  happens in O1 (first commit). Next: phase O1 (`prompts/opus-1-foundation.md`).

## 10. Backlog

- ROT/RUT line types (config-driven rates/caps with validity dates; personnummer
  + fastighetsbeteckning handling per GDPR rules; kundbetald ≠ slutbetald status).
- Fortnox/Visma export (SIE-4 file first), later Peppol BIS e-faktura — plugs
  into the seam the deleted SIFEN module occupied.
- Swish Handel (QR/number display as manual MVP first), BankID auth provider.
- SMS channel; generic email inbox channel in the conversations tables.
- Multi-currency per tenant; dröjsmålsränta/påminnelseavgift automation.
- Internal route slug translation (`/pipeline/etapas` if deferred in S1).
- Dark mode toggle (tokens already exist in `globals.css`).
- Shared-with-vendercrm debt (fix here, offer cherry-pick back): in-memory rate
  limiter breaks under multi-instance; contacts-feed token lookup table-scans
  all tenants; two inconsistent money renderers (fixed in O1 here); Graph API
  version pin `v21.0`.
