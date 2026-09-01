# clientes.com.py — design record and handover

Companion to `MARKETING_SITE_PLAN.md`. That document is the source of truth for
positioning and architecture; this one records the resolved design decisions
from the `web-design-system` skill, what the QA gate found, and what is still
waiting on the owner.

Covers build-sequence steps 1–3 (routing shell, design pass, core pages).
Steps 4–5 (vertical pages, SEO plumbing and legal, code-generated og-images)
were built afterwards on the same system — current status and remaining work
live in `MARKETING_NEXT_STEPS.md`. Step 6 (`/recursos`) is not built. The
imagery fill and the social-proof sections remain pending as described below.

---

## 1. Track and palette

**Track: EDITORIAL** — flat fills with hairlines, light-dominant, a single
accent, generous air. The fit for consultants and B2B services, and the
opposite of the SaaS-dark look the plan's anti-goals rule out.

Palette derived from the accent, not copied from a preset. Every ratio below
was computed, not estimated.

| Token | Value | Notes |
|---|---|---|
| `--mk-accent` | `#0F6B85` | HSL hue **193.2°** |
| `--mk-accent-on-ink` | `#4FB4D0` | Same hue, lightened for dark fields |
| `--mk-ink` | `#0C1A20` | Hue 198° — a hue-shifted near-black, not grey |
| `--mk-base` | `#F1F4F5` | Desaturated near-neighbour of the accent |
| `--mk-surface` | `#FFFFFF` | |

| Pair | Ratio | Requirement |
|---|---|---|
| ink on base | 16.04:1 | 4.5:1 |
| body text (ink 70%) on base | 6.30:1 | 4.5:1 |
| meta text (ink 62%) on base | 4.80:1 | 4.5:1 |
| accent on base | 5.49:1 | 4.5:1 |
| white on accent (primary button) | 6.07:1 | 4.5:1 |
| base 75% on ink | 8.33:1 | 4.5:1 |
| on-ink accent on ink | 7.41:1 | 4.5:1 |

There is deliberately **no `ink 55%` step**: it measures 3.86:1 on this base
and would fail the moment someone reached for it.

The base accent is only **2.92:1 on ink**, which fails even the 3:1 non-text
floor — that is why `--mk-accent-on-ink` exists and why eyebrows, list marks,
step numbers and primary buttons swap to it inside `.mk-section--ink` and the
footer. It is the same hue, so the site still has exactly one accent colour.
`#25D366` appears only inside the WhatsApp glyph, never as a fill.

> **Gap flagged, not improvised.** The skill requires checking a new accent
> against `references/palette-registry.md` (≥40° hue separation from every
> other domain in the portfolio, display face used by fewer than three sites).
> That registry does not exist in this environment and the other sites are not
> in this repo, so **the portfolio-collision check could not be run**. Hue
> 193.2° and Newsreader are recorded here so the check can be done in one pass
> once the registry exists.

## 2. Type

Two faces total, both via `next/font` (no layout shift, `display: swap`):

- **Display: Newsreader** (400/500) — `--font-newsreader`, marketing only.
- **Text: Geist Sans** — already loaded by the root layout, so the marketing
  site adds exactly one font to the app's existing payload.

Scale ratio 1.30 from a 17px body, display tracking `-0.03em`, weight 450,
measure capped at 65ch. Eyebrows 13px / `0.12em` / uppercase.

## 3. Section-to-pattern map

Patterns are from the skill's library. No page uses the same pattern in two
consecutive sections, and each has one full-bleed element, one overlap and one
oversized statement.

| `/` | `/metodo` | `/contacto` | `/nosotros` |
|---|---|---|---|
| hero — P1 split 7/5 | header — P2 offset | header + form — P1 mirrored 5/7 | header — P2 offset |
| trust ribbon — P8 | steps — P7 sticky-side | trust ribbon — P8 | story — P4 editorial |
| problem — P4 editorial | included — P3 staggered | faq — P4 editorial | principles — P3 staggered |
| method — P5 rail | statement — P9 | | statement — P9 |
| verticals — P3 staggered | faq — P4 editorial | | closing — overlap + ink band |
| statement — P9 | closing — overlap + ink band | | |
| closing — overlap + ink band | | | |

Card variants in use: `--ink`, `--hair`, `--raised`, `--accent` (four of five),
none more than four times on a page.

**The overlap is built from the raised panel crossing into the closing ink
band, not from an image.** The skill's P6 wants a full-bleed image there; the
imagery step has not run, and a marked-but-empty image slot must never ship.
When step 5 fills the slots, P6 can replace this without touching the copy.

## 4. Motion

`public/mk-motion.js` is the skill's `motion.js`, copied verbatim. Measured on
the homepage: **9 of 135 elements animate (6.7%)**, against a 15% budget. Only
repeated small elements reveal (method steps, vertical cards) — no prose block
is hidden behind an IntersectionObserver, and nothing above the fold animates.
Verified under `prefers-reduced-motion: reduce`: all 9 targets render fully
visible without scrolling.

## 5. QA pre-flight

Run against a production build at 360px and 1280px.

**Passing:** no placeholder text in rendered output (`TODO`, `COMPLETAR`,
`undefined` all absent from all four pages); no fabricated proof of any kind;
no horizontal overflow at either width; one `<h1>` per page; semantic
landmarks and a skip link; every contrast pair measured above; one accent;
reduced-motion honoured; contact form posts server-side with no key in client
source; every CTA carries `data-ev` / `data-ev-loc` and the inert dataLayer
shim ships.

**Explicitly pending, not silently skipped:**

- **All image slots are empty.** No `hero-bleed`, `section-break` or
  `card-motif` asset exists yet; the layouts were composed to read complete
  without them (type, grain and ink fields carry the weight). Imagery is part
  of build step 5.
- **No social proof.** No testimonials, cases, logos or numbers — the plan
  forbids inventing them and the sections are omitted rather than stubbed.
- **Lighthouse / Core Web Vitals not measured.** Worth running once the site is
  on a real host with real images.
- **`robots`, `sitemap`, JSON-LD and og-images** are build step 5.

## 6. What the owner still has to supply

All of it lives in `src/lib/site-config.ts` as an explicit `null` with a
`TODO(owner)` beside it. Each is read through a guard, so while it is null the
element is **absent** rather than rendered as a placeholder — the site is
launch-safe today and each of these is a one-line edit.

| Field | What is missing while it is null |
|---|---|
| `whatsappNumber` | **Every WhatsApp CTA on the site.** The pages currently show the form CTA alone. This is the biggest single gap: the plan's conversion pair is form + `wa.me`, and only half of it can ship. |
| `phoneE164` / `phoneDisplay` | The header and footer phone links |
| `email` | The footer email row |
| `address` | The footer address row |
| `ruc` | The RUC entry in the trust ribbon |

## 7. Environment variables

The contact form posts server-to-server to our own `/api/v1/leads`, exactly as
a customer site would (`vendercrm-lead-capture`). Two variables, both
server-only — **never** prefixed `NEXT_PUBLIC_`, which would inline the key
into the client bundle:

| Variable | Value |
|---|---|
| `VENDERCRM_API_KEY` | Site API key created under **Sitios** for a `clientes.com.py` site row on the owner's tenant. Shown once. |
| `VENDERCRM_URL` | Optional. Defaults to `https://crm.clientes.com.py`. |

Without the key the form still thanks the visitor and the failure is logged —
it never shows an error page — but **no lead is recorded**. This is open
question 2 in the plan and is the one thing that must be settled before the
site takes real traffic.

Verify the round trip after deploy: submit the real form, confirm the contact
in **Contactos** with the phone normalized to `+595…`, confirm the deal in
**Pipeline** if the site row has a default stage, and submit twice to confirm
the second submission does not create a second contact.
