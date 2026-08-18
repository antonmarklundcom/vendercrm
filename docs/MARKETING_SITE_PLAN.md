# clientes.com.py — Marketing Site Plan

> **Authored by the planning model** for handoff to a build model (Opus). This document
> is the source of truth for the apex-domain marketing site. Build model: do not
> re-litigate locked decisions (§1); when a genuine gap is found, flag it for owner
> review rather than improvising positioning or architecture.

---

## 1. Positioning & locked decisions

### 1.1 What this is

The marketing website for **clientes.com.py** — a Paraguayan **business-growth /
client-acquisition brand for established SMBs**. It sells the *outcome* (more clients,
an organized sales process), not "a website" and not "a CRM". VenderCRM (the app on
`crm.clientes.com.py`) exists behind the scenes as part of the service and stays
**secondary in the messaging** — never the headline.

Built inside this same Next.js repo, replacing the current placeholder in
`src/app/marketing-page.tsx`.

### 1.2 Locked decisions — DO NOT reopen

| Decision | Value |
|---|---|
| Brand | clientes.com.py = growth-partner service brand. **The CRM product name is never used on the public site — owner decision, 2026-08-18.** It is referred to only as "la plataforma" / "nuestra plataforma". The word "CRM" never appears above the fold. (The name still exists inside the logged-in app and in this repo; renaming that is a separate decision.) |
| Audience | **Established** Paraguayan SMBs with validated offers: clínicas, constructoras, inmobiliarias, servicios profesionales, empresas B2B. Not early-stage entrepreneurs. |
| Conversion goal | Booked diagnostic conversation. Every page's CTA pair = short qualifying form + WhatsApp deep link (`wa.me`). |
| Lead capture | Contact form posts to this app's own `POST /api/v1/leads` (tenant-scoped, `X-Api-Key`, server-to-server per PLAN.md §5.1) — the brand's own leads land in the owner's VenderCRM pipeline. |
| Language | Paraguayan Spanish, **voseo** (tenés, querés), consistent sitewide. All copy through `next-intl` (`messages/es.json`) from day one. |
| Pricing | **No pricing page** until pricing is confirmed. "A medida, según diagnóstico" on /contacto. |
| Social proof | No fake/placeholder testimonials, cases, or logo walls. Sections omitted entirely until real content exists; layout must read complete without them. |
| CRM login | Quiet "Ingresar" text link (header top-right, ghost style; repeated in footer) → `https://crm.clientes.com.py/login`. Never a CTA button. |
| Canonical host | `https://clientes.com.py` (301 `www.` → apex). `crm.*` host serves `noindex` robots (except possibly `/login`); sitemap on apex only. |
| TBD details | Phone, WhatsApp number, address, RUC centralized in one `site-config.ts` with obvious `TODO` placeholders — launch-day is a one-file edit. |
| Content hub | `/recursos` is **Phase 2** of this site. Static MDX/file-based content; no DB-backed CMS. Drizzle stays a CRM concern. |

### 1.3 Anti-goals

- No "hacemos páginas web" framing (price-competition with freelancers).
- No CRM feature grids or app screenshots on the homepage.
- No SaaS anglicism-speak; "consultas" / "clientes potenciales" over "leads" where natural.
- No startup language — the reader already has clients; we make acquisition systematic.

---

## 2. Site structure

One primary intent per page; no keyword cannibalization between pages.

| Route | Purpose |
|---|---|
| `/` | Hero (outcome) → problem → method teaser → verticals grid → final CTA |
| `/metodo` | The process as a named 3–4 step method (diagnóstico → captación → seguimiento → medición). Substitutes for missing social proof: a concrete method builds the trust testimonials would. |
| `/soluciones/[vertical]` | Five pages: `clinicas`, `constructoras`, `inmobiliarias`, `servicios-profesionales`, `empresas-b2b`. One shared template component + per-vertical content config. Vertical vocabulary (pacientes / obras y presupuestos / consultas y visitas…). Highest-value SEO + sales pages. |
| `/contacto` | THE conversion page: qualifying form (→ `/api/v1/leads`) + WhatsApp button. |
| `/nosotros` | Credibility: who's behind it, why Paraguay, why these verticals. |
| `/recursos`, `/recursos/[slug]` | Content hub — Phase 2. Reserve the structure now. |
| `/privacidad`, `/terminos` | Legal boilerplate. |

**Deliberately absent until real content exists:** `/precios`, `/casos`, testimonials,
logo wall.

---

## 3. Messaging hierarchy

Three layers, strictly ordered:

1. **Outcome (headlines):** more clients, predictable pipeline, nothing falls through
   the cracks. Territory: *"Más clientes. Un proceso de ventas ordenado."* /
   *"Ayudamos a empresas paraguayas establecidas a conseguir más clientes — con un
   sistema, no con suerte."*
2. **Method (body copy):** diagnosis → capture (presence, forms, WhatsApp) →
   follow-up system → measurement. The method is the product.
3. **Tools (last, generic):** "incluye la plataforma donde tu equipo ve cada consulta
   y cada seguimiento". Referred to only as "la plataforma", never by product
   name, and only as evidence the platform is first-party — not as the pitch.

---

## 4. Routing & relationship to crm.clientes.com.py

Current state: `src/app/page.tsx` host-checks (`APP_HOST_PREFIX = "crm."`) and renders
the placeholder for non-crm hosts; `src/middleware.ts#isPublicPath` allowlists `/`
exactly plus a few prefixes.

Changes:

- **`(marketing)` route group** with its own `layout.tsx` (marketing header/footer,
  distinct from app chrome). Placeholder content moves/dies here.
- **Host-aware middleware:** on any non-`crm.*` host, all marketing routes are public
  (everything except `/api`); on `crm.*`, the current strict allowlist stays unchanged.
- **Apex → crm redirects** for app paths (`/dashboard`, `/pipeline`, `/login`, …) so
  wrong-host bookmarks redirect instead of 404/marketing-404.
- **Canonical-host redirect:** 301 `www.` → apex.
- CRM keeps its own in-app branding; the host split already in `page.tsx` stays.

---

## 5. Design direction

Apply the `web-design-system` skill at build time. Pattern menu picks (deliberate,
and stop there):

- **Split-screen hero** on `/`.
- **Bento grid** for the verticals overview.
- **Scroll-triggered method steps** on `/metodo` (respect `prefers-reduced-motion`).

Restraint baseline: 8px spacing grid, ~1.25 type scale, max 2 typefaces, ONE accent
color reserved for CTAs, one attention motion per screen, mobile-first single-column
flow designed before desktop.

Marketing-specific design tokens layer onto `globals.css` without disturbing app
styles. Shared section components (~6–8): `Hero`, `ProblemSection`, `MethodSteps`,
`VerticalCard` grid, `CtaBand`, `Faq`, `ContactForm`, footer/header.

Imagery: Higgsfield pipeline (`higgsfield-web-imagery` skill) — consistent art
direction, believable Paraguayan business contexts, no stock-photo gloss.

---

## 6. Build sequence

Each step independently deployable behind the existing host check; the placeholder is
only replaced when step 3 lands.

| Step | Scope | Notes |
|---|---|---|
| 1 | **Routing shell** | `(marketing)` route group + layout; host-aware middleware; apex→crm app-path redirects; www→apex canonical redirect. Unit-test `isPublicPath` host logic (existing tests cover the allowlist — extend them). |
| 2 | **Design pass** | Tokens + the shared section components. `web-design-system` skill. |
| 3 | **Core pages** | `/`, `/metodo`, `/contacto` (form wired to own leads endpoint per `vendercrm-lead-capture` + `wa.me` link), `/nosotros`. **Shippable milestone.** |
| 4 | **Vertical pages** | One template, five content configs, shipped together. |
| 5 | **SEO plumbing + legal** | `sitemap.ts`, host-aware `robots.ts`, per-page `generateMetadata` (title ≤ 60, desc ≤ 155, og-image), JSON-LD (`Organization` sitewide; `Service` + `FAQPage` on verticals), `/privacidad`, `/terminos`. Imagery fill. |
| 6 | **Phase 2: /recursos** | Separate effort. Static MDX; cluster plan in §7. |

**Reusable as-is:** Tailwind 4 + `globals.css`, shadcn `button`/`card` +
`components.json`, `lucide-react`, `next-intl` + `messages/es.json`, `/api/v1/leads`,
Hostinger deploy pipeline (same app, same domains — nothing changes in hPanel).

**Suggested first PR:** steps 1–3 as one deploy — placeholder → credible site in one
release.

---

## 7. SEO & content strategy (Paraguay)

- Google.com.py, Spanish only. Modest volumes, weak competition — winnable with a
  small, well-structured site.
- **Money pages own commercial intent:** homepage = brand + generic "conseguir más
  clientes Paraguay"; each vertical page = "marketing para clínicas Paraguay" /
  "conseguir pacientes" etc. Blog never targets a keyword a vertical page owns.
- **Phase-2 content clusters, one per vertical** (e.g. clínicas: "por qué tu clínica
  pierde pacientes por no responder WhatsApp a tiempo", "cuánto cuesta conseguir un
  paciente nuevo"). Practical, numeric, PY-specific. Every article links to its
  vertical page + 2–3 siblings.
- **WhatsApp-first conversion** makes modest traffic worth more — form + `wa.me` on
  every page.
- **Later multipliers:** Google Business Profile for the brand (`gbp-optimizer`
  skill); first real named case study with numbers.
- Technical checklist (from `nextjs-national-lead-gen` §3): sitemap/robots via
  Metadata API, canonical per page, static generation for all content pages, Core Web
  Vitals (LCP < 2.5s, CLS < 0.1, INP < 200ms), `next/image` + `next/font`, internal
  linking rules above.

---

## 8. Open questions for the owner (non-blocking)

1. Final brand voice check: voseo confirmed? (Plan assumes yes.)
2. Which tenant + site row does the brand's own contact form post to? (Needs an
   `X-Api-Key` for the owner tenant with a `sites` row for clientes.com.py.)
3. WhatsApp number for `wa.me` CTAs — placeholder until provided in `site-config.ts`.
4. Named method branding (e.g. "Método Clientes") — nice-to-have, copy works without it.
