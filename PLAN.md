# VenderCRM — Architecture & Build Plan

> **Authored by Fable 5** (planning/architecture model) for handoff to **Sonnet 5** and
> **Opus 4.8** (build models). This document is the source of truth for scope, schema,
> and sequencing. Build models: do not re-litigate locked decisions (§1.2); when a
> genuine gap is found, flag it for a Fable review gate rather than improvising
> architecture.

---

## 1. Product summary & locked decisions

### 1.1 What this is

A **WhatsApp-first sales CRM for Paraguay**, positioned as *WhatsApp automation + CRM*.
Built first for the owner's own sales team, but **multi-tenant from day one** so it can
be sold as SaaS to other Paraguayan businesses without a rebuild. Factura electrónica
is shown as **"próximamente" (coming soon)** in UI/pricing during Phase 1.

**Added after 1D (owner request):** the first production user is the owner's own network
of Paraguayan lead-gen sites (inmobiliaria, contador, electricista, dentista…), today
funnelling into **GoHighLevel**. Replacing GHL is now an explicit Phase 1 goal: those
sites post leads into VenderCRM and the owner manages every Paraguay lead from one
login. See §5.1 for the architecture and §11 for what GHL still does that this
deliberately won't.

### 1.2 Locked decisions — DO NOT reopen

| Decision | Value |
|---|---|
| Phasing | Phase 1 CRM+WhatsApp MVP → Phase 2 SIFEN e-invoicing → Phase 3 marketing (placeholder only) |
| Billing model | **Prepay only**: quarterly / 6-month / 12-month plans. No monthly. |
| Billing collection (Phase 1) | **Manual**: tenants pay by transfer/cash outside the app; superadmin records payment and sets plan expiry. No payment gateway in Phase 1. |
| WhatsApp API | **Direct Meta Cloud API** (no BSP). Tenants connect their own numbers via Meta **embedded signup**; manual connect as bootstrap fallback (§6.2). |
| Tenancy | Multi-tenant, single app: **superadmin** role manages all tenants; per-tenant logins with fully isolated data. *Amended: a user may hold memberships in several tenants (§3.1), with a role per membership and one active business at a time. Isolation is unchanged — a session acts in exactly one tenant, re-checked per request.* |
| Sites per tenant | **One tenant owns many sites.** The owner's whole lead-gen network is a single tenant with N `sites` rows; leads share one pipeline and carry `site_id` for filtering/attribution. Never one-tenant-per-site (§5.1). |
| Lead ingest | **Server-to-server only**: the site's own backend POSTs to `/api/v1/leads` with `X-Api-Key`. Never from the browser. Hosted form pages stay available for sites with no backend. *Reopened and extended — not weakened — by §5.2: a second, no-secret lane exists for client sites on Elementor/Wix/Webflow/Zapier. `/api/v1/leads` itself is unchanged: still no CORS, still no browser-side key.* |
| Traffic analytics | **Not built in this repo.** Self-host Umami as a separate app; the CRM stores lead-level attribution only. PostHog is ruled out — it needs ClickHouse+Redis+Postgres and can't run on Hostinger managed Node. |
| In-tenant visibility | **Shared pipeline + assignment**: all tenant users see all contacts/deals; deals & conversations assignable to a rep. Roles: tenant `admin`, tenant `agent`. |
| Automations | **Visual flow builder** (node canvas: triggers, conditions, delays, branches) in Phase 1. |
| UI language | **Spanish-only, i18n-ready** (all strings through an i18n layer; `es` is the only shipped locale). |
| Quotes | Non-fiscal quote/estimate documents in Phase 1. No SIFEN dependency. |
| SIFEN (Phase 2) | **In-house engine**, no third-party PSEC dependency. Reference open-source libs/specs (§9). Future extraction into standalone e-invoicing SaaS — keep the boundary clean, don't build the split now. |
| Stack | Next.js 15 (App Router), Drizzle ORM, MySQL 8, Hostinger managed Node.js hosting. |

### 1.3 Model tiering for execution

- **Fable 5**: architecture, schema/spec decisions, gap analysis, review gates. Author
  of this plan.
- **Opus 4.8**: hardest build problems — multi-tenant isolation layer (1B), WhatsApp
  webhook ingestion/reliability pipeline (1D), automation execution engine (1G), and
  the Phase 2 SIFEN engine.
- **Sonnet 5**: everything else — scaffolding, CRM CRUD/UI, forms, inbox UI, flow
  editor UI, quotes, superadmin console, billing ledger, hardening.

Each sub-phase below names its model. A sub-phase is "done" when its **exit criteria**
pass; Fable reviews at the marked **review gates**.

---

## 2. Platform architecture

### 2.1 Deployment shape (constraint-driven)

Hostinger managed Node.js hosting runs **one Node process** per app — no Redis, no
separate worker dynos, no cron guarantees. This drives three decisions:

1. **Single Next.js app** serves everything: tenant app, superadmin console, public
   form/quote pages, and API/webhook routes.
2. **MySQL-backed job queue** (no Redis/BullMQ). A `jobs` table drained by an
   in-process worker started from `instrumentation.ts` (Next.js `register()` hook),
   ticking every ~2s, claiming rows with `SELECT ... FOR UPDATE SKIP LOCKED`
   (MySQL 8 supports this). Jobs have `run_at`, `attempts`, `max_attempts`,
   exponential backoff, and a dead-letter status. Delayed automation steps and
   scheduled sends are just jobs with a future `run_at`.
3. **Object storage adapter** for media/PDFs with two drivers: local disk (bootstrap)
   and S3-compatible (Cloudflare R2 or similar — recommended before onboarding
   external tenants, since Hostinger disk should be treated as non-durable).
   Interface: `storage.put/get/getSignedUrl/delete`. Choose driver via env.

If the platform outgrows this (webhook volume, automation load), the queue worker can
be lifted into a separate Node process pointed at the same MySQL — the code must keep
the worker entry (`src/worker/index.ts`) importable standalone. Do not couple the
worker to Next.js request context.

### 2.2 Repository layout

Single-app repo (no monorepo tooling), but with **module boundaries** that make the
Phase 2 SIFEN extraction cheap:

```
src/
  app/
    (public)/            # marketing/landing (minimal), public forms f/[tenant]/[slug],
                         # public quote view q/[token]
    (auth)/              # login, accept-invite, password reset
    (app)/               # tenant app: dashboard, contacts, pipeline, inbox,
                         # automations, quotes, forms, settings
    (superadmin)/        # superadmin console: tenants, plans, payments, WhatsApp
                         # health, impersonation
    api/
      webhooks/whatsapp/ # Meta webhook (GET verify + POST receive)
      cron/              # Hostinger-pinged fallback tick (secret-guarded)
      ...                # route handlers where server actions don't fit
  modules/               # feature modules — each owns its service layer
    tenancy/  auth/  crm/  calendar/  forms/  inbox/  whatsapp/  automations/
    quotes/  billing/  audit/
    # Phase 2 adds: sifen/ (engine) + invoicing/ (CRM-side integration) — see §9
  db/
    schema/              # drizzle schema, one file per module
    migrations/
    client.ts
  lib/
    queue/  storage/  i18n/  crypto/  ids/  config/
  worker/
    index.ts             # job queue worker (started via instrumentation.ts)
  components/            # shared UI (shadcn/ui based)
messages/es.json         # i18n strings (next-intl)
PLAN.md
```

**Module rule**: route handlers, server actions, and pages contain no business logic —
they validate input (zod), resolve the tenant context, and call module services.
Module services are the only code that touches the DB, always through the tenancy
layer (§3.3). This is what Opus enforces in review, and it's what keeps SIFEN
extractable later.

### 2.3 Core libraries (locked for consistency)

| Concern | Choice |
|---|---|
| UI | Tailwind CSS + shadcn/ui |
| i18n | `next-intl`, single `es` locale, no hardcoded UI strings |
| Auth | **Better Auth** (Drizzle adapter; admin plugin for impersonation) |
| Validation | zod everywhere (env, forms, API, webhook payloads, flow definitions) |
| Flow canvas | React Flow (`@xyflow/react`) |
| Kanban DnD | `@dnd-kit` |
| PDF (quotes) | `@react-pdf/renderer` (pure JS — no headless Chrome on Hostinger) |
| IDs | Application-generated 26-char sortable IDs (`ulid`), `char(26)` PKs, never expose auto-increment |
| Dates/money | Store UTC `DATETIME`; money as integer minor units + currency code (PYG has 0 decimals — store guaraníes as-is; field is `amount` BIGINT + `currency` char(3), default `PYG`) |

---

## 3. Multi-tenancy & auth (the load-bearing wall)

### 3.1 Model

Single database, shared schema, **`tenant_id char(26)` column on every tenant-owned
table**, FK to `tenants`. Composite indexes lead with `tenant_id`. Tenant-scoped
uniqueness is always `(tenant_id, x)` — e.g. one contact per phone per tenant.

Platform-level tables (no `tenant_id`): `tenants`, `users`, `sessions`, `plans`,
`payments`, `jobs`. Two platform tables carry a `tenant_id` column without being
tenant-owned (superadmin-only writes; never accessed through `tenantDb`):
`subscriptions.tenant_id` — the FK tying billing to a tenant, which expiry/lockout
lookups key on — and `audit_log.tenant_id` (nullable, for per-tenant filtering).
`payments` reaches its tenant via `subscription_id`. *(Ruled at the 1B review gate:
§4's schema — `subscriptions` **with** `tenant_id` — is correct; an earlier revision
of this paragraph contradicted it.)*

Users belong to **one or more tenants**, through `tenant_memberships`
(`tenant_id`, `user_id`, `role`, `banned`) — one row per pairing, unique on
(tenant, user). `users.tenant_id` survives as the **active business pointer**:
which tenant the switcher last put that session in, nullable, and never a grant
on its own. `getTenantContext` re-reads the membership on every request and
takes the role from it, so a revoked, deactivated or demoted membership takes
effect on the next click rather than at session expiry, and a forged tenant id
in a cookie matches no row at all.

Role is a property of the **pairing**, not of the person: the same user may be
`admin` at one business and `agent` at another. Deactivation (§13 H4) and seat
limits (§13 H6) live on the membership for the same reason — shutting someone
out of one business must not touch the others, and one shared login must not
burn a seat in every plan.

Adding a person to a business is a **superadmin** action: it is a cross-tenant
write, which is exactly what §3.3 exists to prevent a tenant admin from making.
What a tenant admin keeps is the role of someone already in their own business,
and the power to deactivate or remove them from it.

*(Reopened deliberately. This paragraph previously read "exactly one tenant, no
cross-tenant membership in Phase 1 — simpler and matches the market". The
market turned out to include the operator's own network: one person running
several businesses on the platform had no way to reach the second one, because
`users.email` is globally unique and a second invitation could only fail. See
§1.2's Tenancy row.)*

### 3.2 Roles

| Role | Scope | Powers |
|---|---|---|
| `superadmin` | Platform | Create/suspend tenants, manage plans & payments, impersonate ("ver como"), platform WhatsApp health dashboard. Stored as `users.is_superadmin` flag, `tenant_id = NULL`; additionally `users.role = 'superadmin'` **solely** to key Better Auth's admin-plugin `adminRoles` gate for its own `/api/auth/admin/*` endpoints (ratified at the 1B review gate). App authorization keys off `is_superadmin` only and never trusts `role` alone. |
| `admin` | Tenant | Everything in tenant: users/invites, WhatsApp connection, automations, forms, pipeline config, billing status view. |
| `agent` | Tenant | Work contacts/deals/inbox/quotes (all visible, per locked decision); cannot manage users, WhatsApp connection, or automations. |

Impersonation uses Better Auth's admin plugin; every impersonated action is written to
`audit_log` with both real and effective user.

### 3.3 Isolation enforcement (Opus-owned)

Defense in depth, three layers — all three are mandatory:

1. **Request context**: a single `getTenantContext()` helper resolves
   `{ tenantId, userId, role }` from the session (or impersonation) once per request.
   It is the *only* sanctioned source of `tenantId`. Client-supplied tenant IDs are
   never trusted anywhere.
2. **Scoped data access**: each module exposes services taking `ctx: TenantContext`
   as first argument; a thin `tenantDb(ctx)` wrapper provides query builders that
   auto-inject `eq(table.tenantId, ctx.tenantId)`. Raw `db` import is lint-banned
   outside `src/db`, `src/worker`, and the tenancy module (ESLint `no-restricted-imports`).
3. **Tests as spec**: an isolation test suite creates two tenants and asserts every
   service/route cannot read or mutate across the boundary. This suite is a merge
   gate for every later sub-phase that adds tables.

Jobs carry `tenant_id` in their payload and the worker reconstructs a tenant context
before calling services — background code goes through the same layer.

### 3.4 Secrets at rest

Per-tenant WhatsApp access tokens (and later SIFEN certificates) are encrypted at the
application layer: AES-256-GCM via `lib/crypto`, key from env (`APP_ENCRYPTION_KEY`),
stored as `ciphertext` + `iv` + `tag`. Never logged, never sent to the client.

---

## 4. Data model (Phase 1 schema spec)

Drizzle schema, one file per module. All PKs `char(26)` ULID, all tables get
`created_at`/`updated_at`. `tenant_id` + FK on every table below unless marked
*(platform)*.

**tenancy/billing** *(platform)*
- `tenants` — name, slug, status (`active|suspended|trial`), locale (`es`), timezone (`America/Asuncion`), settings JSON
- `users` — tenant_id (nullable — the *active business* pointer, §3.1), email (globally unique), name, role (`admin|agent|superadmin` — kept in sync with the active membership solely for the Better Auth admin-plugin gate, see §3.2), is_superadmin, Better Auth fields
- `tenant_memberships` — tenant_id, user_id, role (`admin|agent`), banned, ban_reason; unique (tenant_id, user_id). The grant that lets a person act in a business, and the source of truth for their role there (§3.1)
- `invitations` — tenant_id, email, role, token, expires_at
- `plans` — name, duration_months (3|6|12), price (BIGINT PYG), limits JSON (users, WhatsApp numbers, monthly automation runs), is_active, `features` JSON (factura_electronica: "coming_soon")
- `subscriptions` — tenant_id, plan_id, starts_at, expires_at, status (`active|grace|expired`)
- `payments` — subscription_id, amount, currency, method (`transfer|cash|other`), reference, recorded_by (superadmin user), notes

**crm**
- `pipelines` — name, position; `stages` — pipeline_id, name, position, color, `is_won`, `is_lost`
- `contacts` — name, phone (E.164, unique per tenant), email, notes, source, owner_user_id, custom JSON
- `tags` + `contact_tags`
- `deals` — contact_id, pipeline_id, stage_id, title, value (BIGINT, currency), assigned_user_id, position (kanban order), stage_entered_at, closed_at
- `activities` — polymorphic timeline: contact_id, deal_id?, type (`note|call|stage_change|form_submission|quote_sent|system`), payload JSON, user_id?

**forms**
- `forms` — name, slug (unique per tenant), fields JSON (ordered field defs: text/phone/email/select/textarea, required flags), settings (redirect, target pipeline/stage, default tags), is_active
- ~~`form_submissions`~~ — **superseded by `lead_submissions` below** (1E). The hosted-form
  path and the API path produce the same row, so attribution and per-source stats live in
  one place instead of two near-identical tables that every dashboard query would have to
  UNION. Done destructively: nothing is deployed yet, so this is the cheapest moment.

**sites / ingest** *(1E — §5.1)*
- `sites` — name, slug, domain, `api_key_hash` (SHA-256, unique), `api_key_prefix` (for display in the UI), is_active, default_pipeline_id?, default_stage_id?, default_tag_ids JSON, default_owner_user_id?, settings JSON
- `lead_submissions` — site_id? / form_id? (exactly one set), contact_id, deal_id?, payload JSON, utm JSON (source/medium/campaign/term/content + gclid/fbclid), page_url, referrer, ip/user_agent, idempotency_key; unique `(tenant_id, site_id, idempotency_key)`

**whatsapp**
- `wa_accounts` — tenant_id, waba_id, phone_number_id, display_number, verified_name, status, quality_rating, access_token (encrypted), connected_via (`embedded|manual`), webhook_subscribed_at
- `wa_templates` — wa_account_id, name, language, category, status (synced from Meta), components JSON
- `conversations` — wa_account_id, contact_id, assigned_user_id?, status (`open|closed`), last_message_at, last_inbound_at (drives 24h-window logic), unread_count
- `messages` — conversation_id, direction (`in|out`), wa_message_id (unique — idempotency), type (text/image/document/audio/video/template/interactive/reaction/unsupported), body, media_id/storage_key, status (`queued|sent|delivered|read|failed`), error JSON, sent_by_user_id?, automation_run_id?
- `webhook_events` *(platform)* — raw payload JSON, phone_number_id, status (`received|processed|failed`), for replay/debugging; pruned after 30 days

**automations**
- `flows` — name, status (`draft|active|paused`), trigger_type, trigger_config JSON
- `flow_versions` — flow_id, version, graph JSON (nodes/edges), published_at (runs pin to a version; editing creates a new draft version)
- `flow_runs` — flow_id, flow_version_id, contact_id, status (`running|waiting|completed|failed|cancelled`), current_node_id, wait_until?, wait_for (`delay|reply`)?, context JSON, started_by (trigger payload)
- `flow_run_steps` — run_id, node_id, status, result JSON, executed_at (audit/debug trail)

**quotes**
- `products` — name, description, unit_price (BIGINT), currency, is_active (simple catalog; free-text line items also allowed)
- `quotes` — contact_id, deal_id?, number (per-tenant sequence `COT-000123`), status (`draft|sent|accepted|rejected|expired`), currency, subtotal/discount/total, valid_until, notes, public_token, pdf_storage_key
- `quote_items` — quote_id, product_id?, description, qty, unit_price, line_total
- `quote_sequences` — per-tenant counter row (incremented in a transaction)

**infra** *(platform)*
- `jobs` — type, payload JSON, tenant_id?, run_at, status (`pending|running|done|failed|dead`), attempts, locked_at/locked_by, last_error
- `audit_log` — tenant_id?, actor_user_id, impersonator_user_id?, action, entity, entity_id, payload JSON

Schema notes for Phase 2 compatibility: `quotes`/`quote_items` stay **separate** from
future `invoices` tables (fiscal docs have different immutability/numbering rules);
a Phase 2 invoice can reference a quote. `contacts.custom` JSON will later hold RUC
for invoicing — Phase 2 adds a proper `ruc` column, don't pre-add it.

---

## 5. CRM core behavior

- **Kanban**: per-pipeline board, drag deals between stages (`@dnd-kit`), stage change
  writes an `activities` row and emits an internal `deal.stage_changed` event
  (automation trigger). Multiple pipelines per tenant; a default pipeline seeded at
  tenant creation.
- **Contacts**: list with search/filter (tag, owner, source), detail view with unified
  timeline (activities + WhatsApp messages + form submissions + quotes). Phone is the
  primary identity key (E.164, normalize `+595` input forms).
- **Forms**: public page at `/f/[tenantSlug]/[formSlug]`, unauthenticated, rate-limited,
  honeypot field. Submission upserts the contact by phone/email, applies default tags,
  optionally creates a deal in a configured stage, emits `form.submitted` (trigger).
- **Events**: a tiny internal event dispatcher (`modules/*/events.ts`) — synchronous
  fan-out that enqueues jobs (e.g. automation trigger evaluation). Not a message bus;
  just a typed function registry. Keeps automations decoupled from CRM code.

### 5.1 Multi-site lead ingest *(added after 1D — the GHL replacement)*

**Tenancy shape (locked, §1.2)**: **one tenant owns many sites.** Every lead lands in
that tenant's shared pipeline carrying a `site_id`. This is what makes "one admin panel
for all Paraguay leads" work in a single pipeline. One-tenant-per-site would force the
owner through superadmin impersonation to see their own leads, which is unusable daily.
Multi-tenant membership (§3.1) does not weaken this and is not a substitute for it: a
network of sites is still **one** tenant, and switching businesses is for genuinely
separate businesses, not for sites within one.

**A lead is not a new entity.** An inbound submission upserts a `contact` (by phone) and
optionally opens a `deal`, exactly as the hosted-form path already does. There is no
`leads` table: a lead *is* contact + deal + timeline, and the kanban already runs on
`deals`. A parallel `leads` table would be a second, competing name for the same thing.
What ingest genuinely adds is **attribution** and a **machine-facing entry point**.

**Transport: server-to-server only.** The site's backend POSTs to `/api/v1/leads` with
its key from its own env. Never from the browser — no CORS surface, no key in page
source, no bot floods. Static sites with no backend keep using the hosted form pages at
`/f/[tenantSlug]/[formSlug]`; both paths write the same `lead_submissions` row.

**API contract** (`POST /api/v1/leads`):
- **Auth**: `X-Api-Key` → resolves site + tenant. Keys are stored **hashed** (SHA-256 —
  the key is high-entropy random, not a password, so a slow KDF buys nothing) and shown
  in plaintext exactly once at creation. Rotation = issue new, revoke old.
- **Body** (zod): `phone` (required — phone is contact identity, §5), `name?`, `email?`,
  `message?`, `source?`, `utm_*`, `gclid?`/`fbclid?`, `page_url?`, `referrer?`,
  `idempotency_key` (required).
- **Idempotency**: unique `(tenant_id, site_id, idempotency_key)` — a retried POST
  returns the original result instead of a duplicate contact. Same discipline as the
  WhatsApp `wa_message_id` guard (§6.3).
- **Routing note**: resolving an API key to a tenant is a platform-wide lookup that runs
  *before* any TenantContext exists — structurally identical to the WhatsApp webhook's
  `phone_number_id` routing, and covered by the same lint-exemption rationale (§3.3).
- **Responses**: `201 {contactId, dealId?, submissionId}`; `401` bad key; `403` inactive
  site or non-writable tenant (grace/locked, §10 1C follow-up #1); `422` validation;
  `429` rate limited.
- **Per-site defaults** (target pipeline/stage, tags, owner) are configured *in the CRM*,
  never sent by the caller — a leaked key can't reshape someone's pipeline.

**Attribution**: first-touch UTMs are stamped on the contact at creation and never
overwritten; each submission keeps its own last-touch set. A ~2KB site-side snippet
persists first-touch UTMs in a cookie and attaches them to the form post — the only
client-side code this project ships.

**What each site must add** (three things, none large):
1. A server-side form handler POSTing to `/api/v1/leads` with its key from env.
2. Honeypot field + Cloudflare Turnstile — spam is stopped at the edge, not in the CRM.
3. The UTM cookie snippet.

**Cutover discipline**: point *one* site at VenderCRM and run it in parallel with GHL for
2–3 weeks before migrating the rest. Existing GHL contacts come over as a one-off CSV
import (§12).

### 5.2 A second ingest lane for client sites *(deliberate reopening of §5.1's locked transport)*

**What was locked, and why.** §5.1 fixed lead ingest as *server-to-server only*: the
site's own backend posts to `/api/v1/leads` with a key from its env. That rules out
CORS on the endpoint, a browser-side key, and the bot floods both invite. The lock was
right and it stays: **everything in this section is additive, and `/api/v1/leads` is
byte-for-byte as strict as it was.** No CORS headers were added to it. No public key
was introduced. A credential in page source is precisely what §5.1 exists to prevent.

**Why it was reopened anyway.** The lock quietly assumed every site has a backend the
owner controls. That holds for his own network — hand-written HTML/PHP and Node/Next.js
apps — and those stay on the existing lane unchanged, which is the priority. It does
*not* hold for **client** sites: Elementor, Wix, Webflow, and the Zapier/Make glue
between them cannot hold a server-side secret, and telling a client "add a PHP handler
to your Wix site" is the same as telling them to stay on GHL. §5.1's own fallback —
hosted form pages at `/f/[tenantSlug]/[formSlug]` — only helps a site willing to replace
its form; a client who already has an Elementor form with their own styling and their own
thank-you page will not.

**The shape of the reopening.** Two lanes, one engine:

| | Lane 1 — keyed *(§5.1, unchanged)* | Lane 2 — webhook *(§5.2, new)* |
|---|---|---|
| Who | the owner's own sites | client sites on hosted builders |
| Credential | `X-Api-Key` header, from server env | long random token **in the URL path** |
| Where it runs | the site's backend | Elementor/Wix/Zapier's servers |
| Body | the §5.1 contract, validated by zod | **arbitrary JSON**, resolved by a per-site field mapping |
| Idempotency | caller-supplied `idempotency_key` | derived (site + phone + time bucket) |
| Rate limit | 60/min | tighter — the token travels in a URL and lands in third-party logs |
| CORS | none | none |

Both lanes end in the same `ingestLead()` / `recordLeadSubmission()` write. Lane 2 is a
**translation layer in front of the existing engine, not a second ingest**: per-site
routing (pipeline, stage, owner, tags) still comes from the site record and is never
accepted from the caller, exactly as §5.1 requires. The token is still a secret — it is
simply a *weaker* secret than a header key, which is why it gets its own rate limit, its
own revocation, and its own hash column rather than sharing the API key's.

Delivered as four merged PRs, recorded below in the order they shipped.

#### 5.2.1 Cloudflare Turnstile, per site *(PR 1 — `claude/ingest-turnstile`)*

§5.1 already listed Turnstile as something "each site must add"; it was never built, so
spam defense on the public paths was the honeypot alone (§12 Q8 asked the owner to open a
Cloudflare account for exactly this). Now it exists, and it is **per-site and optional**:
a site with no Turnstile secret saved behaves *exactly* as it did before this PR — same
code path, no extra request, nothing to configure. That was the acceptance bar, since
every existing site is in that state.

- **`lib/turnstile`** verifies a token against Cloudflare's siteverify. Pure: the caller
  passes the secret and, in tests, the `fetch` implementation, so **the unit suite makes
  no network call** — including two cases that assert `fetch` was never called at all
  (missing token, missing secret), which is what keeps a bot flood cheap. Failure is
  always a reason *string*, never a throw: both callers are public entry points that must
  answer the visitor instead of 500. A siteverify outage is a **failure, not a silent
  accept** — the caller decides what an unverifiable token means, and the request is
  bounded by an `AbortController` so a hung Cloudflare can't hang a form submit.
- **Storage**: `sites.settings.turnstile = { siteKey, secret, requireOnIngest }`. The
  site key is public by design (it renders into page source); the **secret is encrypted
  at rest with AES-256-GCM via `lib/crypto` per §3.4**, the same treatment a WhatsApp
  token gets, and is never read back into the browser — the admin field is write-only and
  blank on reload. A secret that stops decrypting (rotated `APP_ENCRYPTION_KEY`) degrades
  to "no Turnstile" rather than taking a site's lead capture down with it. It lives in the
  existing `settings` JSON rather than new columns for the reason `TenantSettings` does:
  configuration, not data, and no migration.
- **Hosted form pages** render the widget next to the existing honeypot and verify before
  any contact is written. A hosted form has no site of its own, so `FormSettings`
  gained `turnstileSiteId` — *which site's credentials this form borrows*. Deliberately
  **not** the submission's `site_id`: attribution still says the lead came through a
  hosted form, not through that site's backend. This link is credentials, not provenance.
- **Ingest path**: `turnstile_token` is an optional body field — **available, not
  mandatory**. Three states, in order: no secret configured → skipped entirely; configured
  and a token present → verified, and a bad one is a 403 rather than a quietly accepted
  lead; configured with no token → accepted unless the site ticked `requireOnIngest`. The
  keyed lane already proves who is calling; the challenge is depth on top of that, not the
  auth itself. Enforcement is a site setting, never a caller-supplied flag.
- **UI**: a collapsed panel per site on `/sites`, plus a per-form site picker on `/forms`
  that only offers sites which actually have credentials saved. Spanish copy in
  `messages/es.json`; the save action is `useActionState`-shaped per §10 1R #6 with the
  secret excluded from the echoed values (§3.4 — `values` is serialized to the browser),
  and no HTML `required` on any server-validated field.

**Verified**: `lib/turnstile/index.test.ts` (11 cases: accept, exact siteverify field
encoding with and without `remoteip`, both no-network short circuits, Cloudflare error
codes surfaced, code-less rejection, non-2xx, network error, timeout via a fetch that
never resolves, and a malformed JSON body that must not read as success);
`modules/sites/settings.test.ts` (the additive default on an unconfigured and a
null-settings site, the AES round trip with an assertion that the plaintext secret does
not appear in the stored JSON, and the undecryptable-secret degradation). Lint, typecheck
and the full suite pass in CI, which runs the DB-backed suites against MySQL.

#### 5.2.2 Two active keys per site, so rotation has no outage *(PR 2 — `claude/ingest-key-rotation`)*

§5.1 said "rotation = issue new, revoke old", and the single `sites.api_key_hash` column
made that a **cutover, not a rotation**: `rotateApiKey` overwrote the hash, so the old key
died the instant the new one was minted and the site kept posting with a key the CRM had
already forgotten — 401s for every lead until someone SSH'd in and redeployed. The window
is small in theory and unbounded in practice, and every lead lost inside it is gone
silently. With client sites (§5.2's whole point) it is worse: the owner does not control
when a client redeploys.

- **`site_api_keys`** is a new table, one row per key: hash, prefix, optional label,
  `last_used_at`, `revoked_at`. The two columns on `sites` are gone. **Up to two live keys
  per site** — enough for a rotation, few enough that "which keys are live" has a
  glanceable answer; a third mostly means a key nobody remembers issuing is still
  accepted. Revocation is a timestamp, not a delete, so which key was live when a lead
  arrived survives the rotation.
- **Migration `0012` backfills before it drops.** The generated SQL was hand-edited to
  insert every existing site's key into the new table *between* the `CREATE TABLE` and the
  `DROP COLUMN`s, so no already-deployed handler loses its key. The backfilled row reuses
  the site's own ULID as its id — ids only need to be unique within `site_api_keys`, there
  is exactly one row per site at that moment, and a deterministic value keeps the
  migration re-runnable against a restored dump.
- **`last_used_at` is the point of the feature, not decoration.** It is what lets the admin
  *see* the site cut over before switching the old key off — revoking blind is exactly
  what the old model forced. Written on the ingest path, **throttled to one write a
  minute** per key so a busy site doesn't turn every lead into two writes, and
  **best-effort**: a failed bookkeeping write is swallowed rather than costing the tenant
  a lead. One minute of staleness is far finer than the human question it answers.
- Keys stay **SHA-256 hashed and shown in plaintext exactly once** (§5.1) — the reveal path
  is unchanged. Resolution still runs before any TenantContext exists (§3.3's documented
  pre-context exemption, same as the WhatsApp webhook); it is now two indexed reads (key
  hash → site) instead of one, and only unrevoked keys resolve.
- **UI**: `/sites` lists each live key with its prefix, label and last-used timestamp,
  issues a second one, and revokes either. The **last live key has no revoke button** —
  revoking it would leave the site unable to post at all, the outage this PR exists to
  prevent. Spanish copy in `messages/es.json`, including the connection guide's rotation
  step, which described the old overwrite behavior.

**Verified**: the `modules/sites` suite gained four cases — both keys accepted
mid-rotation and only the revoked one dying afterwards (the assertion pair the old model
made impossible); a third key refused with `tooManyKeys` and the slot freeing on revoke;
`last_used_at` set on the key that actually posted and still null on the one that didn't;
and cross-tenant isolation, where tenant B can neither list nor revoke tenant A's keys
(§3.3 layer 3). Lint, typecheck, build and the full suite green in CI against MySQL.

#### 5.2.3 Inbound webhook receiver with per-site field mapping *(PR 3 — `claude/ingest-webhook-receiver`)*

The load-bearing piece: `POST /api/v1/hooks/[token]`, the lane a client site on
Elementor, Wix, Webflow or Zapier/Make can actually use. It is a **translation layer in
front of the existing engine, not a second ingest** — it resolves a token to a site, maps
an arbitrary payload onto the CRM's fields, and calls the same `ingestLeadForSite()` the
keyed lane calls. Per-site routing (pipeline, stage, owner, tags) is read from the site
record there, so §5.1's "a leaked credential can't reshape someone's pipeline" holds on
both lanes with one implementation, not two.

- **Credential**: a long random per-site token in the URL path, SHA-256 hashed at rest and
  shown in full exactly once (§5.1), **distinct from the API keys and revoked
  independently** — nulling `sites.hook_token_hash` kills the webhook without touching the
  keys the owner's own sites run on. Resolution is the same pre-TenantContext platform
  lookup as the API key and the WhatsApp webhook (§3.3's documented exemption). An unknown
  token answers **404, not 401**: from a path segment that is all the caller can tell
  anyway. Still no CORS — the caller is the builder's server, never a visitor's browser.
- **Arbitrary JSON, resolved by a per-site mapping.** `lib/object-path` walks dot/bracket
  paths — `fields.telefono.value`, `data.submissions[2].fieldValue`, `a["x.y"]` — written
  by hand rather than pulled in as a dependency: the grammar is keys, dots and brackets,
  the failure mode we need is `undefined` instead of a throw (a mistyped mapping must
  produce "phone not found", not a 500), and a lodash-style `get` brings prototype-walk
  semantics we would then have to defend against. It refuses `__proto__`/`constructor`
  outright, since the *payload* is attacker-controlled.
- **Nothing is lost**: the entire payload is stored on the submission's `fields`, so a
  question the mapping doesn't name yet is still on the timeline.
- **Idempotency is derived**, because callers on this lane cannot send one — Elementor has
  no such field: `sha256(siteId + digits-only phone + 10-minute bucket)`. Stated plainly,
  the trade-off is that a genuinely new enquiry from the same number inside ten minutes
  collapses into the first lead, while a double-submit, a Zapier retry or a Make re-run
  does too. The second case is frequent and costs a duplicate contact *and* a duplicate
  deal in the kanban; the first is rare and costs one extra row on a timeline that already
  has the contact. Digits-only means `0981 123-456` and `0981123456` dedupe against each
  other; the site id in the hash means one client's submissions can never dedupe against
  another's.
- **Tighter rate limit**: 20/min versus the keyed lane's 60, in its own bucket so a noisy
  webhook can't spend the site's own backend's budget. The token travels in a URL and
  therefore ends up in third-party request logs, browser history and support tickets in a
  way a header key never does.
- **Capture mode is part of the feature, not a nicety.** While a site has no mapping, the
  receiver stores the raw payload (newest 5 kept) and answers **202** — not an error: the
  client's webhook *is* configured correctly, and an error would have them "fixing" a
  working setup. The admin then picks each CRM field from a list built out of their own
  test submission, showing `fields.nombre.value · Ana Giménez` rather than asking anyone
  to type a JSON path from memory. A free-text path box remains for a field the test
  submission left blank. Captured payloads are not leads: nothing is written to the CRM
  until a mapping exists.
- **Content types**: JSON, plus form-encoded/multipart flattened to a flat object, because
  Elementor's Webhook action and several Make scenarios post form data. The mapping then
  sees one shape regardless of how the builder sends it.

**Verified**: `lib/object-path/index.test.ts` (11 pure cases — parsing, array indexes,
quoted keys, every missing-value shape returning `undefined` rather than throwing,
prototype-walk refusal, falsy-vs-missing leaves, and a round trip proving every path the
UI offers resolves back to the value it previewed, plus bounds on deep/wide payloads).
`modules/sites/hooks.test.ts` runs the whole lane against MySQL using the shapes these
builders really send — **Elementor Pro** (`fields.telefono.value`, spaces and dashes
normalized to `+595981123456`), **Wix Automations** (`data.submissions[1].fieldValue`),
**Zapier** (nested contact object + answers array) and a **generic flat form builder** —
and covers capture mode writing no lead, the capture cap, 404 on an unknown token, 422 on
a mapping whose phone path finds nothing, the derived-key duplicate collapse (including
same-phone-different-format and next-bucket), an inactive site, revocation leaving the
API keys working, the tighter rate limit, and cross-tenant isolation (§3.3 layer 3).

#### 5.2.4 Per-site ingest health *(PR 4 — `claude/ingest-health`)*

The failure this closes: a client site's integration breaks **on their server**, so the
CRM's only symptom is silence — and "a quiet week" and "the form has been 422ing since
Tuesday" look identical from the pipeline. Today the owner finds out days later, from a
customer. With the webhook lane (§5.2.3) it gets worse, because the client can rename a
form field at any time and nothing in the CRM notices.

- **`site_ingest_health`**, one row per site, upserted on every ingest attempt on **both**
  lanes: last success (with which lane), last error (status + short reason + lane), and
  running success/error counts. A summary, not a log — a log of every attempt is a table
  nobody reads and a retention problem nobody scheduled.
- **No payloads, no credentials.** The stored reason is a short stable code —
  `phone-missing`, `turnstile-failed`, `rate-limited` — mapped from the failure by
  `classifyIngestError`, never the underlying message. That message can carry zod field
  paths and Cloudflare error strings; the column is rendered in the UI, so it gets a code
  the UI translates to Spanish through next-intl and nothing else.
- **Recorded around the shared engine**, so one call site covers both lanes and no failure
  path can forget — plus one explicit call in the webhook receiver for the 422 that is
  decided before the engine runs (the mapping no longer matching the payload, which is the
  single most valuable broken-client signal). Every health write is **best-effort and
  swallowed on failure**: bookkeeping must never be able to fail an ingest.
- **The status is "did the last attempt work"**, not "have there ever been errors": a bot
  that tripped a 422 last month must not paint a working site red, and a site that
  recovers goes back to green with nobody clearing anything. That judgement reads an
  explicit `last_outcome` column — **the first implementation compared `last_error_at`
  against `last_success_at`, and CI caught it**: those are second-precision `datetime`s, so
  a failure landing in the same second as the preceding success compares *equal* and the
  site rendered green while broken. Exactly the silence this section exists to end, so the
  ambiguity was removed rather than papered over with fractional seconds.
- Surfaced on `/sites` as a per-site line — green with the last lead's timestamp, red with
  the status, the translated reason and when it happened, grey for a site that has never
  received anything.

**Verified**: `modules/sites/health.test.ts` pins the two pure decisions — the failure→code
mapping (including that a message containing submitted data never survives into the stored
reason) and the last-attempt-wins status rule, including recovery and a regression case for
the same-second collision above. The DB-backed suites add
the end-to-end shape on both lanes: on the keyed lane a success then a 422, with counts and
`lastSuccessLane` and an assertion that the site's API key does not appear anywhere in the
health row; on the webhook lane a success, then a client renaming the field (`phone-missing`,
status failing), with the submitted phone number and the token both absent from the row, then
recovery flipping it back to green on its own.

#### 5.2.5 Ingest alerts, and a connection guide for the second lane *(PR 5 — `claude/ingest-alerts`)*

§5.2.4 recorded per-site health and put it on `/sites`. That is a page the owner opens
*once he already suspects something* — which is the wrong half of the problem: the failure
being fixed is "he finds out days later, from a customer". A status column shortens the
investigation; it doesn't start it. So the signal now leaves the app on its own.

- **`/api/cron/ingest-alerts`**, daily, same shape and secret as the existing
  `subscription-warnings` entry (documented in `docs/DEPLOY.md`). Emails every tenant admin
  when a site's **last** attempt failed, or when a site that *used to* produce leads has
  been silent for 3+ days. Daily rather than hourly on purpose: the thing being detected is
  "broken since Tuesday", and a client's broken form is not fixed faster by hearing about
  it four times an hour.
- **Staleness is its own alert**, because the worst version of this failure produces no
  errors at all — the client removes the webhook action, or repoints the form, and the CRM
  simply never hears from them again. Three days, not one: lead flow here has a weekly
  rhythm and plenty of these sites are quiet over a weekend without anything being wrong.
- **Notify on the transition, not every morning.** `site_ingest_health` gained
  `alerted_for` / `alerted_at` — what was *sent*, kept deliberately separate from
  `last_outcome`, which is what *happened*. A recovered site clears the flag so the next
  breakage alerts again. Silence is also correct for two cases: a **deactivated** site (the
  owner paused it; alerting about it teaches him to ignore alerts) and a site that has
  **never** received anything (that's unfinished, not broken, and already reads "sin datos"
  on `/sites`). A quiet site that then hard-fails *does* escalate — that's new information.
- **Same two rules as §5.2.4**: the mail names the site, the status, the translated reason
  and when it happened — no payloads, no keys, no tokens. And the alert path is a cron, so
  it can never cost a lead.
- **A connection guide for lane 2.** The existing `SiteGuide` documents lane 1 only — a
  server-side handler with the key in env, exactly what a client on Elementor or Wix cannot
  do. The new guide is click-by-click per platform (Elementor / Wix / Zapier-Make /
  manual), in Spanish, written for the owner sitting with a client's site open or the
  client following along over WhatsApp: the only technical step is pasting a URL the CRM
  generated. It leads with the test submission, because capture mode is what makes the rest
  work, and states plainly that the webhook URL is itself the credential.

**Verified**: `modules/sites/alerts.test.ts` — 12 pure cases over the decision, with no
database and no clock. **One of them caught a real defect before it shipped**: the first
`shouldClearAlert` asked "does this site alert right now?", which is always false for a site
already flagged, so a *still-silent* site had its flag cleared and would have re-alerted
every single day — precisely the noise `alerted_for` exists to prevent. It now asks "would
this alert if we had never told him?". The rest pin the dedupe, the recovery re-arm, the
deactivated and never-used silences, the weekend tolerance, and the quiet→failing
escalation. `i18n/messages.test.ts` now flattens arrays too, so every step string in the new
guide is still covered by the empty-copy / spec-leak / ICU guards. Lint, typecheck, build
and the full suite green in CI against MySQL.

---

## 6. WhatsApp integration (Opus-owned pipeline)

### 6.1 Meta setup (owner action, not code)

One Meta developer **app** owned by the platform. Prereqs to schedule early because
they're calendar-bound, not code-bound: Meta Business verification → advanced access
for `whatsapp_business_management` + `whatsapp_business_messaging` → **Tech Provider
onboarding for embedded signup**. Weeks of lead time; the build does not block on it
thanks to the manual-connect fallback.

### 6.2 Tenant connection — two paths, one table

1. **Manual connect (build first, bootstrap path)**: tenant admin (or superadmin)
   enters WABA ID, phone number ID, and a system-user access token generated in Meta
   Business Manager. Enough for the owner's own team on day one.
2. **Embedded signup (build second, SaaS path)**: Meta's JS flow → exchange code for
   token server-side → store token + WABA/phone IDs, subscribe the app to the WABA's
   webhooks. Same `wa_accounts` row either way; `connected_via` records the path.

### 6.3 Webhook ingestion (reliability-critical)

`POST /api/webhooks/whatsapp` — one endpoint for the whole platform; Meta sends all
tenants' traffic here, routed by `phone_number_id`.

Rules (Opus implements exactly this):
1. Verify `X-Hub-Signature-256` (app secret HMAC) — reject on mismatch.
2. **Persist raw event to `webhook_events` + enqueue a processing job + return 200 —
   fast, no business logic in the handler.** Meta retries on non-200/slow responses
   and eventually *pauses the subscription* on persistent failure; ack-fast is
   non-negotiable.
3. Processing job: route `phone_number_id` → `wa_accounts` → tenant; upsert contact by
   phone; upsert conversation; insert message with **unique index on `wa_message_id`
   as the idempotency guard** (Meta redelivers; duplicates must be no-ops); update
   `last_inbound_at`; download media via Meta media API (URLs expire — fetch
   immediately, store via storage adapter); emit `wa.message_received` (automation
   trigger); handle `statuses` events (sent/delivered/read/failed → update `messages.status`).
4. Unknown `phone_number_id` or unparseable payload → mark event `failed`, keep raw
   payload, alert in superadmin health view. Never crash the route.

### 6.4 Sending

`whatsapp/send.ts` service, all outbound goes through it (inbox UI, automations,
quote sending):
- **24-hour window check**: if `now - last_inbound_at < 24h` → free-form allowed;
  otherwise **template messages only** — the service enforces this, callers don't.
- Sends are jobs (queue) → Graph API call → store `wa_message_id`, status `sent` or
  `failed` with error payload. Retry on 5xx/429 with backoff; respect per-number
  throughput conservatively (serialize sends per `wa_account`).
- Template sync: fetch templates from Meta on connect + manual "sync" button +
  nightly job; automations and inbox pick from synced, `APPROVED` templates only.

### 6.5 Unified inbox

- Conversation list (filter: open/mine/unassigned), chat pane with message history,
  media rendering, template picker when outside the 24h window (with window countdown
  shown), assignment dropdown, "convert to deal" shortcut, contact side-panel.
- Realtime: **polling every 5s** on the active view (SWR revalidation). No websockets
  in Phase 1 — Hostinger single-process + this team size doesn't justify it. The data
  layer doesn't care; SSE/WS can replace polling later without schema change.

---

## 7. Automations — visual flow builder

### 7.1 Editor (Sonnet)

React Flow canvas. A flow = one trigger node + a DAG of steps. Node palette (Phase 1):

- **Triggers** (exactly one per flow): inbound WhatsApp message (optional keyword
  match), form submitted (pick form), deal stage changed (pick pipeline/stage),
  contact created, tag added.
- **Conditions**: contact field / tag check, deal stage check, business-hours check
  (tenant timezone), has-responded-since check. Two-branch (yes/no) nodes.
- **Actions**: send WhatsApp message (free-form if window open) / send template (with
  variable mapping from contact/deal fields), add/remove tag, move deal stage, assign
  user (specific or round-robin), create activity/note, notify a user (in-app).
- **Delays**: wait fixed duration; **wait for reply** (with timeout branch — the
  "no reply after 2 days → follow up" pattern this product is sold on).

Graph JSON is zod-validated on save (single trigger, no orphan nodes, no cycles,
template variables resolvable). Publishing creates an immutable `flow_versions` row.

### 7.2 Execution engine (Opus)

An **interpreter over the stored graph with durable state** — no in-memory workflow
runtime, everything resumable from `flow_runs`:

- Trigger events (from the internal dispatcher, §5) enqueue `automation.trigger` jobs;
  the handler matches active flows, applies guards, creates a `flow_run` pinned to the
  published version.
- Step loop: execute current node → write `flow_run_steps` → advance edge. Delay nodes
  set `status=waiting, wait_until=X` and schedule a resume job. Wait-for-reply nodes
  set `wait_for=reply`; the inbound-message processor checks for waiting runs on that
  contact and resumes them (timeout job takes the timeout branch if it fires first —
  resolve the race by compare-and-set on `flow_runs.status`).
- **Guards** (hard rules): max one running run per (flow, contact); configurable
  "stop flow when contact replies" flag; global opt-out — contact tagged `optout`
  (auto-applied on inbound *BAJA*/*STOP*) is skipped by every send action; per-tenant
  automation-runs cap from plan limits; max 100 steps per run (cycle safety net).
- Every automated send is a `messages` row with `automation_run_id` — visible in the
  inbox like any other message.
- Monitoring UI: runs list per flow (status, contact, current node, errors), manual
  cancel, simple per-flow counters.

---

## 8. Quotes (presupuestos)

- Builder: pick contact (+ optional deal), add lines from `products` or free text,
  qty × unit price, optional discount, `valid_until`, notes. PYG default; USD allowed
  per quote (no FX logic — the entered currency is the currency).
- Per-tenant sequential numbering (`COT-000123`) via `quote_sequences` in a transaction.
- Output: PDF via `@react-pdf/renderer` with tenant branding (logo, colors, contact
  info from tenant settings), stored via storage adapter.
- Delivery: **send as WhatsApp document** through the standard send service (+ public
  read-only link `/q/[token]` as fallback/preview). Sending flips status to `sent`
  and writes a `quote_sent` activity; accepted/rejected set manually by the rep in
  Phase 1 (no client-side accept button yet — keep it small).
- The `factura electrónica` nav item exists, disabled, labeled **"Próximamente"**.

---

## 9. Phase 2 — SIFEN e-invoicing (spec placeholder, ~1 month out)

Fable will author a dedicated `PLAN-SIFEN.md` when Phase 2 starts. Architecture
commitments made **now** so Phase 1 doesn't paint us in:

- **Boundary**: engine lives in `src/modules/sifen/` with a hard rule — it imports
  nothing from other modules; it exposes a typed facade (`generateDE`, `signDE`,
  `submit`, `queryStatus`, `generateKuDE`, event ops) and owns its own tables
  (`sifen_*` prefix). CRM-side integration (invoice UI, quote→invoice conversion)
  lives in a separate `modules/invoicing/` that *calls* the facade. This is the
  future extraction seam for the standalone e-invoicing SaaS — extraction later means
  lifting `sifen/` + its tables behind an HTTP API, not surgery.
- **Scope preview**: DE XML generation per SIFEN/e-Kuatia spec, XMLDSig signing with
  per-tenant certificates (encrypted at rest via §3.4), SOAP submission (sync + batch),
  KuDE PDF + QR, document events (cancelación, inutilización), timbrado & numbering
  ranges, test-environment (habilitación) workflow, contingency queue for SIFEN
  downtime (the §2.1 job queue already gives us durable retry).
- **References**: open-source `facturacionelectronicapy-*` libraries (xmlgen, xmlsign,
  setapi) and SET/DNIT technical documentation as spec references; commercial
  providers (FacturaSend, Sifende, BillPy) studied for API-shape comparison only —
  no runtime dependency on any of them.
- **Owner**: Opus 4.8 builds, Fable specs and reviews.

#### S1 — SIFEN foundation *(Opus 5)* — ✅ done

The first Phase 2 code. Deliberately scoped to the layer that is **verifiable
without the Manual Técnico**, so that no fiscal field is guessed:

- `modules/sifen/dv.ts` — módulo 11 check digit, shared by the RUC and the CDC.
  Pinned in tests by the SET reference implementation's own published vector
  (`3535123` → `3`), because the algorithm has several plausible-looking
  variants (left-to-right weighting, remainder 1 → 10, an unbounded weight
  cycle) that each produce digits SIFEN rejects.
- `modules/sifen/cdc.ts` — the 44-digit CDC: compose, parse, verify. The
  11-field layout is stated once in `CDC_FIELDS`, and both compose and parse
  derive their widths and offsets from it, so the two can't drift. Overflow is
  an error rather than a truncation (a truncated establecimiento files a
  document against the wrong shop), the RUC check digit is verified before a
  CDC is built around it, and the security code comes from a CSPRNG.
- `modules/sifen/codes.ts` — only the three code tables the CDC itself needs
  (`iTiDE`, `iTipCont`, `iTipEmi`). The rest of SIFEN's tables are **not**
  guessed here; they go in with the DE generator.
- `modules/sifen/index.ts` — the §9 facade. `generateDE`, `signDE`, `submit`,
  `queryStatus`, `generateKuDE` and `submitEvent` are declared with their real
  signatures and throw `SifenNotImplementedError` naming what they're blocked
  on. Declared rather than omitted so the seam's shape is fixed now, while
  moving it is cheap.
- `modules/sifen/boundary.test.ts` — §9's "imports nothing from other modules"
  rule, **enforced rather than documented**, and extended to `@/db`, `@/lib`,
  `@/components`: anything that wouldn't survive extraction behind an HTTP API
  arrives as a function argument instead. Verified by temporarily introducing
  a violation and confirming the test fails.

No tables, no migration, no CRM wiring — `modules/invoicing/` does not exist
yet, and nothing in the app calls this module.

**🔍 Blocked on Fable: `PLAN-SIFEN.md` does not exist.** §9 says Fable authors
it "when Phase 2 starts" — Phase 2 has now started. Everything past this
foundation needs it first, and two questions in particular are architecture
rather than fiscal detail, so they belong to Fable and not to a build model:

1. **How does the engine reach its own tables without importing `tenancy`?**
   §9 says `sifen/` owns `sifen_*` tables *and* imports nothing from other
   modules, but `tenantDb` (§3.3) lives in `modules/tenancy` and raw `db` is
   lint-banned outside it. S1 sidestepped this by staying pure. The likely
   answer is an injected persistence port owned by `modules/invoicing/` — which
   is also exactly where the future HTTP boundary falls — but that is a seam
   decision, not an implementation detail.
2. **Timbrado & numbering ranges.** Per-tenant allocation of
   establecimiento/punto/número has the same transactional shape as
   `quote_sequences`, but different rules: a range expires, can be exhausted,
   and a burned number must be reported as *inutilizado* rather than silently
   skipped. The state machine wants specifying before it's built.

Two further notes for whoever writes it: the DE field spec could not be read
from here — `sifende.com.py` and the SET/DNIT manual mirrors are blocked by
this environment's egress proxy, so PLAN-SIFEN.md should either quote the
Manual Técnico directly or be authored where it can be fetched. And the
existing `documents` tables carry a boundary comment forbidding fiscal fields
on them (`schema/documents.ts`); Phase 2 must honor it — a factura is a new
table, never a status on a nota de venta.

## Phase 3 — marketing features (placeholder only)

Website builder, Google Business Profile, social automation, ad tools — likely sold
as manual services or routed through existing external tools, probably not built in
this repo. **No Phase 1/2 architecture anticipates this**; nothing blocks it either
(tenancy, auth, and the module pattern are reusable if any of it lands here).

**Exception now specced:** the apex-domain marketing site for clientes.com.py IS
built in this repo (it already serves the apex via the host check in
`src/app/page.tsx`). Full plan, locked decisions, and build sequence:
[`docs/MARKETING_SITE_PLAN.md`](docs/MARKETING_SITE_PLAN.md).

---

## 10. Phase 1 build sequence

Sub-phases are ordered so the app is **internally usable as early as possible**
(quotes before the flow builder — the sales team needs CRM + inbox + quotes to work;
automations are the layer on top).

### 1A — Foundation *(Sonnet, ~2 sessions)*
Next.js 15 scaffold, Tailwind + shadcn/ui, next-intl (`es`), Drizzle + MySQL + migration
workflow, zod-validated env config, `lib/` primitives (ids, crypto, storage adapter
with local driver), **job queue + worker + instrumentation hook**, ESLint rules incl.
the raw-`db` import ban, CI (lint, typecheck, test).
**Exit**: queue processes a test job with retry/backoff; CI green.

### 1B — Auth, tenancy & superadmin *(Opus, ~3 sessions)* — 🔍 Fable review gate
Better Auth + Drizzle, tenants/users/invitations, roles (§3.2), `getTenantContext` +
`tenantDb` scoped access layer, impersonation + audit log, superadmin console (tenant
CRUD, suspend, plans, **manual payments ledger + subscription expiry**), tenant
suspension/expiry middleware (grace → read-only banner → locked; **grace period =
7 days** after expiry, ratified at the 1B review gate — a constant in
`modules/tenancy/subscriptions.ts`, promoted to plan-limit/env config only if a
real need appears), **cross-tenant isolation test suite**.
**Exit**: isolation suite green; superadmin can create a tenant, record a payment,
impersonate; expired tenant is locked out.

### 1C — CRM core *(Sonnet, ~4 sessions)*
Contacts CRUD + tags + search/filter, pipelines/stages config, kanban board with DnD +
deal CRUD + assignment, activity timeline, internal event dispatcher, form builder +
public form pages + submission→contact/deal wiring, tenant settings (branding, business
hours, timezone).

**1B review-gate follow-ups (land within 1C, before its exit):**
1. **Grace-state write enforcement** (deferred from 1B, which shipped no tenant-owned
   mutations): one service-layer guard — e.g. `assertTenantWritable(ctx)`, or an
   `accessStatus` resolved into `TenantContext` — called by **every** mutating tenant
   service, so grace tenants are read-only at the write path, not just the banner.
   Test-covered (a grace tenant's mutation is rejected server-side).
2. **Close the open public sign-up**: Better Auth's `/api/auth/sign-up/email` is
   currently unrestricted — anyone can create an orphan account, and squatting an
   invited email blocks that invitation from ever being accepted. Restrict sign-up
   (e.g. a Better Auth `before` hook on the sign-up path) to emails holding a valid,
   unexpired, unaccepted invitation; keep the accept-invite flow green and document
   the superadmin bootstrap path (script/manual). Test: sign-up with a non-invited
   email returns 4xx; invite acceptance still passes.

**Exit**: full lead lifecycle by hand — form submission → contact → deal moves across
kanban → timeline shows history; grace-tenant writes rejected server-side; non-invited
sign-up rejected.

### 1D — WhatsApp integration *(Opus, ~4 sessions)* — 🔍 Fable review gate
`wa_accounts` + manual connect flow, webhook endpoint per §6.3 (signature, ack-fast,
idempotent processing, media persistence), send service per §6.4 (24h window, template
enforcement, retries), template sync, unified inbox UI (Sonnet can take the UI half),
superadmin WhatsApp health view (webhook failures, token errors, quality rating).
Embedded signup implemented behind a flag, activated when Meta Tech Provider approval
lands (calendar-dependent, not blocking).
**Exit**: real Paraguayan number connected manually; inbound/outbound messages flow;
duplicate webhook deliveries are no-ops; kill-and-restart loses no messages.

> **Renumbering note**: 1E–1G below were renumbered to 1F–1H when multi-site lead ingest
> was inserted as the new 1E after 1D shipped. Only not-yet-built phases moved; the
> merged 1A–1D keep their letters, so commit history stays readable.

### 1E — Multi-site lead ingest & attribution *(Sonnet, ~2 sessions)* — **NEW**
`sites` CRUD + API key issue/rotate/revoke (hashed at rest, shown once), public
`POST /api/v1/leads` (key auth, zod, idempotency, per-site defaults, rate limit),
`lead_submissions` unification (folds in `form_submissions`), first-touch attribution on
contacts, per-site lead dashboard (leads by site / source / campaign, stage conversion),
UTM cookie snippet + a copy-paste server-side handler example for the sites. Full detail
in §5.1.
**Exit**: two real sites posting leads into one tenant; a replayed POST with the same
`idempotency_key` is a no-op; leads filterable by site and campaign in the UI; a leaked
key can't write outside its own site's configured pipeline/stage.

**Extended after the fact by §5.2** (four merged PRs): 1E's ingest served the owner's own
sites, whose backends can hold a secret. Client sites on Elementor/Wix/Webflow/Zapier
cannot, so a second lane was added alongside it — Turnstile, two-active-key rotation, a
webhook receiver with per-site field mapping, and per-site ingest health. 1E's own exit
criteria are unchanged and still hold; see §5.2 for what was added and why the §5.1
transport lock was reopened.

> **★ GHL-replacement milestone**: after 1E the owner's Paraguay lead network runs capture
> + WhatsApp follow-up on VenderCRM instead of GoHighLevel. Email, booking and SMS stay
> on whatever handles them today — see §11.

### 1F — Quotes *(Sonnet, ~2 sessions)*
Products catalog, quote builder, per-tenant numbering, PDF render + storage, send via
WhatsApp + public link, statuses + timeline activity, "Factura electrónica —
Próximamente" placeholder in nav/pricing.
**Exit**: quote created → PDF received on WhatsApp → public link renders.

> **★ Internal-tool milestone**: after 1F the owner's team runs daily sales on the
> platform (contacts, kanban, WhatsApp inbox, quotes). Automations (1G) and hardening
> (1H) complete Phase 1 but don't gate internal adoption.

### 1G — Automation flow builder *(Opus engine + Sonnet editor UI, ~5 sessions)* — 🔍 Fable review gate
Schema (flows/versions/runs/steps), React Flow editor with the §7.1 palette, graph
validation + publishing, execution engine per §7.2 (durable runs, delays, wait-for-reply
with timeout race handling, guards, opt-out), trigger wiring to CRM/forms/WhatsApp
events, runs monitoring UI.
**Exit**: the flagship scenario works end-to-end — form submitted → template sent →
wait-for-reply 2 days → timeout branch sends follow-up → reply moves deal stage and
cancels remaining steps; engine survives process restart mid-wait.

### 1H — Hardening & internal launch *(Sonnet, ~2 sessions)*
Seed owner's real tenant, rate limiting on public endpoints, webhook_events pruning
job, error tracking (Sentry or similar), MySQL backup verification, deploy runbook for
Hostinger (env, migrations, process restart), smoke-test checklist, pass through UI
for Spanish copy consistency.
**Exit**: production deploy on Hostinger; owner's team onboarded.

### 1I — Operability: the app can be run without SSH *(added after 1H shipped)*

1A–1H built every feature the product sells, but an audit of the live app found the
*operator* paths missing — the ones that don't appear in any feature list because
they're assumed. The app could not be signed out of, a tenant admin could not add a
teammate, and standing up a tenant required running `scripts/seed-tenant.ts` over SSH.
None of that is a new feature; it's the wiring that makes the existing features
reachable by someone who isn't holding a terminal.

1. **Session shell**: user menu (name, email, role, tenant) + sign out, in both the
   tenant app and the superadmin console. `signOut` had zero callers before this.
2. **Tenant team management** (`/users`, admin-only): list members, invite by email +
   role, copy the invite link, revoke a pending invite. `createInvitation` existed in
   `modules/tenancy` with **no callers** — the accept-invite page was unreachable
   because nothing could produce a token.
3. **Superadmin creates tenant users directly**: name/email/password/role form on the
   tenant detail page, so onboarding a tenant (and its first admin) never needs the
   seed script. The script stays as the platform-bootstrap path.
4. **Site connection guide** (`/sites`): numbered steps with copy-paste handlers for
   the stacks the owner's network actually runs — static HTML + PHP, and Node.js —
   rather than one generic `fetch` example.

**Exit**: a superadmin creates a tenant, creates its admin, that admin invites an
agent, the agent accepts and signs in, and a site is connected end-to-end — all
through the UI, no shell access.

### 1J — CRM surface parity *(the daily-driver gap)* — ✅ done

1I made the app operable; this makes it pleasant to work in all day. The
reference point is GoHighLevel's CRM surface, which the owner's team already
knows — not its marketing/funnel half, which §11 keeps out of scope.

1. ✅ **Contacts table that works like a table** (`modules/crm/contact-list.ts`,
   `contacts/ContactsTable.tsx`): sortable columns (name, phone, created),
   filters (search, tag, source, owner, date range, has-open-deal), pagination,
   and row selection driving **bulk actions** (add tag, assign owner, add to
   pipeline, export selection). CSV export shares the exact same query path as
   the table — sort included — so "exportar" always means "what's on screen",
   verified by requesting the same filtered+sorted URL through both the page
   and `/api/exports/contacts` and diffing the rows.
   Deferred, not built: column visibility toggles. Low value against the
   effort of a persisted per-user preference; revisit only if asked for.
2. ✅ **Conversation tab on the contact** (`contacts/[id]/ConversationThread.tsx`,
   `modules/crm/timeline.ts`): a "Conversación" tab with inline reply honoring
   the same 24h-window rules the inbox enforces, plus an "Actividad" tab
   merging activities, WhatsApp messages, quotes and lead submissions into one
   ordered timeline. Deal/tag/edit moved to a "Datos" tab.
3. ✅ **Tasks / reminders** (`modules/crm/tasks.ts`, migration `0009`): a
   `tasks` table (due-dated, against a contact and optionally a deal), a
   "Tareas" tab on the contact with create/complete/reopen/delete, and a
   "Tareas pendientes" section on the dashboard surfacing anything due now or
   earlier (overdue and due-today are the same query — the date on screen is
   what distinguishes them). Verified live: a task due in the future does not
   appear on the dashboard; the same task backdated does, in red, linking back
   to its contact.
   Deferred, not built: an `ai_reply`-style automation action node that
   creates a task (e.g. "if no reply in 2 days, create a follow-up task").
   The engine change (new `action` kind in `graph.ts` + `engine.ts` + the
   flow editor palette) is real but separable work — natural pickup for
   whoever builds 1O next, since both touch the same files.

**Exit**: a rep can run a full day from Contactos and the contact detail view
without needing another tab. Met.

### 1K — Durable storage *(do before onboarding any external tenant)* — ✅ done
Implemented `src/lib/storage/s3.ts` against the AWS SDK (`@aws-sdk/client-s3` +
`s3-request-presigner`), pointed at Cloudflare R2's S3-compatible endpoint —
free egress is why R2 over S3 itself. `env.ts` requires `S3_ENDPOINT`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (via `superRefine`,
so misconfiguration fails at boot) whenever `STORAGE_DRIVER=s3`; `local`
remains the zero-config default. `docs/DEPLOY.md` has the R2 setup steps.
Not verified against a live R2 bucket (no Cloudflare credentials in this
environment) — verified instead: the driver conforms to `StorageAdapter`,
`local` continues to pass its existing behavior, and the env-validation
rule is unit-tested (missing-vars-rejected / present-vars-accepted).
**Recommend a smoke test against the real bucket right after merge** — put a
key, fetch it back, request a signed URL — before pointing a live tenant's
media at it.
**Exit**: driver switchable by env; local disk still works unmodified. Met,
pending the live-bucket smoke test above.

### 1L — Feedback & polish — ✅ done
Landed as a side effect of 1J: the contacts table and bulk-action bar use
`useTransition`/pending states natively (no full-page reload on filter or bulk
action), and the two new 1M forms (forgot/reset password, invite) use
`useActionState` for inline errors.
**Closed out by 1R #6** (PRs #18 and #19 — see 1R below for what shipped):
- ~~Inline validation (`useActionState`) on the *older* forms this phase didn't
  touch~~ — done for contacts create/edit, pipeline deal create, quotes,
  products, forms, automations, WhatsApp connect and tenant settings. The two
  gaps it left in the quote and document builders are closed too — see 1R #6.
- ~~Superadmin console visual polish~~ — `/tenants` and `/plans` now use the
  same `PageHeader` shell as the tenant app.

**Closed out by 1R #1 and #3**:
- ~~Inbox 5s revalidation (§6.5) — the inbox is still load-once, no
  polling~~ — done; see 1R #3.
- ~~Pipeline switcher for tenants with more than one pipeline (the page
  still hard-picks `pipelines[0]`)~~ — done; see 1R #1.

### 1M — Transactional email — ✅ done
Added `resend` + `src/lib/email` (transport, no-ops with a console warning
when `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are unset — same pattern
next.config.ts already uses for Sentry — so every environment behaves the
same, just without mail actually leaving until configured) and
`src/lib/email/templates.ts` (invitation, password reset, subscription
expiry warning).
- **Password reset**: wired into Better Auth's built-in
  `emailAndPassword.sendResetPassword` — new pages `/forgot-password` and
  `/reset-password`, a link from `/login`. **Verified with a real round
  trip**, not just the UI: requested a reset, read the actual verification
  token out of the database, drove it through Better Auth's own callback
  route, set a new password, and logged in with it successfully.
- **Invitation email**: `users/actions.ts`'s `inviteUserAction` now sends the
  accept-invite link by mail, best-effort — the link is still shown on
  screen regardless of send success, so a misconfigured or down mail
  provider never leaves an admin with no way to reach the invitee. Verified:
  with no Resend key set, the console logs the skip and the on-screen link
  still renders.
- **Subscription expiry warnings**: `modules/tenancy/subscriptions.ts` gained
  `listSubscriptionsCrossingExpiryWarning()` (fires at 7 days and 1 day out,
  checked as exact equality against a daily cron tick rather than a "warned"
  flag column — no migration needed) and a new cron-pinged route
  `/api/cron/subscription-warnings`, same secret-guarded shape as the
  existing `/api/cron/tick`. **Needs a new Hostinger cron entry** — see
  `docs/DEPLOY.md` §5 — it does not share a schedule with the job-queue tick.
**Exit**: self-service onboarding unblocked for invitations and password
reset. Met.

### 1N — Embedded signup *(gated on Meta Tech Provider approval)*
§6.2's second connection path. `connected_via: 'embedded'` exists in the schema but
no flow was ever built — manual connect is the only path today. Required before
tenants can connect their own numbers without the operator handling access tokens by
hand, and therefore before SaaS sale.

### 1O — AI auto-reply *(owner request; provider-neutral by design)* — ✅ done

An LLM drafts or sends WhatsApp replies. The engine already has the hard
parts — §7.1's node graph, the job queue, and the 24h-window rules — so this
is a **new automation action node**, not a new subsystem. Sketch:

- `src/lib/ai/` with a `generateReply(prompt, context)` interface and one
  driver per provider, chosen by env exactly like `lib/storage`. **OpenAI and
  Gemini are the intended drivers** (owner preference; unrelated to which
  model builds this repo). Keep the interface boringly small — a prompt in, a
  string out — so swapping providers is a config change, not a rewrite.
- Tenant settings hold the business context the model needs: what the company
  sells, tone, hours, what it must never promise (prices, delivery dates).
- New node type `ai_reply` with a **draft vs. send** switch. Draft posts a
  suggestion into the conversation for a rep to approve; send delivers it.
  Start every tenant on draft — an LLM inventing a price in Guaraní is a real
  commercial risk, and the trust has to be earned before it goes autonomous.
- Guardrails that matter more than the model choice: never send outside the
  24h window (templates only, and templates are pre-approved by Meta so an
  LLM cannot author them), hard cap on replies per conversation per day, a
  handoff keyword that permanently silences the bot for that contact, and
  every AI message stored with its prompt and model for audit.
- Cost is per-token and per-tenant, so meter it: store token counts on the
  message row, expose a monthly total in settings.

**Exit**: a tenant enables AI replies on one flow, sees drafts for a week,
then switches that flow to autonomous with a per-conversation kill switch.
Met — the mechanism is in place and verified end-to-end; the "for a week"
part is calendar, not code.

**As built** (differences from the sketch above, and the decisions worth
keeping):

- `src/lib/ai/` — `types.ts` (a prompt in, a string out, plus token counts),
  `openai.ts`, `gemini.ts`, `prompt.ts` (pure prompt assembly + the Spanish
  guardrail block), `index.ts` (driver-by-env). Unlike `lib/storage`, which
  always resolves to some adapter, `AI_DRIVER=none` is the default and
  resolves to **null** — AI is opt-in, and an unconfigured deploy must still
  boot and run every other automation. Added `AI_BASE_URL` (not in the
  sketch) for Azure/OpenAI-compatible gateways; it is also what let the
  browser pass exercise the real driver against a stub instead of a billable
  endpoint.
- Migration `0010_add_ai_replies` — an `ai_replies` table (prompt, body,
  provider, model, prompt/completion tokens, status, flow_run_id/node_id,
  approver, error) plus `conversations.ai_disabled_at`. Deliberately separate
  from `messages`: most rows never become a WhatsApp message, and the ones
  that do point at theirs via `message_id`. The row is the audit trail and
  the cost meter at once.
- `modules/ai/` — `config.ts` (safe defaults resolved at *read*, so a tenant
  row written before 1O behaves like a new one), `replies.ts` (persistence,
  the two daily counters, monthly totals, kill switch), `reply.ts` (the
  guarded path everything goes through).
- **The tenant mode is a ceiling, not a default.** A flow node may stay on
  draft while the tenant is autonomous, but no node can send while the tenant
  is on draft — so "start every tenant on draft" is a guarantee, and going
  autonomous is a two-key operation (tenant setting + node setting). A
  hand-edited graph JSON cannot bypass it.
- **The 24h window is enforced three times**: generation is refused outright
  (no tokens spent — a draft nobody could legally send is worthless), again
  at delivery, and finally inside `whatsapp/send.ts`, which throws. Guard
  refusals are `skipped` steps with a reason, never failed runs — the rest of
  the flow must still run.
- Caps count *provider calls*, drafts included, since a draft costs the same
  tokens as a send. Added a per-tenant daily cap alongside the
  per-conversation one from the sketch: cost is per-tenant, and a flow
  triggering on every inbound message would otherwise be bounded only by
  conversation count. Both have hard ceilings the settings form can't exceed.
- Handoff keyword lives next to the `BAJA`/`STOP` opt-out in
  `automations/triggers.ts`, for the same reason: it must work for a customer
  asking for a human whether or not the tenant ever built a flow. It silences
  only the AI — reps keep replying in the same thread.

**Verified live**, not just by unit test: a real HMAC-signed Meta webhook →
trigger → flow run → `ai_reply` node → prompt carrying the tenant's business
context, guardrails and actual conversation history → draft in the inbox with
provider/model/token counts → rep approves → message sent. Also verified in
the browser: the draft offers no approve button once the window has closed
(and `deliverReply` refuses it server-side), the per-conversation kill switch
toggles both ways, an inbound `humano` silences the bot and every subsequent
run skips with `conversation_ai_disabled`, and the settings token meter
counts up.

**Not done, deliberately**: no per-tenant spend cap in currency (tokens are
metered, guaraníes are not — needs per-model pricing that changes under us);
no streaming; no RAG over the tenant's own documents; no AI drafting in the
inbox on demand, only via a flow node.

### 1Q — Non-fiscal documents: notas de venta *(owner request)* — ✅ done, UI shipped in 1R #2

Quotes (1F) stop at "here's what it would cost". Nothing in the app records
that a sale *happened* or that money came in, so the owner's team tracked
both outside the CRM. This adds a second document type for exactly that,
**without** waiting for Phase 2's SIFEN engine.

**The naming decision, and why it is not cosmetic.** In Paraguay a *factura*
is a fiscal document requiring timbrado and SIFEN clearance. A PDF that looks
like one but isn't is not a valid tax document, and a tenant who files it as
one has a real problem. So this ships as a **nota de venta** — a recognized
non-fiscal commercial sales record — never labeled "factura", and both the
PDF and the public page carry an explicit *"Documento no fiscal… no tiene
validez tributaria"* notice on their face. The nav item **"Factura
electrónica — Próximamente"** stays exactly as it is; this does not fulfill
it and must not be presented as if it does.

**SIFEN boundary rule (load-bearing for Phase 2).** `documents` is a
non-fiscal record. Phase 2's fiscal invoices get their own tables per §4/§9
and are **not** a status or a `type` value on this table. A nota de venta may
later be *referenced by* a fiscal invoice (`invoices.document_id`), exactly
as §4 already allows for quotes. Never add `timbrado`, `cdc`, `de_xml`,
establishment/point-of-sale codes, or fiscal numbering ranges here — if a
field only makes sense for a SIFEN document, it belongs in Phase 2's tables.
This is the rule that stops Phase 2 being retrofitted into 1Q's schema.

**As built** (`src/modules/documents/`, migration `0011`):

- `documents` / `document_items` / `document_payments` / `document_sequences`.
- **Immutability is the invariant the module exists to enforce.** A quote is
  an offer and may be edited freely; a nota de venta is the record of an
  agreed sale, and a customer holding the PDF must be able to trust the copy
  in the system says the same thing. `status` is lifecycle only —
  `draft → issued → (void)` — and past `issued` the number, lines and totals
  are frozen at the service layer, not by UI convention.
- **Payment state is derived, never stored.** The sum of `document_payments`
  *is* the amount paid; `paid`/`partial`/`unpaid` and the balance are
  computed. A denormalized paid-amount column on the header is the classic
  source of drift between a ledger and its summary, and this avoids it by
  construction. Overpayment reads as `paid` with a zero balance, never
  `partial` with a negative one.
- **Void requires an empty ledger.** Money that came in has to be accounted
  for; silently detaching it from its document is how a ledger stops
  reconciling. Delete the payments first if they were recorded in error.
  Voiding also stops the public link resolving.
- **Quote → nota de venta copies lines by value**, and takes totals from the
  quote as stored rather than recomputing them, so the document says exactly
  what the customer agreed to even if the arithmetic rules change later.
  Test-covered by mutating the quote underneath and asserting the document
  doesn't move.
- Sending is deliberately **decoupled from issuing**: a WhatsApp hiccup must
  not decide whether a sale is on the books.
- Line math moved to `src/lib/money.ts`, shared with quotes, so a discount
  can't behave one way on a quote and another on the document it becomes.
- Separate `document_sequences` rather than generalizing `quote_sequences`:
  that table is live and numbers documents customers already hold, so
  changing it in place to save one table is a bad trade.

**Done**: schema, migration, module services, PDF renderer, WhatsApp +
public-link delivery, public view `/d/[token]` (+ `/pdf`), unit tests and the
§3.3 cross-tenant isolation suite for the three new tables.

**The Sonnet half — done in 1R #2**: the in-app UI (documents list, builder,
detail with the payment ledger, "convertir presupuesto", nav entry, i18n
strings). See §10 1R #2 for what shipped and how it mirrors the engine's
rules.

### 1R — Daily-driver readiness *(Sonnet; the owner's own dogfooding run)* — 🟡 all six build items done; operator tasks + the owner's dogfooding day still open

The decision driving this phase: **the owner runs his own Paraguayan lead-gen
network (dentista.com.py, tasacion.com.py, pozo.com.py) on VenderCRM before
selling it as SaaS.** That is the §5.1 cutover discipline applied to the whole
product rather than to one site. Everything here is either a wall that blocks
that run or friction that makes it unpleasant; nothing here is new product
surface.

Ordered by what actually blocks the run, not by size:

1. **Pipeline switcher — the one hard blocker.** `pipeline/page.tsx` and
   `forms/page.tsx` both hard-pick `pipelines[0]`. Dental leads, property
   valuations and well drilling are three different sales motions wanting
   three pipelines with different stages, and today only the first is
   reachable. Selection belongs in the URL (`?pipeline=<id>`), not component
   state, so it survives refresh and can be shared. Listed under 1L as a
   nicety; this use case promotes it. — ✅ done.

   **As built.** Both pages read `?pipeline=<id>` and fall back to
   `pipelines[0]` only when the param is absent or stale — the URL is the
   source of truth whenever it names a real pipeline. `pipeline/page.tsx`
   renders the other pipelines as links that set the param; `forms/page.tsx`
   uses a `method="get"` select, since its "target pipeline" choice belongs
   to the create-form section rather than the whole page. **Delta from the
   spec**: nothing in the app could create a second pipeline, so the
   switcher would have had nothing to switch between — added
   `createPipelineWithDefaultStages` and a minimal "nueva pipeline" form on
   the pipeline page to close that gap. Verified live: created 3 pipelines,
   confirmed the switcher persists across reload.
2. **Notas de venta UI** — the Sonnet half of 1Q. The engine is built,
   tested and callable; nothing renders it. List, draft builder, detail with
   the payment ledger, issue/void/send actions, "convertir presupuesto" on a
   quote, nav entry, i18n. The UI must mirror the engine's rules (no editing
   an issued document, no payments on a draft, no voiding with payments) so
   users meet a disabled control rather than a 500. — ✅ done.

   **As built** (`src/app/(app)/documents/`). List, `DocumentBuilder.tsx`
   (shared between create and edit-draft), a detail page with the payment
   ledger, and issue/void/send actions — all wired through
   `src/app/(app)/documents/actions.ts`. The UI enforces the engine's
   invariants by disabling rather than hiding: the draft builder is only
   reachable while `status = draft`, the record-payment form only renders
   once issued, and void is unavailable while `document_payments` has any
   row — a user meets a disabled control, never a 500 from the service
   layer's own guard. "Convertir presupuesto" was added to the quote detail
   page (`quotes/[id]/page.tsx`) rather than the quote list, since converting
   is a decision made while looking at one quote. Nav entry and every string
   in `messages/es.json`; the "Documento no fiscal… no tiene validez
   tributaria" notice from §10 1Q appears on every screen, not just the PDF
   and public page. Verified live against a seeded tenant: created, edited,
   issued and paid a document, confirmed void is blocked with payments
   recorded, and converted a quote into a document end-to-end.
3. **Inbox 5s polling** (§6.5, deferred since 1D). The inbox is load-once,
   and this is where a rep spends the day. Must not clobber a half-typed
   reply or reset scroll on refresh — that is the whole risk. — ✅ done.

   **As built.** Two new session-authenticated JSON routes,
   `/api/inbox/conversations` and `/api/inbox/[id]`, with the inbox list and
   conversation thread converted from load-once server components to client
   components polling them via SWR every 5s. The stated risk is handled at
   the source rather than patched around: the reply textarea's value lives
   in its own React state and is never overwritten by fetched data, and the
   message list only auto-scrolls to the bottom when the rep was already
   there before new messages landed — a rep scrolled up to reread history
   doesn't get yanked back down. Send, template-send, AI-draft
   approve/discard and the AI kill switch all call the existing server
   actions through `useTransition` and force an immediate SWR revalidation
   afterward, so a rep's own action shows up without waiting for the next
   tick. Verified live: typed into the reply box, waited through a full poll
   cycle, confirmed the text survived untouched; toggled the AI kill switch
   and confirmed the round trip.
4. **Phone normalization is hardcoded to Paraguay.** `normalizePhone` maps a
   leading `0` to `+595`, so a Swedish `070-123 45 67` silently becomes a
   Paraguayan number. Harmless while the network is Paraguay-only, and
   corrupting on the first Swedish tenant. Needs a per-site/per-tenant
   default country. Found while writing the client integration guide.
   — ✅ done.

   **As built.** `normalizePhone` moved out to `src/lib/phone.ts` — pure,
   unit-tested without a configured environment, same pattern as
   `lib/money.ts` — and takes a `country` parameter against a small dial-code
   table (PY, AR, BR, SE, US). A number already carrying `+` or `00` is
   unambiguous and unaffected either way; only bare local numbers change
   behavior, and only for a tenant that sets something other than PY.
   `TenantSettings.defaultCountry` (settings JSON, no migration — same
   pattern as the AI and export settings already there) gets a "País por
   defecto" field on `/settings`, threaded through the three places a phone
   number actually gets typed by a human or posted by a site: manual contact
   creation, hosted form submissions, and site lead ingest. Unset behaves
   exactly as before (defaults to PY), so this is additive for every
   existing tenant. **Delta from the spec**: browser-testing this turned up
   an unrelated crash — `/contacts` failed on every render with next-intl's
   `FORMATTING_ERROR` because `t("bulk.selectedCount")` was called without
   the `count` its ICU template requires; the label is meant to be an
   unformatted string the client substitutes into as selection changes, so
   it was swapped to `t.raw(...)`. Fixed in the same PR since it blocked
   verifying this item at all. Verified: unit tests for `normalizePhone`
   (PY default preserved, SE/other countries correct, no double-prefixing),
   and live — set a tenant's default country to Suecia, created a contact
   with a Swedish local-format number, confirmed it stored as `+46…`.
5. **GBP review requests** (1P's first half — build it here). An automation
   action that sends a Google review link over WhatsApp when a deal hits a
   won stage. No Google API, no OAuth, no approval gate: it is a link. Most
   of 1P's value for none of its lead time, and a real differentiator when
   selling to dentists and plumbers. — ✅ done.

   **As built.** A new `send_review_request` flow action node
   (`modules/automations/actions.ts`, `graph.ts`). A tenant already builds
   "when deal hits stage X" from the existing `deal_stage_changed` trigger
   plus a `deal_in_stage` condition (§7.1); this adds the one missing action
   rather than a new trigger/condition pair. It deliberately reuses every
   guard `send_whatsapp` already has — opt-out check, 24h window, and
   skip-not-fail behavior — instead of a parallel implementation, so a
   review request obeys the same rules as any other send. Config is a text
   field supporting `{{contact.name}}` and `{{review_link}}` merge tags, with
   a sensible Spanish default message when left blank.
   `TenantSettings.reviewLink` (settings JSON, no migration, same pattern as
   #4's `defaultCountry`) gets an "Enlace de reseña de Google" field on
   `/settings`. An unconfigured link is a skip, not a failed run — the rest
   of the flow still executes. Verified: an engine test confirms a
   `send_review_request` step completes even with no review link configured,
   and a live pass — set a review link, added the node to a flow on
   `deal_stage_changed`, confirmed the config panel and default-text
   placeholder render with no console errors.
6. **1L leftovers**: `useActionState` inline validation on the older forms
   (contacts, deals, quotes, products, forms, automations, WhatsApp connect,
   settings — the 1M forms are the pattern), and superadmin console polish.
   — ✅ done, across two PRs.

   **What shipped.** PR #18 established the pattern on contacts
   create/edit and the create-deal form; PR #19 carried it across everything
   left: quotes, notas de venta (builder, record-payment, void), products,
   lead-capture forms, automations, WhatsApp connect, every settings form,
   sites (with a duplicate-slug precheck), and the superadmin plans/tenants
   consoles — which also picked up the `PageHeader` shell, closing 1L's
   polish item. The shape, for anything converted later:
   - The action is `(prevState, formData)`, uses `safeParse`, and returns
     state instead of throwing. Copy never lives in the action — it returns
     a message *key* the client resolves through next-intl, so §1.2's
     Spanish-only rule holds in one place.
   - Submitted values are echoed back in that state and fed in as
     `defaultValue`. React resets an uncontrolled form once its action
     resolves, so without the echo a rejected submit hands back a blank
     form. Checkboxes need `defaultChecked` fed the same way — an unticked
     box sends no key at all, so a non-empty `values` is the signal that a
     submit came back.
   - Secrets are excluded from the echo. `values` is serialized to the
     browser, so `connectAccountAction` drops `accessToken` (§3.4) and the
     field has no `defaultValue` — a token is worth retyping.
   - No HTML `required`, `type="email"`, `type="url"` or `type="number"` on
     a server-validated field: the browser's bubble renders in the
     *browser's* language, and `type="number"` implies `step="1"`, which
     blocks a decimal before the server's message can run. Use
     `inputMode="numeric"` and let the server answer.

   **The two gaps left open above are now closed** — both in
   `QuoteBuilder.tsx` and `DocumentBuilder.tsx`, in the follow-up change
   this entry was written to schedule:
   - **`type="number"` is gone from qty, unit price and discount**; they use
     `inputMode="numeric"` like every other form, so the server's Spanish
     message is what a user meets instead of a `stepMismatch` bubble in the
     browser's language. As predicted, this was money-path work rather than
     an attribute swap: line state now holds **raw strings**, and the live
     subtotal parses them through `parseMinorUnits` / `previewTotals` in
     `lib/money.ts`, which read a posted value exactly the way the actions'
     zod schemas will. Where the server would reject the input the preview
     renders "—", so **a displayed total is either the one that will be
     stored or nothing at all** — the builder never invents a third number.
     The wire format is deliberately unchanged: the client still posts
     description/qty/unitPrice as typed and never a float or a computed
     total, and `createQuote`/`createDocument` still recompute from those
     three fields (§2.3 keeps amounts integer minor units).
   - **A rejected line no longer borrows the empty-builder message.** Now
     that it can actually be reached, an invalid line gets `itemInvalid` and
     an invalid discount — which had the same defect — gets
     `discountInvalid`, both message keys resolved client-side through
     next-intl with the copy in `messages/es.json`.

   **Verified in a browser**, since no test in the suite touches form
   behavior: Chromium with the locale forced to `en-US`, which is what
   exposes a browser-language bubble, against a seeded tenant. A decimal
   unit price now passes `checkValidity()`, submits, and comes back as the
   Spanish `itemInvalid` with the line items and the typed value still on
   screen; an empty builder still says `itemsRequired`, a decimal discount
   says `discountInvalid`. On the valid submit the builder showed
   300.000 / 250.000 and the stored quote rendered 300.000 − 50.000 =
   250.000 PYG; the nota de venta matched the same way in both the create
   and edit-draft builders. `lib/money.test.ts` pins the parse and preview
   rules against `computeLineTotals`.

   Actions reachable only from a hidden id (issue/send/suspend/toggle) were
   converted to `safeParse` + silent return rather than given form state:
   there is no user-fillable field for an error to sit under. **Closed by
   1R #6's follow-up PR** (`createSubscriptionAction`, `recordPaymentAction`,
   `impersonateAction` on `(superadmin)/tenants/[id]`, and
   `revokeInvitationAction` on `users`) — see that entry above.

   **The three remaining leftovers this entry left open are now closed too**,
   in a further follow-up:
   - **The contact `<select>` losing its selection on a rejected submit** (in
     both `QuoteBuilder.tsx` and `DocumentBuilder.tsx`) — a second submit was
     failing on `contactRequired` before the user ever saw their real error.
     Making the field controlled doesn't fix it: React's `form.reset()`
     restores each `<option>`'s `selected` *attribute*, which a controlled
     select never sets since React only assigns the value property, so the
     reset lands on option 0 while React still believes its state is right
     and never re-syncs. The fix is `src/lib/use-echo-generation.ts` —
     remounting the field per action result with the echoed value as
     `defaultValue`, since a fresh mount does set the attribute the reset
     reads. Shared by both builders and, since the same defect applies
     anywhere a `<select>` carries server-validated state, by the inbox
     reply/template pickers and the superadmin subscription forms too.
   - **`sendTextAction`** got the full `useActionState` treatment: `(prevState,
     formData)`, `safeParse`, a message key the client resolves through
     next-intl, values echoed back. The inbox is the one place this pattern
     meets 5s polling (§10 1R #3), so the risk was the reply box getting
     clobbered by a poll tick or a rejected send losing what was typed — it
     doesn't, because the action state is React state SWR never touches, and
     the reply `<input>` stays uncontrolled and remounts only when a new
     action result lands, exactly like the 1R #3 guarantee this was built
     not to violate. `sendTemplateAction` and `approveAiDraftAction` got the
     same treatment alongside it: the latter posts only hidden ids, but
     `deliverReply` *returns* its refusals (window closed, kill switch,
     opted out) rather than throwing, and those are exactly what a rep needs
     to read, so it gets form state whose only job is to render that
     outcome. `discardAiDraftAction` and `setConversationAiAction` stay
     hidden-id-only with `safeParse` + a silent return, same as the money
     actions above.
   - **`sendQuoteAction`, `setQuoteStatusAction` and
     `convertQuoteToDocumentAction`** moved to `safeParse` + silent return,
     not form state — every field they post is a hidden input off the quote
     already on screen, so there's no field for an error to sit under, and
     none of them hides a refusal worth reading: `sendQuote` records a
     WhatsApp failure on the activity and still marks the quote sent rather
     than throwing, and a quote with no items can't exist since `createQuote`
     requires at least one. `convertQuoteToDocumentAction` keeps `redirect()`
     outside its try block so that control-flow throw isn't swallowed by the
     same catch.

   **Verified in a browser**, since no test in the suite touches form
   behavior: Chromium with the locale forced to `en-US`, against a seeded
   tenant. In the quote and document builders, a decimal unit price now
   comes back as `itemInvalid` with the contact still selected in the
   `<select>`, and a second submit repeats `itemInvalid` instead of falling
   back to `contactRequired`. In the inbox, an empty reply passes
   `checkValidity()` and comes back as the Spanish "Escribí un mensaje antes
   de enviar."; typing a reply and leaving it through more than two 5s poll
   ticks left the text, the error, and the scroll position untouched; a real
   send cleared the box and the message appeared in the thread. On the quote
   detail page, "Enviar por WhatsApp", "Marcar aceptado" and "Convertir a
   nota de venta" all completed with no thrown error and the expected status
   change each time — send flipped the quote to *Enviado*, accept to
   *Aceptado*, and convert produced a linked nota de venta and swapped the
   action row for a link to it.

**Operator tasks, not code** — these gate putting real client leads in, and
none of them are done. The first two now have the code they were waiting on;
what's left in both is an operator running it against the real environment:
- **Verify MySQL backups actually restore.** 1H listed backup verification;
  it has never been exercised. Restore into a scratch database and check row
  counts before a real lead depends on it. **Automated**:
  `npm run verify-restore` (`scripts/verify-restore.ts`) points at a restored
  throwaway database via `RESTORE_DATABASE_URL` and asserts that every table
  in the Drizzle schema exists, that `tenants`/`users`/`contacts`/`deals` are
  non-empty, and that the newest contact and deal are recent enough that the
  backup isn't a stale file with a fresh timestamp — exiting non-zero with a
  report naming each failure, so it can be scheduled and its failure
  noticed. Read-only. The decision logic is `src/db/restore-check.ts`, unit
  tested without a database; the expected-table list is derived from
  `src/db/schema` rather than hand-kept, so a later migration's table is
  covered the day it lands. docs/BACKUPS.md §2 is now this command plus the
  hPanel steps around it.
- **1K's live R2 smoke test** — put a key, read it back, sign a URL. Until
  then `STORAGE_DRIVER=local` means WhatsApp media and quote/document PDFs
  sit on Hostinger disk, which §2.1 says to treat as non-durable.
  **Automated**: `npm run smoke-storage` (`scripts/smoke-storage.ts`) runs
  put → read-back (byte-identical) → sign → prove the signed URL → delete →
  confirm gone, against whatever `STORAGE_DRIVER` is configured, and cleans
  up its own object even when a step fails. Driver-agnostic on purpose so it
  is runnable today on `local` and unchanged on the R2 cutover day. The one
  real difference between the drivers is the signed URL, so the script
  splits there: an S3 presigned URL is absolute and gets fetched over HTTP;
  the local driver's is an app-relative HMAC token verified by
  `src/app/api/storage/route.ts`, which now serves the object on a valid,
  unexpired signature (404 — never 403 — for anything else: forged, expired,
  missing key, or `STORAGE_DRIVER=s3`) with `Cache-Control: private, no-store`
  and the content type recorded alongside the object by `local.ts`'s `put()`
  (falling back to `application/octet-stream` for objects written before that
  existed). Same capability model as `/q/[token]`: the signature is the auth,
  no session or tenant gate — and, like that route, per-IP rate limited
  (120/60s, checked *before* the signature, so what gets throttled is a flood
  of guesses and not just successful serves). With `SMOKE_STORAGE_BASE_URL`
  set to a running app's origin, step 5 fetches the signed URL over HTTP and
  confirms it comes back byte-identical instead of skipping.
- **Deploy and migrate**: 1O and 1Q add migrations `0010` and `0011`.

**Exit**: the owner runs a full day — leads arriving from a live site into
the right pipeline, WhatsApp follow-up in a self-refreshing inbox, a nota de
venta issued and paid — without opening a terminal or another tab.

### 1S — Deleting a record created by mistake *(added after 1R)* — ✅ done

Nothing in the app could remove a contact or a deal. `deleteContact`,
`deleteDeal` and `deleteSite` existed in the service layer with zero callers
— unconditional row deletes, never wired to a button. That is the wrong
shape to wire: §4's schema has no foreign keys, so an unconditional delete
leaves a numbered quote pointing at a contact that no longer exists, and the
first thing a dogfooding run produces is exactly the record you want gone —
a mistyped contact, a deal opened on the wrong pipeline.

**As built** (`src/modules/crm/deletion.ts`). Deletion is permitted only
while the record has no history of its own, where history is anything with
meaning outside the record: for a contact, a deal, quote, nota de venta,
WhatsApp conversation, lead submission or automation run; for a deal, a
quote, nota de venta or lead submission. Rows that describe *only* the
record — its tags, activity feed, tasks, AI drafts — are deleted with it.
The blocker scan runs twice: once for the page, which disables the button
and names what is in the way, and once inside the delete's own transaction,
so a quote created between render and click still wins. Refusals come back
as a `RecordDeleteError` carrying the blocker keys, which the actions turn
into a `?deleteError=` redirect — the same shape `deleteStageAction` already
used for "this stage still holds deals".

Both actions are `requireTenantAdmin()` + `auditLog`, matching §13 H1's rule
for destructive actions, and both are covered in
`modules/tenancy/authorization.test.ts` (the no-database suite) plus a MySQL
integration suite for the guard itself. The three unguarded service
functions are gone: leaving one next to the guarded one is an invitation to
call the wrong one. Nothing here is a soft delete — a contact with real
history stays and is corrected by editing it.

### 1T — One answer to "who is the caller?" *(added after 1S)* — ✅ done

Every per-IP rate limit in the app read `x-forwarded-for` for itself, and no
two read it the same way. The five public routes (`/q/[token]` and its PDF,
`/d/[token]` and its PDF, `/api/storage`) keyed their bucket on the **raw
header string**, so `1.2.3.4` and `1.2.3.4, 9.9.9.9` were two different
buckets and a client could mint a fresh allowance per request by varying a
header nobody validated. The login limiter and the marketing form took the
**first** entry — the one entry no proxy vouches for, since a caller can
simply send it. The three ingest lanes (`/api/v1/leads`, `/api/v1/hooks`, the
public form action) stored the raw header in `ip_address varchar(45)`, which
a two-hop chain overflows.

**As built** (`src/lib/http/client-ip.ts`). One `clientIp(headers)` helper,
used by all ten call sites. It counts **from the right**, because the
right-hand entries are the ones our own infrastructure appended: with `hops`
trusted proxies in front, index `length - hops` is the address the outermost
trusted proxy actually observed, and everything left of it is caller-supplied
and ignored. `hops` comes from `TRUSTED_PROXY_HOPS` (default 1 = Hostinger's
LiteSpeed alone); putting a CDN in front is `2`, an env change rather than a
code change. The helper also strips an appended port so one client is one
bucket, and caps the value at the 45 characters the `ip_address` columns
hold. The three lanes that *store* the address use `clientIpOrNull`, so an
undeterminable caller is NULL in the column rather than the literal string
`"unknown"` — which would read like an address someone reported.

**Delta from the spec**: the hop count is configured rather than measured,
because there is no live deploy to probe — `docs/DEPLOY.md §10` carries the
procedure to confirm it (submit one lead, read back `lead_submissions.
ip_address`) and what each wrong answer looks like. `"unknown"` stays a single
shared bucket rather than a bypass: an address the app cannot determine must
not be the way around a limit.

### 1U — Who owns this conversation *(added after 1T)* — ✅ done

`assignConversation` had existed since 1D with zero callers, so
`conversations.assignedUserId` was a column nothing wrote. In a one-rep
tenant that costs nothing; in the two-rep tenant the owner is hiring for, it
means both reps answer the same customer and neither can tell, which is the
failure the unified inbox was supposed to remove.

**As built.** The service keeps its shape and gains the check it was missing:
the target must be an *active member of the caller's own tenant*, verified
through `getActiveTenantUser` — the same lookup `getTenantContext` runs per
request — and refused with a `ConversationAssignError` otherwise. That guard
is not optional decoration: §4 has no foreign keys, and `tenantDb` scopes the
conversation row without looking at the user id in the payload, so without it
a hand-crafted POST could park a conversation on another tenant's user, or on
a salesperson deactivated that morning whose queue nobody reads.

One `AssigneePicker` client component serves both places the decision is made
— the inbox thread and the contact record's conversation tab — rather than
two implementations that could drift. The inbox *list* shows the owner per
row without a picker: triage is reading, and the decision belongs on the
conversation. Deactivated users are excluded from the picker but still
resolved for display, so a conversation assigned before someone left keeps
showing their name instead of reading as unassigned.

**Delta from the spec**: the action is agent-accessible, not
`requireTenantAdmin()`. §13 H1 reserves *configuration* for admins; deciding
which rep answers a customer is selling work, and `assignDeal` — the same
decision one object over — has always been agent-accessible. Nothing is
destroyed either, so it is not an audit-log case: reassignment is undone by
reassigning back.

On the 5s poll (§10 1R #3): the picker submits on change, so there is no
unsaved state for a refresh to clobber. The `<select>` is uncontrolled and
keyed on the stored value, which means a poll tick that changes nothing
leaves an open dropdown alone, while a colleague taking the conversation
shows up immediately. The user list is passed once from the page rather than
returned by the polling route — it does not change between ticks, and the
conversations route is the most repeated query in the product.

### 1V — Bug hunt: money, the 24h window, the automation engine *(added after 1U)* — ✅ done

With every 1R build item shipped and the remaining 1R work owner-side
(deploy, the restore and storage scripts, the dogfooding day), the code left
to write was not new surface but the defects the surface already had. Three
paths were read end to end, chosen because each one fails *silently* and each
one is load-bearing on the dogfooding day.

**Money — clean, nothing changed.** `lib/money.ts` and everything totalling a
quote or a nota de venta was audited for the failure modes §2.3 invites:
rounding that loses or invents a guaraní, IVA computed on an already-rounded
subtotal, a payment ledger whose balance can disagree with the sum of its
rows. None are present. Every operation is integer arithmetic over minor
units with no division anywhere, so there is nothing to round; there is no
IVA in Phase 1 at all (that arrives with SIFEN, §9); and the balance is
derived on every read by `getDocumentTotals` from `amountPaid`'s sum of
`document_payments` rather than kept in a column, so the two cannot drift
apart by construction. The one lenient spot — `recordPayment` accepting a
fractional amount and flooring it — is unreachable from the UI, whose zod
schema is `z.coerce.number().int().min(1)`, and was left alone rather than
changed on speculation.

**The 24h window — one real bug, fixed.** `conversations.lastInboundAt` is
what §6.4 measures the free-form window from, and the webhook ingest stamped
it with `new Date()` — the moment the *job* ran, not the moment the customer
wrote. Those two clocks are equal only when the queue is empty, and they
diverge exactly when it matters: ingestion is deliberately off the request
path (§6.3), so a worker that was down for six hours comes back to a backlog
and tells every one of those conversations that its window closes six hours
late. A rep then sends a free-form reply the CRM believes is legal, Meta
rejects it (131047), and it lands in the thread as `failed` for no reason the
rep can see. `inboundMessageTime` (`modules/whatsapp/inbound-time.ts`, pure
and unit-tested like `lib/money.ts` and `lib/phone.ts`) reads Meta's own
`timestamp`, falls back to receipt time for anything unparseable, and refuses
a future timestamp — the two ways honoring the payload could hold the window
open *longer* than the truth. `lastInboundAt`/`lastMessageAt` became
high-water marks via `latest()`, because Meta redelivers and a redelivered
older message must not drag the window's start backwards. The inbound
message row is stamped from the same timestamp, so a thread read after a
backlog shows when the customer wrote rather than when the queue caught up.

The layered re-checks the AI path already had (`deliverReply` re-reads the
window, then `sendText` re-reads it again) were audited and are correct: an
approved-late draft is refused, not sent.

**The automation engine — one real bug, fixed.** `advanceRun` walks the graph
in one synchronous loop but only wrote `currentNodeId` back when it parked on
a wait, completed, or failed. So for the whole span of a run the row pointed
at the node the job *started* on. A process that dies mid-flow — a deploy,
Hostinger recycling the app, an OOM kill — leaves that row untouched, and the
stuck-job reaper (§13 H3 #2) then re-queues `automation.advance`, which
replays every action already executed. On a flow whose first node is
`send_whatsapp`, that is a second message to a real customer: precisely the
"runs that can fire twice for one trigger" this engine's durable state exists
to prevent. Progress is now persisted after every node, which bounds the
replay to the single node that was in flight when the process died. The
regression test proves it through an observable consequence rather than by
reading the column alone: a run whose second action throws is left pointing
at the node that failed, and re-entering `advanceRun` the way the reaper does
does not create the first action's note a second time.

Two other engine worries were checked and are clean. A flow edited while a
run is in flight cannot change that run: `saveDraft` never mutates a
published version and runs pin to `flowVersionId` (§7.1). The wait-for-reply
race is genuinely resolved by `claimWaitingRun`'s compare-and-set on
`status = 'waiting'`, with the loser's update matching zero rows.

**Also fixed alongside**: status webhooks were applied blind, so a
redelivered `sent` arriving after `read` walked an outbound message
backwards in the inbox. Inbound messages are deduplicated by Meta's message
id, but a status event carries the id of the message it *describes* and is
re-appliable by design, so the guard belongs in the transition itself —
`advancesMessageStatus` (`modules/whatsapp/message-status.ts`), with `failed`
terminal in both directions.

### 1W — Public booking: a stranger picks a time *(owner request)* — ✅ done

The lead-gen sites (§5.1) capture "quiero información". Half the verticals in
that network sell an *appointment* — dentista, taller, abogado, consultorio —
and today that appointment is agreed over WhatsApp by hand and typed into the
agenda twice. This is the public page that closes the loop. Full spec:
`docs/SPEC-BOOKING.md`. Sketch:

- **A booking is not a new kind of person and not a new kind of calendar
  entry.** §5.1's test ("a lead is not a new entity") applied again gives a
  split answer: the person is a `contacts` upsert through
  `recordLeadSubmission()`, the appointment is a `calendar_events` row so the
  rep's agenda sees it with no sync job, the commercial interest is an
  optional `deal` — and only the *reservation lifecycle* is new. `bookings`
  is to `calendar_events` what `lead_submissions` is to `contacts`.
- **Availability is read from the whole agenda**, not from a booking-only
  calendar. A rep with a 15:00 site visit already booked must not be offered
  at 15:00 by a stranger; that is only sound because bookings live in
  `calendar_events` too.
- New tables: `booking_resources` (a rep *or* a room — a room must not burn a
  plan seat, §13 H6), `booking_types` (one row = one public page),
  `booking_type_resources`, `booking_availability_rules` (weekly wall-clock
  `"HH:MM"`, several rows per weekday so a siesta break is expressible),
  `booking_blackouts`, `bookings`.
- **Slot generation is pure** — data in, slots out, no db and no clock — the
  shape `calendar/grid.ts` and `sites/alerts.ts` already established. Buffers,
  increment, min-notice, advance horizon, business-hours intersection,
  blackouts, busy time, round-robin.
- **Double-booking gets three guards**, because two were not enough: a row
  lock on the resource so every reserve for it serialises, a transactional
  overlap check with `SELECT … FOR UPDATE`, and a unique index on
  `active_slot` (`"<resourceId>:<epochSeconds>"`, NULL once cancelled) as the
  backstop against a double-click. The lock is what makes the overlap check
  atomic; the index catches the identical retry.
- Public surface in §5.1's style, **no CORS anywhere**:
  `/b/[tenantSlug]/[typeSlug]`, a same-origin slots endpoint, and
  `/b/g/[token]` where the token is the secret, exactly as `/q/[token]`.
  `409` joins the vocabulary — "someone beat you to it" is a real outcome a
  visitor must see.
- Reschedule is **create + cancel linked by `rescheduled_from_id`**, in that
  order, so the audit trail is a chain rather than a mutated row and a move
  that cannot be satisfied leaves the visitor with the booking they had. A
  visitor's cancel is bounded by a hard cutoff (default 120 minutes); staff
  never are.
- Hooks and nothing more: three automation triggers, a `booking.reminder`
  job over the existing `whatsapp/send.ts`, and `recordLeadSubmission()` for
  the contact. The automation engine does not change.

**Exit**: a visitor books from the public page, the appointment appears on the
rep's agenda and the contact's timeline, the same slot cannot be taken twice,
and the visitor can cancel or move it from their own link. Met.

**As built** (differences from the sketch above, and the decisions worth
keeping):

- **`activities.type` needed no migration.** The column is a `varchar(30)`
  with a *drizzle-level* enum, not a MySQL `ENUM`, so widening it to carry
  `'booking'` was a type change only. Recorded so nobody goes looking for the
  ALTER.
- **`lead_submissions` gained `booking_type_id`**, a third entry path beside
  `site_id` and `form_id`. The alternative — a bespoke contact upsert inside
  `modules/booking` — was rejected for §5.1's own reason: a booking arrives
  from a page with UTMs and a referrer, so it *is* a lead and belongs in the
  one attribution table rather than a fourth place every dashboard query
  would have to UNION.
- **A booking fires `lead_received` as well as `booking_created`**, because
  it goes through the shared ingest engine — which is why
  `matchesTriggerConfig` learned `bookingTypeId`. A flow that wants only
  bookings narrows on it; a flow that wants every inbound stranger keeps
  working. Wire both without narrowing and you get two runs: stated here
  rather than discovered later.
- **Reminders are bounded by the 24h window, and it matters more than
  expected.** Someone who booked on a website has usually never messaged the
  business, so there is no open window and the reminder is *skipped*, not
  sent. Reaching that person needs a Meta-approved template (§6.4) with a
  review cycle attached — real work, deliberately not in this cut. Today the
  reminder serves the case that already works and never fails a booking when
  it can't.
- **The advance horizon counts from today in the tenant's timezone**, not
  from the window the visitor asked for, so paging to next month cannot drag
  `maxAdvanceDays` along with it.
- **The recorded IP and the limiter's bucket key are different values.** An
  address the app cannot determine is `undefined` in the column (NULL is the
  honest answer) and `"unknown"` in the limiter (one shared bucket, never a
  free pass) — the distinction `lib/http/client-ip` already draws.
- **The booking type's settings page came after the public page, not with
  it.** The create form asks for name, slug and duration — what it takes to
  publish — and everything else the schema and the slot generator already
  read (buffers, increment, notice, horizon, per-day cap, assignment,
  location, routing defaults, custom questions, borrowed Turnstile, reminder
  minutes, cancellation cutoff) was stuck on its default with no way to
  change it. `/booking/[id]` is that form, useActionState-shaped per §10
  1R #6. Custom questions post as index-aligned parallel arrays, which is why
  "required" is a select and not a checkbox: an unchecked box posts nothing
  and would silently shift every later row's answer onto the wrong question.
- **Reschedule reserves before it cancels.** `publicReschedule` existed and
  was tested from the start but nothing called it; wiring it to `/b/g/[token]`
  made cancel-first reachable by strangers. A pre-check against
  `availableSlots` was the first fix and was not enough — the check can go
  stale in the race, and it was skipped entirely when the new start overlapped
  the booking being moved, so the residual failure cancelled the visitor's
  appointment and created nothing. The order is now inverted: the new row is
  reserved first, with the original threaded through `busyFor`, the load count
  and the transaction's clash check as an exclusion so it cannot block its own
  replacement, and the cancel runs only once that commits. The cost is a brief
  double-hold on the agenda, accepted because a duplicate for a few
  milliseconds is recoverable and a lost appointment is not. An identical-start
  reschedule is refused up front (`sameSlot`) rather than retiring a booking
  for its own duplicate. The manage page redirects to the new token, because a
  reschedule is a new row.
- **A reschedule is not a new lead, and it was being recorded as one.** Every
  reserve called `recordLeadSubmission`, so moving an appointment opened a
  second deal, wrote a second `lead_submissions` row and re-fired the
  `lead_received` welcome flow at a customer of a month's standing — while
  the cancel half fired `booking_cancelled` ("sentimos que cancelaste") for
  what was only a change of time. Reserve now takes an optional identity
  (contact, deal, submission) and skips lead recording entirely when it has
  one; the reschedule carries the original's utm, page URL, referrer, answers
  and message across. The cancel half emits `cancelledBy: "system"` with
  `cancelReason: "rescheduled"`, and `automations/triggers.ts` filters exactly
  that pair — which is why `booking.cancelled` now carries the reason.
- **The deal moved to after the booking commits.** A visitor who loses the
  race for a slot keeps their contact row — deliberate, they tried to book and
  the owner wants to know — but was also getting a deal in the pipeline and a
  `lead_received` welcome flow for an appointment that does not exist. The
  contact and the submission are still written first; the deal, the timeline
  entry and the emit are held back by `recordLeadSubmission`'s `deferOutcome`
  and released by `finalizeLeadSubmission` once the row is in. The submission
  stays on the losing path: a record that someone tried is worth keeping.
- **The `FOR UPDATE` over `bookings` did not serialise what it looked like it
  serialised.** It matches only committed rows, so on a day with nothing in
  range InnoDB takes gap locks — which are compatible — and two
  partially-overlapping reserves both read an empty set, both pass the clash
  check, and deadlock on the inserts. `ER_LOCK_DEADLOCK` came out of the
  service as a 500 where the visitor was promised a 409. The transaction now
  locks the `booking_resources` row first: a real record lock on a row that
  always exists, so every reserve for one resource serialises.
  `ER_LOCK_DEADLOCK` and `ER_LOCK_WAIT_TIMEOUT` join `ER_DUP_ENTRY` as
  "someone got there first" for whatever the lock does not cover.
- **The visitor's slot picker is one component**, shared by the booking page
  and the manage page's reschedule: moving a booking asks the same question
  of the same endpoint as making one, and a second, subtly different picker
  is exactly the drift worth not having.

- **Blackouts got the form the engine had been waiting for.** `slots.ts` has
  dropped slots inside a closure since the reservation engine shipped, and
  `createBlackout`/`listBlackouts`/`deleteBlackout` were all there — but
  nothing in `(app)/booking/` could make one, so no tenant could close for a
  holiday. The section on `/booking` posts **two dates and two optional times,
  not a `datetime-local`**: the closure is wall-clock in the *tenant's*
  timezone and the action resolves it with `zonedTimeToUtc`, so an admin
  travelling closes the business's Friday rather than their own. Blank times
  mean whole days, and the end is midnight *after* the last day, so the day
  that was typed is itself closed — a blackout ending at 00:00 of the same
  day would close nothing. An empty resource is the whole tenant, which is
  what the nullable column was always for.
- **`assignment` lost its third value rather than gaining a column.** `fixed`
  and `any` ran the same code — `pickResource` returns the first candidate by
  sorted id for anything that is not `round_robin` — so the settings form
  offered a choice that changed nothing. Implementing it needed a designated
  resource, and that is a second place to say what the type already says by
  linking exactly one row in `booking_type_resources`: a `fixed_resource_id`
  can name a resource the type does not draw on, or one since deactivated,
  and then two columns disagree about who takes the appointment. So the value
  is gone from the schema enum, the zod schema, the select and the copy, and
  migration 0024 rewrites the rows that carried it. No ALTER: the column is a
  `varchar(15)` with a drizzle-level enum, the same thing already recorded
  above about `activities.type`. Nothing is lost — "always this person" is
  one linked resource, and `pickResource` with one candidate returns it.

**Verified**: `slots.test.ts` — 21 pure cases, no database and no clock.
`bookings.integration.test.ts` — 24 cases against MySQL: the whole
transaction; two *genuinely* concurrent reserves over overlapping starts
where exactly one wins and the loser gets `slotTaken` rather than a raw MySQL
error (the earlier "concurrent" case was sequential — the first reserve had
committed before the second began — and is kept as the double-click case it
actually is); cancel freeing the slot and clearing the agenda; the reschedule
chain; a reschedule leaving the original untouched both when the new time was
never on offer and when it loses the race for it; a reschedule opening no
second deal, writing no second submission and firing neither `lead_received`
nor `booking_cancelled`; a reserve that loses the slot leaving a contact but
no deal; the reminder following the new row while the old row's handler still
skips; the visitor's own manage link moving a booking; the date arithmetic
the blackout form posts (a whole day closed, an afternoon leaving the morning
alone); and cross-tenant isolation on every service and both public routes.

**Not done, deliberately**: no public API-key lane (§5.1's lanes exist for
*lead* ingest; a third credential surface before anyone asks is scope we
don't need) · no template-based reminders to a contact with no open window ·
no group bookings, no paid bookings, no calendar sync outward to Google.

### 1X — Embeddable AI chat widget *(owner request; 1O on the website)* — ✅ done

1O put an LLM on WhatsApp. The same visitors arrive on the lead-gen sites
first, where the only thing to do is fill a form and wait. This is the chat
bubble those sites embed. Full spec: `docs/SPEC-CHAT-WIDGET.md`. Sketch:

- **New tables, not `conversations`/`messages`.** A website visitor has no
  WhatsApp account, no phone and therefore no `contacts` row — and
  `conversations` is `NOT NULL` on both `wa_account_id` and `contact_id`
  while `messages` carries Meta delivery statuses. Fitting a visitor in
  means nulling out three columns the WhatsApp pipeline relies on. So
  `chat_conversations` + `chat_messages`, reusing the *vocabulary*
  (`direction`, `status`, `error`, `sent_by_user_id`) and nothing else. The
  WhatsApp pipeline is not touched.
- **A visitor becomes a contact the moment they give a phone**, by exactly
  one route: `recordLeadSubmission()`. Chat is a third lead entry path, not a
  third lead model. Before that, `contact_id` is NULL — the honest
  representation of "someone is asking and we don't know who they are".
- **iframe, so §5.1's no-CORS lock survives intact.** `w.js` draws a bubble
  and injects `<iframe src="/w/<widgetKey>">`; every request the chat makes
  is same-origin, from our page to our API. No `Access-Control-Allow-Origin`
  is added anywhere. The alternative — a CORS API plus a shadow-DOM widget —
  reopens a locked decision and puts the tenant's system prompt one fetch
  away from any page that cares to ask.
- **`widgetKey` is a public identifier, not a credential** — the same
  category as a Turnstile *site* key. What defends the endpoint is a
  per-widget allowlist on the *embedding page* (belt, documented as not an
  auth boundary), per-IP and per-visitor rate limits, a Turnstile challenge
  before the first AI call of a conversation, and the spend caps below.
- **One per-tenant daily budget, shared with WhatsApp**, plus a chat
  sub-cap of half it. Independent counters would silently double a tenant's
  ceiling the day this shipped, which defeats the reason the per-tenant cap
  exists. `ai_replies` is generalised rather than duplicated: `channel`,
  `chat_conversation_id`, and `conversation_id`/`contact_id` relaxed to
  nullable. The cap belongs in one place because the bill does — and the
  sub-cap bounds the other thing, which is *which* channel gets to spend it.
- **Draft-first, restated for a website**: `off` shows a contact form and
  spends nothing, `draft` (the default) captures the message and shows the
  rep a suggested reply, `send` answers live. The tenant mode stays a
  *ceiling* over the widget mode via `resolveMode`, unchanged from 1O — going
  autonomous is still a two-key operation.
- Polling, not websockets: §2.1 locks a single Node process with no Redis, so
  a fan-out has nowhere to live. A 25-second long-poll fits the platform we
  actually deploy on.

**Exit**: a tenant embeds one line of script on a site, a visitor's question
is answered (or captured), the reply obeys the same guards and the same daily
budget as WhatsApp, and a captured visitor lands in the pipeline with the
site's attribution. Met.

**As built** (differences from the sketch above):

- **`ai_replies` was generalised exactly as proposed**, and
  `countRepliesTodayForTenant` needed no change at all — it already counted
  every row a tenant has, which is the whole argument for one table made
  concrete.
- **One consequence the spec did not name**: `deliverReply` (the WhatsApp
  approve-and-send path) now refuses a chat row explicitly rather than
  reaching `sendText` with a null. There is a test for it.
- **Chat drafts stay out of the WhatsApp inbox for free**: `listPendingDrafts`
  filters on `conversation_id`, which a chat row does not have. One shared
  table, two inboxes, no filtering the caller has to remember.
- **The origin allowlist rejects lookalike hosts.** A naïve suffix match
  would accept `evil-example.com` for `example.com`; a bare host now matches
  only itself, and a leading dot is the explicit "and its subdomains" form.
- **The visitor id is minted in the iframe's own `localStorage`**, not by the
  server: a conversation handle, not a credential, and a blocked storage jar
  degrades to a fresh thread per load instead of no chat at all.
- **`w.js` forwards the host page's URL, referrer and `vc_attr` cookie** by
  `postMessage` and query string — the cookie sits on the *client's* origin
  and is unreadable from our iframe.
- **The allowlist was being checked against the wrong origin, and the
  `message` listener was not checking one at all.** Both are fixed, and the
  claim that used to stand here — that the iframe's listener checks
  `event.origin` — was false: `window.tsx` accepted `vc-chat:page` from any
  page that framed it, so one could rewrite the attribution on someone's
  lead. The allowlist was enforced on the chat's own API calls, where
  `Origin` is either this CRM's own (a same-origin POST from our iframe) or
  absent entirely (the GET poll) — neither says anything about the page the
  visitor is on, so a tenant who filled `allowed_origins` in got 403 on every
  legitimate request and nothing in exchange. Enforcement moved to the iframe
  document at `/w/[widgetKey]`, whose `Referer` *is* the embedding page; a
  page outside the list, or an absent `Referer` once a list exists, is a 404.
  The API paths keep a same-origin assertion instead. The listener now checks
  `event.origin` against that same server-read origin and that the sender is
  actually `window.parent`. It stops casual re-embedding; it is still not an
  auth boundary, and the rate limits, the Turnstile challenge and the spend
  caps are still what bound the damage.
- **The Turnstile challenge the spec called for was never built.** It is now,
  on the ladder §5.2.1 established: the widget's site has no secret, the
  check is skipped — the state every existing site is in. Where one is
  configured, the first provider call of a conversation needs a valid token,
  and "first" is read off `ai_replies`, so a call another guard refused
  leaves the challenge still owed rather than spending it. A missing or
  rejected token costs the visitor the AI reply and nothing else: the message
  is captured and they see the same `pendingHuman` shape a tripped cap gives.
- **Chat gets half the tenant's daily budget, not all of it.** The shared
  ceiling stays shared and unchanged; the sub-cap stops the public,
  unauthenticated surface burning the allowance a customer already mid-thread
  on WhatsApp needs. Floored, never to zero.
- **The poll route had no rate limit at all** — the one public chat route
  without one. 15/min per visitor and IP: generous for the 8-second client
  poll, bounded for a scripted one.
- **A tripped cap, a draft, a provider error and a handoff all look identical
  to the visitor**: "a person is coming", one `pendingHuman` flag rather than
  distinct statuses, so no future branch can leak the tenant's billing state
  to their customer.
- **`business_hours_mode` is checked before the driver is called**, not
  after, so an out-of-hours message costs nothing.
- **`chat_conversations.unread_count` is now written.** It shipped as a
  column nobody incremented — a badge that would have read zero forever.
  Every inbound visitor message raises it; opening the thread clears it, and
  on `/chat` opening the thread *is* loading the page, because that page
  renders every open conversation's transcript in full (the same clear-on-
  open `/inbox/[id]` does for WhatsApp). A rep's own reply does not clear it,
  and the badge shown is the value read before the clear.

- **The widget form reached 12 of ~19 configurable columns; now it reaches
  all of them.** `business_hours_mode`, `position`, `launcher_label`,
  `offline_message`, `avatar_url` and `is_active` were written by
  `createChatWidget` and readable by the public path, but no form posted them
  — and the routing defaults were the worst of it: `create_deal` was a live
  toggle with no way to say *which* pipeline, stage, owner or tags the deal
  gets, so a captured visitor landed wherever the ingest defaults put them.
  The form is now sectioned the way `BookingTypeForm` is, with copy read from
  next-intl on the client rather than threaded through the server page one
  prop at a time, which is the only thing that made a form this size
  tractable.
- **Two of those columns had to reach `w.js`, not the iframe.** `position`
  and `launcher_label` describe the *bubble*, which `w.js` draws before the
  iframe exists and reads off its own `data-` attributes. Saving them into the
  row without changing what the tenant pastes would have left two settings
  that visibly did nothing, so the embed snippet on `/chat` now carries
  `data-position`, `data-color` and `data-label` from the row. Changing them
  means re-pasting the snippet, which is stated where the snippet is.
- **`/chat` listed `status:"open"` only and `closeChatAction` was one-way.**
  A closed thread left the page and there was no route back to its
  transcript — a rep who mis-clicked lost the conversation from the UI
  entirely. The list now has an open/closed/all filter and closed threads
  offer *reopen*; `reopenConversation` also puts the returning visitor back on
  the same row, because `findOpenConversation` is what the widget resolves to
  and a closed thread would have silently started them a second, empty one. A
  closed thread shows its transcript without a reply box: it is history until
  someone reopens it.
- **Assignment was in the service layer with nothing calling it.**
  `assignConversation` existed from the start and only `replyInChatAction`
  ever used it. There is now a picker per thread, mirroring the WhatsApp
  inbox's — submits on change, keyed on the stored value so a revalidation
  cannot snap an open dropdown shut. Two things followed from surfacing it.
  The reply path claimed the thread *unconditionally*, which with a visible
  owner means quietly taking a colleague's conversation every time anyone
  typed; it now claims only an unclaimed one. And `assignConversation` gained
  the active-membership check `whatsapp/inbox.ts` already carried — the id
  now arrives from a browser, and an unchecked one would park a customer's
  conversation on somebody who cannot open this business at all.

**Verified**: `widgets.test.ts` — 13 pure cases (host matching including the
lookalike and subdomain edges, the pinned WhatsApp-only guards, all three
caps including chat's half-share and its floor, the draft ceiling in all four
mode pairs). `chat.integration.test.ts` — 19 cases against MySQL: all three
modes; a WhatsApp reply spending the chat's tenant budget; the chat sub-cap
biting while the tenant still has budget WhatsApp can use; the Turnstile gate,
including that an absent and a rejected token both capture the message,
spend nothing and leave the challenge owed, and that a passed one is asked
for once per conversation rather than once per message; the poll limiter; a
configured allowlist serving its own legitimate traffic — a POST carrying our
origin, a poll carrying none, a capture — which is the case that was never
tested and was broken outright; the allowlist refusing a wrong `Referer` on
the iframe document; a cross-origin API call refused; the handoff keyword;
capture creating a contact and one timeline entry even when repeated; the
unread counter rising on inbound and clearing on read; the unknown/inactive
key spending zero tokens; closing then reopening a thread, with the returning
visitor landing back on the same row; assignment accepting an active member
and refusing another tenant's user without disturbing the current owner;
cross-tenant isolation; and `deliverReply` refusing a chat row.

Two harness bugs surfaced while writing that coverage and are worth
recording, because both were making cases pass for the wrong reason:
`mergeTenantSettings` deep-merges `ai`, so a cap one case lowered stayed
lowered for every case after it (the handoff case was passing because nothing
was ever generated), and re-stubbing `fetch` hands back the *same* spy with
its call history intact.

**Still not in, deliberately**: file uploads · websockets · a unified
WhatsApp+chat inbox (a real feature that deserves its own decision, not a
side effect of this one) · RAG over tenant documents · proactive/exit-intent
triggers · chat in `site_ingest_health` · typing indicators.

### 1P — Google Business Profile *(idea; not scheduled)*

GBP is where the owner's local-SEO work and this CRM meet: reviews, questions,
and the "message" button all generate leads that currently live outside the
system. Worth building eventually:

- **Reviews into the CRM**: pull reviews per location, alert on ratings below
  a threshold, draft replies with the same AI layer as 1O.
- **Review requests**: automation action that asks for a review when a deal
  hits a won stage — the highest-leverage half, and it needs no Google API at
  all, just a link over WhatsApp. **Build this first**; it delivers most of
  the value with none of the OAuth work.
- **GBP messages** into the unified inbox, alongside WhatsApp.
- **Posts** scheduled from the CRM.

Cost note: the Business Profile APIs are free but **access is request-gated** —
Google reviews each project before granting it, and turnaround is measured in
weeks. Treat approval as a prerequisite with lead time, the same way §12 Q1
treats Meta verification.

### Session estimate

| Milestone | Sessions (cumulative) |
|---|---|
| GHL-replacement milestone (1A–1E) | **~17** |
| Internal-tool milestone (1A–1F) | **~19** |
| Full Phase 1 (through 1H) | **~26** |
| Operable without SSH (1I) | **~27** — ✅ done |
| CRM surface parity (1J) | **~31** — ✅ done |
| Durable storage (1K) | — ✅ done |
| Feedback & polish (1L) | — ✅ done |
| Transactional email (1M) | — ✅ done |
| Sellable as SaaS (through 1N) | **~37** — 1N still blocked on Meta approval |
| AI auto-reply (1O) | **~40** — ✅ done, merged |
| Notas de venta (1Q) | — ✅ done, engine + UI merged |
| Daily-driver readiness (1R) | 🟡 **items #1-#6 done** — operator tasks (§10 1R) and the owner's dogfooding day still open |
| Multi-lane ingest (§5.2: Turnstile, key rotation, webhook receiver, ingest health, alerts) | — ✅ done, five PRs merged |
| Bug hunt: money / 24h window / automation engine (1V) | — ✅ done, money clean, two real bugs fixed |
| Google Business Profile (1P) | unscheduled |

Estimates assume focused build sessions against this spec; Fable review gates (after
1B, 1D, 1G) are separate short sessions, not counted above.

---

## 11. Deferred / explicitly out of Phase 1

Payment gateway (Bancard/Pagopar), monthly billing, client-side quote acceptance,
websockets/SSE realtime, Guaraní/English
locales (i18n layer is ready), WhatsApp broadcast/bulk campaigns (compliance-sensitive —
revisit deliberately), mobile apps, SIFEN anything (Phase 2), all Phase 3 marketing
features. *(“Public API” is no longer deferred in full: 1E ships a deliberately narrow
one — lead ingest only, not a general CRUD API.)*

**No longer deferred: multi-tenant users** (one user in many tenants). Shipped as
`tenant_memberships` — see §3.1 for the shape and §1.2's amended Tenancy row for why the
decision was reopened.

**URL route segments stay English** (`/sites`, `/contacts`, `/pipeline`, `/inbox`, …)
while every visible string is Spanish through next-intl — cosmetic inconsistency only,
low priority, and not worth the routing risk of renaming for an internal, non-indexed app.

**GHL capabilities this deliberately does not replace in Phase 1.** Listed so the cutover
is planned, not discovered:

| GHL feature | Status here | Cheapest path when needed |
|---|---|---|
| Workflows / automations | **Replaced in 1G** (visual flow builder) | — |
| WhatsApp inbox + templates | **Replaced in 1D** ✅ | — |
| Lead capture from sites | **Replaced in 1E** | — |
| Transactional/marketing **email** | Not built | Resend or Postmark + own domain warmup — you now own deliverability |
| **SMS** | Not built | Twilio; Paraguay SMS pricing is poor and WhatsApp is the stronger channel anyway |
| **Booking / calendar** | **Internal agenda built** (`modules/calendar`): week/month grid, appointments against a contact or a rep, tasks drawn beside them, all in the tenant's timezone. What it is *not* is public self-booking. | Cal.com self-hosted, for the public booking page only |
| **Missed-call textback** | Not built | Needs a telephony number (Twilio) + a 1G flow |
| Traffic analytics / funnels | Not built, **by decision** (§1.2) | Self-hosted Umami as a separate app |

## 12. Open questions for the owner (non-blocking)

1. **Meta timeline**: is the Meta Business verification / Tech Provider process
   started? It gates embedded signup (not the build). Start it now if not.
2. **Your team's number**: is the WhatsApp number your team will use already on the
   WhatsApp Business *app*? Migrating a number to Cloud API disconnects it from the
   phone app — plan the cutover day.
3. **Quote branding**: logo + brand colors for the PDF template when 1E starts.
4. **Object storage**: OK to add a Cloudflare R2 (or similar S3-compatible) account
   before onboarding external tenants? (~free at this scale; local-disk driver is fine
   for the internal-only period.)

*Added with 1E (multi-site ingest):*

5. **Pilot site**: which single site points at VenderCRM first for the 2–3 week parallel
   run against GHL? Ideally the one with steady but not critical lead volume.
6. **Site backends**: do all the sites in the network have a server-side form handler, or
   are some fully static / still GHL-hosted? Static ones use the hosted form pages
   instead — worth knowing the split before 1E starts.
7. **GHL export**: can existing contacts be exported to CSV now? A one-off import script
   is small, but it needs the real column shape to be written against.
8. **Turnstile**: OK to add a Cloudflare account for Turnstile (free) on the sites?
   Without it the honeypot alone carries spam defense. *(The code shipped in §5.2.1 and is
   per-site optional — this is now purely "open the account and paste the two keys".)*
9. **Email**: is any current GHL email flow load-bearing for the Paraguay sites? If yes,
   §11's email gap needs scheduling; if it's WhatsApp-only follow-up, it doesn't.

*Added with §14 I2 (config hygiene):*

10. **The marketing site's own contact details** — `src/lib/site-config.ts` still
    carries five `TODO(owner)` fields: the WhatsApp number, the phone (E.164 +
    display form), the email, the address and the RUC. They are `null`, so every
    component omits its element rather than printing a placeholder: the live site
    currently shows **no** WhatsApp button, no phone link and no RUC. That is the
    single biggest conversion gap on clientes.com.py and only the owner can close
    it — it is a one-file edit, no deploy logic involved. The lead form is the
    other half: it needs a `VENDERCRM_API_KEY` (a site row under Sitios) before a
    submission lands in the owner's own pipeline.

---

## 13. Hardening & improvement batches (Fable review, 2026-08-18)

> **Authored by Fable 5** after a full-repo review (tech/build, roles/permissions,
> features/UX/i18n). This section is the source of truth for the post-Phase-1
> hardening pass. Each batch below is **one PR on its own branch off `main`**.
> Batches inside a wave are file-disjoint and safe to run in parallel windows;
> **do not start a wave until the previous wave's PRs are merged.** Build models:
> follow the existing conventions (§2.2 layout, `tenantDb`, zod in actions,
> next-intl for all strings, tests beside the module). No batch may reopen a §1.2
> locked decision. Flag genuine gaps for Fable review; don't improvise architecture.

### 13.0 Model tiering for this pass

- **Fable 5**: authored this section; review gate after H1 (authorization) and
  before/after H9 (extraction). No build batch requires Fable.
- **Opus 5**: H1, H3, H9 — authorization correctness, worker/ops reliability,
  and the pre-SIFEN document-layer extraction.
- **Sonnet 5**: H2, H4, H5, H6, H7, H8 — UI, CRUD, i18n sweep, mobile pass.

### Wave 1 — security & reliability (parallel: H1, H2, H3)

**H1 — Authorization hardening (Opus 5).** Review found server actions that any
`agent` can call although §3.2 reserves them for `admin`:
- `src/app/(app)/automations/actions.ts` — create/saveDraft/publish/setStatus/cancelRun
- `src/app/(app)/forms/actions.ts` — createForm, updateFormTurnstile
- `src/app/(app)/pipeline/actions.ts` — createPipeline (pipeline *config* only;
  moving/assigning deals stays agent-accessible)
- `src/app/(app)/products/actions.ts` — createProduct, toggleProduct
- `src/app/(app)/documents/actions.ts` — **voidDocument, deletePayment** (worst:
  destructive, no audit). issueDocument/recordPayment stay agent-accessible
  (agents sell); void/delete become admin-only **and write `auditLog` rows**.
Switch each to `requireTenantAdmin()`; hide the corresponding nav/pages/buttons
for agents (automations, forms already nav-hidden? verify against
`src/app/(app)/layout.tsx`); add `requireSuperadminContext()` in-page to
`(superadmin)/{tenants,tenants/[id],plans}/page.tsx` (defense-in-depth,
matching `whatsapp-health`). **Exit criteria:** a new
`src/modules/tenancy/authorization.test.ts` asserting every admin-only action
rejects an `agent` — one test per action listed above — plus existing suites green.

**H2 — Error UX safety net (Sonnet 5).** Zero `error.tsx`/`not-found.tsx`/
`loading.tsx` exist; unhandled throws show Next's blank 500 (the failure mode
DEPLOY.md §8 exists to debug). Add: root `global-error.tsx`; per-group
`error.tsx` + `not-found.tsx` for `(app)`, `(superadmin)`, `(public)`,
`(marketing)`; `loading.tsx` skeletons for the heavy lists (contacts, inbox,
pipeline, quotes, documents, dashboard). Add a toast system (sonner), mounted
in `(app)` layout, and wire the two known silent failures: failed drag in
`PipelineBoard.tsx` and failed send in `inbox/[id]/ConversationView.tsx`.
All strings through next-intl. **Exit criteria:** throwing inside a tenant page
renders the branded error boundary, not the digest page.

**H3 — Ops hardening (Opus 5).**
1. **Sentry is configured but `captureException` is never called.** Report from:
   worker `processJob` catch (with job type/id tags), dead-job transitions,
   webhook processing failures, and the `error.tsx` boundaries from H2 (client
   config already exists).
2. **Job reaper:** a job whose process dies mid-run stays `running` forever
   (`claim.ts` never re-sees it). Add a reaper in `src/worker/maintenance.ts`:
   `running` + `lockedAt` older than N minutes → back to `pending` (attempt
   counted), with a test.
3. **Dead-job visibility:** superadmin page (or section on `whatsapp-health`)
   listing `dead`/stuck jobs with a retry action.
4. **Login rate limiting:** apply `src/lib/rate-limit` to better-auth
   sign-in/forgot-password paths (per-IP + per-email fixed window). Add rate
   limit + zod to `(marketing)/contacto/actions.ts`.
5. **Constant-time cron secret:** replace `!==` with `timingSafeEqual` in the
   three `api/cron/*` routes + `health/db` via one shared helper.
**Exit criteria:** reaper test green; forced worker error visible in Sentry
(or logged via a driver stub in CI); repeated bad logins get 429.

### Wave 2 — lifecycle, language, data-in (parallel: H4, H5, H6)

**H4 — User lifecycle & superadmin QoL (Sonnet 5).**
- Deactivate/reactivate users (use better-auth `banned` columns, already in
  schema, referenced nowhere). Banned users: session rejected in
  `getTenantContext`, revoke sessions on ban.
- Role change admin↔agent from `/users` (admin-only; cannot demote yourself if
  last admin).
- Admin-triggered password reset (send reset email) + superadmin "set password"
  for stuck users (wire existing `setUserPassword`).
- **Impersonation exit:** `stopImpersonation()` has zero callers. Persistent
  banner in `(app)` layout when `impersonatorUserId` is set, with "volver a la
  consola"; login redirect for superadmins → `/tenants` instead of `/`.
- Audit log: write rows on ban/role-change/reset; **viewer pages** (superadmin:
  cross-tenant; tenant settings: own tenant) — `listAuditLogForTenant` exists
  unused.
**Exit criteria:** banned agent's live session is dead on next request (test);
impersonation round-trips console → tenant → console in the UI.

**H5 — Multi-language (Sonnet 5).** §1.2 stays: `es` is default and reference
locale. Add `en` and `sv` as **user-level preference** (no `[locale]` URL
segment — locale is a `users` column, default from tenant locale):
1. `src/i18n/request.ts`: resolve locale from session user (cookie fallback
   pre-login); `<html lang>` follows it.
2. Language switcher: settings page + login/user-menu.
3. `messages/en.json`, `messages/sv.json` — full translations of the 995 keys;
   extend `messages.test.ts` to diff key sets across locales (missing key =
   test failure).
4. **Hardcoded-Spanish sweep** (review located these): public pages
   `q/[token]`, `d/[token]`, `f/.../page.tsx`; PDFs `quotes/pdf.tsx`,
   `documents/pdf.tsx`; `lib/email/templates.ts`; thrown user-facing errors in
   quotes/documents `delivery.ts`, `forms/submissions.ts`, `sites/settings.ts`,
   `auth/invitations.ts`, `automations/flows.ts`, `ai/reply.ts`. Customer-facing
   artifacts (public pages, PDFs, emails) follow the **tenant** locale, not the
   viewer's.
5. Replace hardcoded `es-PY` `Intl.*` formatters with a locale-aware helper
   (keep `America/Asuncion`/currency from tenant settings).
**Exit criteria:** switcher persists per user; key-parity test green; no
literal Spanish strings left in the swept files.

**H6 — Data-in & follow-through (Sonnet 5).**
- **CSV import** for contacts (`/contacts` → import): upload, header mapping UI,
  phone normalization via `lib/phone`, dedupe by phone (update-vs-skip choice),
  per-row error report, tag-on-import. This is the GHL migration path (§1.1) —
  ask for a real GHL export shape if available (§12 Q7).
- **Task reminders:** daily job (queue + Resend) emailing each user their due/
  overdue tasks (`listOpenTasksDueBy` exists unused); per-user opt-out in
  settings.
- **Plan limit enforcement:** `plans.limits` JSON is written but never read.
  Define shape `{ maxUsers, maxContacts, maxSitesConnected }` (null = unlimited);
  enforce at invite, contact create/import, site create; friendly limit-reached
  UI. `plans.features` gating stays deferred until a real differentiated plan
  exists — don't build speculative flags.
**Exit criteria:** 1k-row CSV imports with mixed dupes/errors and a correct
report; seat limit blocks the N+1th invite (test).

### Wave 3 — daily-driver UX (parallel: H7, H8)

**H7 — Mobile & PWA pass (Sonnet 5).** The nav is responsive; the 46 pages
under it mostly aren't (only dashboard + layout have breakpoint classes).
- Wrap every `<table>` in an `overflow-x-auto` container (quotes, quotes/[id],
  products, documents ×2, automations/[id], the three superadmin pages, both
  public share pages — contacts already does it).
- Responsive pass on forms/detail pages (stack on small screens; no fixed
  `max-w-sm` columns that clip).
- `PipelineBoard.tsx`: add @dnd-kit `TouchSensor` with sensible activation
  constraints; verify drag on a 390px viewport.
- Flow editor on mobile: read-only notice + list view is acceptable Phase 1
  (do not attempt touch canvas editing).
- **PWA:** `manifest.ts`, icons, `apple-touch-icon`, `theme-color` — installable
  home-screen app for the CRM host. No service worker/offline in this batch.
  Also add `sitemap.ts`/`robots.ts` for the marketing host.
**Exit criteria:** Playwright (or manual per SMOKE_TEST.md) pass at 390px:
login → contacts → contact detail → pipeline drag → inbox reply, no horizontal
body scroll anywhere.

**H8 — Product depth (Sonnet 5).**
- **Global search (Ctrl/⌘K):** command palette searching contacts (name/phone/
  email), deals, quotes, documents, conversations; server endpoint with
  per-tenant scoping via `tenantDb`; rate-limited; keyboard navigation.
- **Deal detail page** `pipeline/[dealId]` (or drawer): value, stage history,
  assigned rep, linked contact/quotes/tasks, **won/lost buttons** with reason;
  won/lost excluded from board columns by default.
- **Pipeline config UI** (admin-only — respects H1): rename/reorder/recolor/
  delete-if-empty stages, mark won/lost stages.
- Wire `leads/stats.ts` (exists, unused) into a simple dashboard source/UTM
  report table.
**Exit criteria:** ⌘K reaches any contact in ≤3 keystrokes + Enter; a deal can
be won/lost from its detail view and disappears from active columns.

### Wave 4 — solo (H9, after all above merged)

**H9 — Extraction & unification (Opus 5, Fable review gate before merge).**
1. **Shared document layer:** `quotes/*` and `documents/*` are near-clones
   (numbering, pdf, delivery, public pages — ~300 duplicated lines). Extract
   `src/modules/renderable-document/` (or shared helpers) for: per-tenant
   numbering, react-pdf shell (header/branding/items/totals), delivery
   (render → store → WhatsApp), public token page + pdf route plumbing. Quotes
   and documents become thin configs over it. **This is the SIFEN (§9)
   pre-work — a third copy is forbidden.** Behavior must be pixel-stable:
   snapshot-compare a rendered quote + document PDF before/after.
2. **Shared API route guard:** one helper module providing the cron-secret,
   session, api-key and token guards with uniform JSON error bodies; migrate
   the 11 routes; delete the 5 divergent inline patterns.
3. **UI primitives:** add shadcn `input`, `label`, `select`, `table`, `dialog`
   to `src/components/ui/`; migrate the ~100 inline-class form fields
   (mechanical, biggest diff — which is why this batch runs alone).
**Exit criteria:** PDFs byte-comparable or visually identical; all route tests
green; zero remaining inline `rounded-md border px-3 py-2` input literals.

### 13.1 Explicitly NOT in this pass (deferred, unchanged from §11)

Owner-scoped "agent sees only own deals" visibility mode (would reopen §1.2's
shared-pipeline decision — needs an owner call first), custom fields, duplicate
merge UI, email-as-channel, *public* self-booking (the internal agenda has
since been built — §11's table), native mobile app (H7's PWA is the Phase-1
answer), payment gateway, websockets/SSE for the inbox.

## 14. Improvement batch (Fable review, 2026-08-28 — found during the crmswe fork audit)

> **Authored by Fable 5.** These surfaced while auditing the repo to fork it for
> the Swedish market (crmswe). Same conventions as §13: one PR per batch, branch
> off `main`, no batch reopens a §1.2 locked decision. I1 and I2 are
> file-disjoint and can run in parallel; I3 runs after. Where crmswe fixes the
> same item (noted below), prefer cherry-picking its commit over re-implementing.

**I1 — Single-process assumptions made safe (Opus 5).** — ✅ done
1. `src/lib/rate-limit/index.ts` is an in-memory fixed window: it resets on
   every deploy and silently stops limiting if the app ever runs >1 process
   (documented in the file, not mitigated). Replace with a MySQL-backed window
   (one small table, `INSERT ... ON DUPLICATE KEY UPDATE`, periodic cleanup in
   `src/worker/maintenance.ts`) so limits survive restarts and horizontal
   scale; keep the in-memory driver as a test/dev fallback behind the same
   interface. All existing call sites unchanged.
2. `resolveTenantByContactsFeedToken` (`src/modules/tenancy/settings.ts`)
   table-scans every tenant per Sheets-feed request. Store a SHA-256 of the
   token in an indexed column (same pattern as `site_api_keys`) and look up
   directly; migration backfills from existing settings.
**Exit criteria:** rate-limit integration test passes against MySQL driver
(window survives a simulated restart); feed lookup is a single indexed query
(assert via test on the new column); suites green.

**What shipped.** `lib/rate-limit` is now a driver seam: `memory` (unchanged
behavior, the dev/test default) and `mysql` (one `rate_limit_buckets` row per
key, upsert + read-back in one transaction so the count can only err toward
limiting). `checkRateLimit` became async — every call site awaits it, and
`requireWithinRateLimit`/`checkLoginAttempt`/`ingest.rateLimited` with it.
A database blip degrades to the in-memory driver and reports once a minute
rather than taking every public page down. Expired rows are swept hourly by
`maintenance.sweep_rate_limits`, replacing the old in-process timer. The
feed-token lookup is one indexed match on `tenants.contacts_feed_token_hash`
(migration 0026 backfills it with MySQL's own `SHA2`, which the app's digest
is tested to agree with); the timing-safe compare against the stored token
stays as a second gate. Driver choice is `RATE_LIMIT_DRIVER`, unset =
mysql outside tests.

**I2 — Consistency & config hygiene (Sonnet 5).** — ✅ done
1. **One money renderer.** `formatMoney` (`src/lib/i18n/format.ts`) renders
   `"1 500 000 PYG"` (code suffixed, no Intl currency style) while
   `src/modules/renderable-document/format.ts` renders `"PYG 1.500.000"` —
   two currencies formats in one product. Unify on a single helper using
   `Intl.NumberFormat` currency style with correct fraction digits per
   currency (PYG=0), used by UI, PDFs, and public pages alike. (crmswe phase
   O1 builds exactly this — cherry-pick candidate.)
2. **Graph API version pin.** `GRAPH_API_BASE` hardcodes `v21.0`
   (`src/modules/whatsapp/graph.ts:4`); Meta retires versions on a schedule.
   Make the version an env value with the current default, and add a
   `whatsapp-health` warning row when the configured version is past a
   documented review date.
3. **`src/lib/site-config.ts` split.** Infra constants (`APEX_HOST`,
   `APP_HOST` — consumed by `middleware.ts`) live in the same file as
   marketing content (owner phone, address, RUC, several unfilled
   `TODO(owner)` fields that render as gaps on the live site). Move hosts to
   env-driven config, keep content separate, and surface the unfilled owner
   fields to §12 as an owner question.
**Exit criteria:** one grep-able money formatter; envs documented in
`.env.example`; middleware behavior unchanged (host-routing tests green).

**What shipped.** `formatMoney` is the one renderer: `Intl` currency style
with `currencyDisplay: "code"`, so PYG gets no decimals and USD gets two, and
the code sits where each language puts it ("PYG 1.500.000" in Spanish,
"50 000 PYG" in Swedish). `renderable-document/format.ts#money` is now one
line over it, so the UI, the PDFs and the public pages cannot drift apart
again. The Graph API version is `WHATSAPP_GRAPH_API_VERSION` (default
v21.0), and `graphVersionWarning()` puts a row at the top of the superadmin
WhatsApp health page once the configured version passes its documented review
date — or when it has no documented date at all. `lib/site-config.ts` keeps
only marketing content; the hostnames moved to `lib/config/hosts.ts`, read
from `process.env` with the production values as defaults (plain reads, not
the zod `env` module, because `middleware.ts` runs on the edge runtime). The
owner's five unfilled fields are now §12 question 10.

**I3 — Dark mode toggle (Sonnet 5).** — ✅ done `globals.css` ships a complete dark
OKLCH token set with documented contrast ratios, but no `.dark` toggle exists.
Add a theme switcher (system/light/dark, persisted per user next to the locale
preference), apply the class on `<html>` before hydration (no flash), and QA
the app group's heavy surfaces (pipeline board, inbox, PDFs excluded — print
stays light). **Exit criteria:** toggle persists across sessions; no
flash-of-wrong-theme on reload; contacts/pipeline/inbox legible in dark.

**What shipped.** `users.theme` (migration 0027) plus a `vc_theme` cookie,
resolved and persisted exactly the way the locale preference is — the
switcher sits beside the language one on the settings page and works signed
out too. No flash: the server puts `.dark` on `<html>` from the cookie, and
an inline `<head>` script settles the `system` case before first paint (it is
a string constant so a test can assert it is wrapped in try/catch — a script
that threw would silently strand every dark-mode user on light). `:root` now
declares `color-scheme`, so scrollbars, form controls and autofill follow the
palette.

Two decisions worth naming. **No preference means light, not system**: the
public quote / nota / booking pages and the marketing site share this
stylesheet and are read by customers who never chose anything, so dark is
opt-in and `system` is one of the things a person can opt into. And those
customer-facing surfaces carry a `.theme-light` class that re-declares the
light tokens further down the tree, so a signed-in user's dark preference
does not follow them into a document a customer is reading.

The dark audit also found three surfaces that were light-only and would have
been unreadable: the AI draft box in the inbox (`bg-white` with inherited
light text) and the API-key / webhook-token code blocks on the sites page.
Fixed to tokens. The QR code's white background is deliberate and stays.

### 14.1 Noted, deliberately not batched

- **Tenant-level currency setting.** vendercrm is PYG-only by product decision;
  crmswe (the Swedish fork) builds tenant currency + öre minor-units in its
  phase O1. If vendercrm ever needs a second currency, port that work — don't
  redesign it here.
- **PLAN.md size** (2 417 lines): splitting per-domain would churn every `§`
  reference in code comments; not worth it while the doc is stable.
- **`scripts/seed-demo-data.ts`** is non-idempotent by declared design; leave
  as-is, it's dev-only.
- **i18n guard gap:** only `es.json` key-parity is enforced; hardcoded strings
  in new tsx files slip through review. A lint rule for literal JSX text in
  `(app)`/`(public)` would close it — nice-to-have, low urgency.

---

## 15. Direction batch (Fable review, 2026-09-05 — the GHL comparison and the owner's idea round)

> **Authored by Fable 5.1** after the full-repo competitive review against
> GoHighLevel (published page: "VenderCRM contra GoHighLevel") and the owner's
> follow-up questions on email, documents, coaching, voice and WhatsApp
> onboarding. Same conventions as §13/§14: one PR per batch, branch off `main`,
> no batch reopens a §1.2 locked decision unless this section says so
> explicitly. Items are tagged **now** (build in the next sessions), **next**
> (the quarter after), **later** (a bet that needs a prerequisite first) or
> **idea** (parked, written down so it is not rediscovered).

### 15.0 Baseline corrections the review found

Four things the product is described as having are thinner in the code:

1. **SIFEN is a foundation, not a feature.** `modules/sifen/` has the módulo-11
   digit, the CDC and three code tables; the six facade functions throw
   `SifenNotImplementedError`. No `sifen_*` tables, no XML, no signing, no
   SET submission. §9 still blocks on `PLAN-SIFEN.md`. Marketing and plan
   copy must keep saying "próximamente".
2. **Custom fields have no UI.** `contacts.custom` (JSON) is written by nothing.
3. **Embedded signup is not wired.** Manual connect is the only path (§6.2 #1).
4. **Five trigger types have no label.** `booking_created/cancelled/no_show/
   completed` and `chat_lead_captured` are in `TRIGGER_TYPES` and the
   create-flow select, but `messages/*.json` names only six triggers. Fix in
   the first automation PR (J1 below).

### 15.1 Email — one platform account, per-tenant identity *(decision)*

**Decision: every tenant sends through the platform's one Resend account.
Tenants never bring their own Resend key.** A tenant that wants mail from its
own domain gets that domain verified *inside* the platform account (Resend's
Domains API supports many domains per account, each with its own DKIM and
reputation). Reasons: one secret to rotate, one bounce/complaint webhook, one
place to watch deliverability, and no support call that starts with "my
Resend account got suspended". A bring-your-own-provider option is an
**idea** only, for a client who contractually insists.

Three sending identities, resolved by one function `senderFor(ctx)`:

| Tier | From | Reply-To | Setup |
|---|---|---|---|
| **Default** (every tenant) | `Nombre del negocio <notificaciones@mail.clientes.com.py>` | tenant's own address | none |
| **Own domain** (premium, or any tenant that asks) | `Nombre del negocio <ventas@cliente.com.py>` | same | tenant adds 3 DNS records, app verifies |
| **Operator-assisted** | same as own domain | same | the owner does the DNS while impersonating, for clients who pay for it |

Notes that shape the build:

- **Use a dedicated sending subdomain for the default tier**
  (`mail.clientes.com.py`, not the apex). The marketing site's own mail and
  the platform's transactional mail must not share reputation with a
  tenant's booking reminders.
- **Own-domain flow** (`tenant_email_domains`: `domain`, `resend_domain_id`,
  `status: pending|verified|failed`, `dns_records` json, `verified_at`,
  `from_local_part`): admin types the domain → app calls
  `resend.domains.create` → shows the DKIM/SPF/DMARC records with a copy
  button → a `email.verify_domain` job polls `resend.domains.verify` every
  10 min for 72 h, then marks failed → once `verified`, `senderFor(ctx)`
  switches. Rate: Resend's plan limits are per account, so a per-tenant daily
  email cap belongs in `plans.limits` from day one (`maxEmailsPerDay`).
- **Where email is sent from** (all existing or planned): invites, password
  reset, task reminders, booking chain rung 3, subscription warnings, site
  alerts — plus the new surfaces in J3: quote/nota/contract delivery by email,
  and the `send_email` automation action. No email inbox, no marketing
  campaigns (review §1, "not doing").
- **Compliance**: every non-transactional email (automation-sent) carries an
  unsubscribe link that sets the same `optout` tag the WhatsApp keyword sets,
  so one flag governs both channels.

**J-batches for email**: J3 below.

### 15.2 The document family — what exists, what is code, what is the owner's

| Document | Status | Fiscal? | What it takes |
|---|---|---|---|
| Presupuesto (quote) | ✅ shipped (§8) | no | Online accept/reject is the missing half (J4) |
| Nota de venta | ✅ shipped (1Q) | no | — |
| Recibo (receipt for a payment) | **now**, small | no | Render from a `document_payments` row with the same `DocumentShell`; number `REC-`; public token + PDF; sent by WhatsApp/email |
| Contrato (contract) | **next** (J5) | no | New module `modules/contracts/`: tenant-editable templates with variables, generated per deal/quote, public page, click-to-accept with evidence record |
| Factura electrónica (SIFEN) | **later** (§9) | **yes** | Engine build is Opus work *after* `PLAN-SIFEN.md`; the owner's own list is below |

**Contracts (J5) — the shape.** A contract is a non-fiscal document, so it may
live beside quotes and notas and must obey the `schema/documents.ts` boundary
comment (no fiscal fields). Tables: `contract_templates` (tenant, name, body as
Markdown with `{{contacto.nombre}}`-style variables, clauses ordered),
`contracts` (tenant, template snapshot, contact, deal?, quote?, rendered body,
status `draft|sent|accepted|declined|voided`, `public_token`, `pdf_storage_key`),
`contract_acceptances` (name typed, timestamp, IP, user agent, SHA-256 of the
PDF shown, optional drawn-signature PNG in storage). Acceptance is a **firma
electrónica simple** under Ley 4017/2010 — evidentiary, not the certified
*firma digital*; the public page must say so in one line rather than imply a
notarised signature. Vertical presets ship one template each (contrato de
servicio, reserva de inmueble, orden de trabajo). Acceptance fires
`contract_accepted` (trigger) and can move the deal.

**Factura electrónica — the owner's side (nothing here is code):**
1. RUC active and the business enrolled in **Marangatu** with e-Kuatia access.
2. A **certificado de firma digital** from an accredited PSC (Documenta, eFirma
   or similar), issued to the emitting business — one per tenant that invoices.
3. **Timbrado electrónico** requested at the SET for the establishment/punto de
   expedición that will emit.
4. The **Manual Técnico** (current version) and the test-environment
   credentials; §9 notes this session's egress cannot fetch them, so they
   arrive from the owner's machine.
5. A tenant willing to run the **habilitación** test cycle (send test DEs,
   get them approved) before production.
Once 1–5 exist for the owner's own business, Fable writes `PLAN-SIFEN.md`
(persistence port, timbrado state machine, contingency) and Opus builds. The
first customer of the engine is VenderCRM's own subscription invoice.

### 15.3 The coach inside the system — three levels, then voice

The idea: the system tells the owner what to do today, in order, and can be
asked. Built in levels so each pays for itself before the next.

**L1 — "Hoy" panel, rule-based, no AI (now, J6).** A ranked list on the
dashboard, computed from data the tables already hold: conversations
unanswered > 1 h in business hours; deals in a stage past its threshold
(`stages.stale_after_days`, new column, preset per vertical); quotes sent 3+
days ago with no reply and no follow-up task; leads without a deal; bookings
tomorrow without a confirmed reminder; overdue tasks. Each row has the one
action (open thread, call, move, send template). The same list is the body
of the morning web push (J2) and of a WhatsApp template to the owner's own
number ("Tenés 4 cosas pendientes hoy"). Deterministic, testable, free.

**L2 — Weekly briefing, AI-written (next, J7).** Every Monday the worker
builds the week's numbers (reports module) and asks the configured AI driver
for a short narrative in voseo plus three recommendations, stored in a
`coach_briefings` table, shown on the dashboard and sent by WhatsApp
template + email. Uses the existing per-tenant AI caps and the same
`ai_replies` ledger for cost visibility.

**L3 — Conversational coach (later, J8).** A chat surface ("Asesor") where the
owner asks questions in plain Spanish and the model answers with read-only
tools over the tenant's data (`listStaleDeals`, `salesReport`, `openTasks`,
`findContact`). Tool calls are the only data access; the model never sees
raw tables. Text first; voice on top:

**Voice — two lanes, ranked by value for this market.**
- **Lane A — WhatsApp voice notes (now, small, J6b).** Inbound audio is
  already stored in R2. Transcribe it (Gemini or OpenAI audio, behind the
  existing driver seam) and show the text under the audio bubble in the
  inbox; the AI auto-reply can then answer voice notes. Paraguayan customers
  send audios constantly; a rep who reads instead of listening moves faster.
  Second half: the owner sends a voice note to the coach and gets the L1
  list back. Cost is bounded by the same daily caps.
- **Lane B — talk to the app (later).** In the PWA: push-to-talk with the
  browser's `SpeechRecognition` (free on Android Chrome; es-PY recognised as
  es-419), the answer read by `speechSynthesis` or a provider voice. Ships
  after L3 exists, because voice without a coach is a microphone.

### 15.4 WhatsApp connection — today's procedure and the better path

**What a tenant does today (manual connect, §6.2 #1).** One platform Meta app
serves every tenant; the webhook is configured once (docs/DEPLOY.md §4).
Per number:

1. The business needs a **Meta Business Manager** (business.facebook.com),
   ideally verified, and a phone number not currently on the WhatsApp
   Business *app* (moving a number to the Cloud API disconnects it from the
   phone app — §12 Q2; see coexistence below).
2. In Business Manager → WhatsApp Accounts: create or pick the **WABA**, add
   the phone number, verify it by SMS/call, set display name. Note the
   **WABA ID** and the **Phone number ID** (WhatsApp Manager → API setup).
3. Business Settings → Users → **System users**: create a system user
   (admin), assign the WABA asset with full control, **and assign the
   platform's Meta app** to it. This is the step that only works when the
   platform app is reachable from the client's business — for the owner's
   own business it is; for a third party it needs the partner sharing
   below.
4. Generate a **permanent token** for that system user with
   `whatsapp_business_messaging` + `whatsapp_business_management`.
5. In VenderCRM `/whatsapp`: paste WABA ID, Phone number ID, display number,
   token. The app encrypts the token (§3.4), enqueues template sync and the
   nightly chain, and the number is live; inbound routes by
   `phone_number_id` automatically.
6. Verify: send a template from the inbox; check `/whatsapp-health`
   (superadmin) for the account row.

Today this is done per tenant by the owner with the tenant on a call. It is
acceptable for hand-onboarded clients and wrong for self-serve.

**Interim path for third-party clients (no Tech Provider yet).** The client
shares their WABA with the platform business as a **partner** (Business
Settings → WhatsApp Accounts → Partners → add by Business ID), and the
platform's own system user then holds the token for that WABA and subscribes
the app to it (`POST /{waba-id}/subscribed_apps`). One system user, N
client WABAs, no client-side token handling. To verify against Meta's
current docs before writing it into `/whatsapp` as the recommended flow.

**The better path (1N, still gated).** **Embedded signup**: the client clicks
"Conectar WhatsApp", logs into Facebook, picks or creates the WABA and
number in Meta's own dialog, and the app exchanges the code for a token
server-side. Requires the platform's Meta Business verification and Tech
Provider approval (§6.1) — a calendar item the owner starts, not code. Two
things it unlocks that manual connect cannot: **coexistence** (since 2024
Meta lets a number stay on the WhatsApp Business app *and* use the Cloud
API, which removes the single biggest onboarding objection) and
**multi-number per tenant** in the inbox, which the schema already allows
and the UI does not (`getPrimaryAccount`). Build order: start verification
now → J9 when approved.

### 15.5 The batches

Tags: **now / next / later**. Model per batch follows §1.3.

**J1 — Automation library + trigger labels (now, Sonnet).** Triggers
`quote_sent`, `document_sent`, `document_paid`, `deal_won`, `deal_lost`,
`contract_accepted` (stub until J5); actions `create_task`, `notify_user`,
`send_email`; conditions on deal value, lead source, site. Fix the five
missing trigger labels. Per-run step log page from `flow_run_steps`.
*Exit:* a flow "quote sent → wait 3 days → no reply → template" runs end to
end in the integration suite; every `TRIGGER_TYPES` entry has a label in
all three locales (extend the parity test to assert it).

**J2 — Inbox ergonomics + web push (now, Opus for push, Sonnet for inbox).**
Quick replies with variables, internal notes, filters mine/unassigned/unread,
message search, web-chat rows in the same list with a channel chip. Service
worker + VAPID + `push_subscriptions` + `push.send` job; fired on inbound
message, assignment, task due, `notify_user`, and the L1 morning list.
*Exit:* an installed PWA on Android receives a push within 10 s of an
inbound message; opt-out on manual sends shows a confirm.

**J3 — Email identity + delivery surfaces (now, Sonnet).** §15.1: sending
subdomain, `senderFor(ctx)`, `tenant_email_domains` with the DNS panel and
verify job, `maxEmailsPerDay` limit, "enviar por email" on quotes, notas and
bookings, unsubscribe link → `optout`. *Exit:* a tenant with a verified
domain sends a quote from its own address; an unverified one from the
default; both logged on the timeline.

**J4 — Pipeline polish, custom fields, online quote accept (now, Sonnet).**
Column value totals, stale badge from `stages.stale_after_days`, expected
close date, lost reason field; custom field definitions with UI, import,
export, filters and template variables; accept/reject on the public quote
page with `quote_accepted` trigger. Reopens the §11 "client-side quote
acceptance" deferral on purpose.

**J5 — Contracts + receipts (next, Sonnet).** §15.2 shape. *Exit:* a
service contract generated from a won deal, accepted on a phone, PDF with
the acceptance record in storage, deal moved by the trigger.

**J6 — "Hoy" panel + voice-note transcription (now, Sonnet; J6b Opus for the
audio driver).** §15.3 L1 and Lane A.

**J7 — Weekly AI briefing (next, Sonnet).** §15.3 L2.

**J8 — Conversational coach, text then voice (later, Opus).** §15.3 L3 and
Lane B. Prerequisite: J6 and J7 in use for a month so the tools are the
questions people actually asked.

**J9 — Embedded signup + multi-number inbox (later, Opus).** Gated on Meta
approval (§15.4).

**J10 — Template campaigns to a saved view (next, Opus; Fable spec paragraph
first).** Paced through the jobs table, opt-out aware, per-tenant daily cap,
quality-rating check before each batch. Reopens §11's "broadcast" deferral
deliberately, with the compliance rules written before the code.

**J11 — Reporting v2, forms field editor, companies + merge (next, Sonnet).**
From the review's "next" list; three separate PRs.

**J12 — Corrections (now, Sonnet, one PR).** Quote auto-expiry job; contact
list pagination and filters in SQL; opt-out respected on manual sends.

### 15.6 Idea parking lot (not scheduled; keep adding here)

- Payment link on the nota de venta (Bancard / Pagopar) with a webhook that
  records the payment and fires `document_paid`.
- Instagram and Messenger DMs in the same inbox (same Meta app, channel column).
- Bring-your-own email provider for a client who insists contractually.
- GBP reviews pulled into the CRM, AI-drafted replies (1P).
- Self-serve signup, trial, gateway billing — when hand-renewal stops scaling.
- Client portal: one link where a customer sees their quotes, contracts,
  notas, receipts and bookings (the public token pages, grouped).
- Recurring appointments and a day view in the agenda.
- Lift the worker into its own process on a VPS when the 2-second tick shows.

### 15.7 What the owner decides before the batches start

1. Sending subdomain name and whether "own domain email" is a premium tier or
   included.
2. Start Meta Business verification + Tech Provider request now (weeks of
   lead time; nothing in J1–J8 waits on it).
3. Which AI provider handles audio transcription (Gemini and OpenAI both fit
   the driver seam; pick by price per minute).
4. The SIFEN prerequisites list in §15.2 for the owner's own business first.
5. Whether contracts ship with a drawn signature or click-to-accept only
   (click-to-accept is enough legally for a firma electrónica simple and is
   simpler on a phone).

### 15.8 Build wave 1 — phase table and prompts

The "now" batches of §15.5 as one phased, autonomous build (method: the
`phased-autonomous-build` skill; autonomy protocol = `plan-booking.md` §4,
which already governs this repo's phase prompts). Lane 1 is sequential Opus,
because P1 and P2 create things every other phase calls. Lane 2 is Sonnet in
parallel, file-disjoint by the **Owns** column. The link pass holds every
cross-cutting edit. Fable is never a build model (§4.8 of that protocol).

| Phase | §15.5 | Lane | Model | Prompt | Owns | Depends on |
|---|---|---|---|---|---|---|
| P1 Automation library | J1 | 1 | Opus | `prompts/opus-p1-automation-library.md` | `src/modules/automations/**`, `src/modules/quotes/events.ts`, `src/modules/documents/events.ts`, emit lines in `quotes/delivery.ts`, `documents/delivery.ts`, `documents/documents.ts`, `src/db/schema/automations.ts`, `src/db/schema/notifications.ts` (new), migration, `src/app/(app)/automations/**`, automation keys in `messages/*` | — |
| P2 Web push + notifications | J2 (push) | 1 | Opus | `prompts/opus-p2-web-push.md` | `src/modules/notifications/**` (new), `public/sw.js`, `src/app/manifest.ts`, `src/components/push-*`, `src/app/api/push/**`, push keys in `messages/*` | P1 |
| P3 Inbox ergonomics | J2 (inbox) + J12c | 2 | Sonnet | `prompts/sonnet-p3-inbox.md` | `src/modules/whatsapp/inbox*.ts`, `src/modules/whatsapp/quick-replies.ts` (new), `src/modules/whatsapp/notes.ts` (new), `src/app/(app)/inbox/**`, `src/app/api/inbox/**`, inbox keys | P2 |
| P4 Email identity | J3 | 2 | Sonnet | `prompts/sonnet-p4-email-identity.md` | `src/lib/email/**`, `src/modules/tenancy/email-domains.ts` (new), `src/db/schema/email.ts` (new), migration, settings page email section, `src/app/(app)/settings/EmailDomain*.tsx`, "enviar por email" buttons on quote/document/booking detail pages, email keys | P1 |
| P5 Pipeline + custom fields | J4a + J12b | 2 | Sonnet | `prompts/sonnet-p5-pipeline-custom-fields.md` | `src/modules/crm/**` (except events.ts), `src/db/schema/crm.ts` additive columns + `custom_field_definitions` table, migration, `src/app/(app)/pipeline/**`, `src/app/(app)/contacts/**`, crm keys | P1 |
| P6 Quote accept + receipts | J4b + recibo + J12a | 2 | Sonnet | `prompts/sonnet-p6-quote-accept-receipts.md` | `src/modules/quotes/**` (except events.ts), `src/modules/documents/receipts.ts` (new), `src/app/(public)/q/**`, `src/app/(app)/quotes/**`, receipt PDF/public page files, quote/receipt keys | P1 |
| P7 "Hoy" panel | J6 (L1) | 2 | Sonnet | `prompts/sonnet-p7-hoy-panel.md` | `src/modules/dashboard/**`, `src/modules/coach/**` (new), `src/app/(app)/dashboard/**`, dashboard keys | P2 |
| P8 Link pass | — | — | Sonnet | `prompts/sonnet-p8-link-pass.md` | nav, dashboard checklist rows, `docs/HANDOFF.md`, `KNOWN-ISSUES.md`, §15.9 index | all |

Wave 2 (prompts written when wave 1 has merged): J5 contracts, J6b voice
notes, J7 weekly briefing, J10 campaigns (after a Fable spec paragraph),
J11 reporting v2 / forms editor / companies, J9 embedded signup (after Meta).

Shared conventions every phase repeats (from docs/HANDOFF.md): services take
`TenantContext` first and reach the DB only through `tenantDb`; zod in every
server action; destructive actions are `requireTenantAdmin()` +
`writeAuditLog`; every user-facing string through next-intl in
`messages/es|en|sv.json` (parity test); tests beside the module; no MySQL in
the container, so integration suites run only in CI; run `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build` locally before every push.

### 15.9 Wave 1 build log index

One line per phase when merged: phase, PR, `docs/log/<phase>.md`.

---

## 16. Business memory and the AI setup assistant (Fable spec, 2026-09-05)

> **Authored by Fable 5.1** from the owner's request: "AI should set up new
> accounts with the pipeline, auto replies etc. that make sense for the
> business, and we should be able to enter all business data / FAQ / opening
> hours in a saved memory per business that AI responses and setup can use."
> Same conventions as §13–§15. Nothing here reopens a §1.2 decision. The one
> load-bearing rule is inherited from the vertical presets and restated in
> §16.2: **the AI produces data in the preset shape; it never produces code
> paths or bypasses the existing apply function.**

### 16.1 What it is

Two things that share one foundation:

1. **Memoria del negocio** — one structured, per-tenant record of everything
   a good employee knows on day one: what the business is, how it talks,
   opening hours, address, services and prices, policies (señas, cancelación,
   pagos, garantía), FAQs, promos with dates, and internal notes that must
   never reach a customer. Today this exists as five free-text fields in
   `settings.ai` (`businessName`, `about`, `tone`, `hours`, `neverPromise`)
   plus `businessHours` and branding, all read by `resolveAiConfig`. The
   memory replaces those five fields and becomes the **single source** for
   AI replies (WhatsApp and widget), the setup assistant, template
   variables, public pages and, later, the coach (§15.3).
2. **Asistente de configuración** — a conversation on first login (and
   re-runnable from settings, and available to the superadmin when creating
   a tenant) that fills the memory by asking, then proposes a complete setup
   for that business — pipeline stages, tags, booking types, quick replies,
   automation flows, AI reply mode, business hours, widget copy — shows it as
   a preview and applies it on confirm through the same machinery the
   vertical presets already use.

Why it matters commercially: the marketing ladder's "Puesta en orden" tier
(docs/MARKETING_NEXT_STEPS.md) is exactly this setup, sold as a service.
With the assistant the owner onboards a client in one call instead of an
afternoon, and the client can keep the memory current without a ticket.

### 16.2 Locked design rules

1. **Memory is structured, not a blob.** Typed facts with a kind, so the
   prompt builder can pick what a given reply needs and so the UI can show
   "you have no cancellation policy" as a checklist row.
2. **The AI suggests, a human confirms.** Facts the AI extracts from a pasted
   text, a PDF or a website land as `source: ai_suggested, confirmed_at: null`
   and are not used in prompts until an admin confirms them. The setup plan
   is a preview until the admin taps "Aplicar". Nothing the assistant does is
   invisible.
3. **Setup output is a preset.** The assistant's plan is a `VerticalPreset`
   (`modules/tenancy/verticals.ts`) — the same zod-validated data shape the
   catalogue uses — applied by `applyVerticalPreset`, idempotent by name,
   never removing anything. Where the shape lacks a field the assistant
   needs (tags, quick replies, more flow triggers), the **shape** is extended
   as data; no per-vertical or per-tenant code path is ever added.
4. **Retrieval without a vector database.** Hostinger MySQL 8 supports
   `FULLTEXT` indexes; FAQs and services are retrieved with
   `MATCH … AGAINST` in natural-language mode against the customer's last
   message, within a fixed token budget. Profile, hours and policies are
   always included. Embeddings are an **idea** for later, not a prerequisite.
5. **Internal never leaks.** `visibility: internal` facts are excluded from
   every customer-facing prompt at the query, not by prompt instruction.
6. **Existing caps apply.** Extraction and setup generation run through the
   same driver, the same `ai_replies` ledger (new `kind` values) and the same
   per-tenant daily caps. A setup conversation costs a few calls, not a
   budget.
7. **Audit.** Confirming, editing or deleting a fact and applying a plan write
   `writeAuditLog` entries; the plan's preview JSON is stored with the apply.

### 16.3 Data model

`business_profiles` (one row per tenant): `tenant_id` unique, `display_name`,
`legal_name`, `ruc`, `vertical_slug` (preset applied, if any), `about`,
`tone` (enum: cercano | formal | directo, plus free note), `audience`,
`differentiators`, `languages` (json, default `["es"]`), `website`,
`address`, `maps_url`, `never_promise`, `payment_methods` (json),
`updated_at`, `completed_pct` (derived, cached).

`business_facts`: `id`, `tenant_id`, `kind` enum
`faq | service | policy | location | contact | promo | note`, `title`,
`body` (text), `structured` json (per kind: service → `{price, priceFrom,
durationMinutes, bookingTypeId?}`; promo → `{validFrom, validUntil}`;
policy → `{topic: cancellation|deposit|payment|warranty|other}`), `tags`
json, `visibility` enum `customer | internal`, `source` enum
`manual | imported | ai_suggested`, `confirmed_at`, `confirmed_by_user_id`,
`review_after`, `created_at`, `updated_at`. Indexes: `(tenant_id, kind)`,
`(tenant_id, visibility, confirmed_at)`, **FULLTEXT `(title, body)`**.

`memory_imports`: `id`, `tenant_id`, `source_kind` enum `text | pdf | url`,
`source_ref` (storage key or URL), `status` `pending | extracted | reviewed
| failed`, `extracted_count`, `ai_reply_id` (ledger link), `created_by`,
`created_at`.

`setup_plans`: `id`, `tenant_id`, `status` `draft | applied | discarded`,
`brief` (the conversation summary the plan was built from), `preset` json
(the validated `VerticalPreset`), `outcome` json (`ApplyOutcome`),
`created_by`, `applied_at`. Keeping the plan is what makes "what did the AI
set up?" answerable later.

Migration: copy `settings.ai.businessName/about/tone/hours/neverPromise`
into `business_profiles` (hours → `businessHours` already structured; the
free-text `hours` becomes a `location`-kind fact titled "Horario"), leave
the old keys readable for one release, then drop them from the settings
type.

### 16.4 Where the memory is read

| Consumer | What it takes | How |
|---|---|---|
| WhatsApp AI reply (`modules/ai/reply.ts`) | profile + hours + policies always; top-k FAQs/services by FULLTEXT against the last inbound message; promos in date | `buildMemoryContext(ctx, {query, budgetTokens})` replaces the five fields in `BusinessContext` |
| Chat widget reply | same, per-widget overrides stay on top | same helper |
| Setup assistant | everything, including internal | the brief |
| Template variables | `{{negocio.nombre}}`, `{{negocio.horario}}`, `{{negocio.direccion}}`, `{{negocio.politica.cancelacion}}` | resolver added to the variable registry from §15.8 P1/P5 |
| Public booking page, quote/nota PDF footer | address, maps link, payment methods, deposit policy | read at render |
| Coach L1 (§15.3) | "memoria incompleta" and "hechos vencidos" rows | `completed_pct`, `review_after`, promo dates |

### 16.5 The setup assistant, step by step

1. **Entry points**: first login of a tenant with no applied plan (replaces the
   current `/onboarding` rubro picker as the default; the picker stays as
   "elegir un rubro sin el asistente"); `/settings/negocio → Reconfigurar con
   el asistente`; superadmin tenant detail → "Configurar con IA" (runs as an
   impersonation, so audit and caps are the tenant's).
2. **Conversation**: the assistant asks in voseo, one topic at a time, in this
   order — qué hacés y para quién; cómo te contactan hoy; horario y dirección;
   servicios y precios (or "prefiero cargarlos después"); señas/cancelación/
   pagos; las 5 preguntas que más te hacen; cómo querés que hable el asistente;
   qué no debe prometer nunca. Each answer is written to the memory as
   confirmed facts (the admin typed them) — the conversation *is* the form.
   A "saltar" on any step is allowed; the checklist shows what is missing.
   Text first; the voice lane (§15.3) plugs in here later.
3. **Plan generation**: one JSON-mode call with the memory as input and the
   catalogue's preset shape as the output schema (`generateStructured` on the
   driver, zod-validated, one retry on invalid). The model may start from the
   closest catalogue preset and adapt names, stages and copy to the business;
   prices stay `null` unless the memory has them. The plan includes:
   pipeline stages (5–7, one won, one lost), tags, booking types (if the
   business takes appointments), 3–5 quick replies, flows (welcome on first
   inbound message outside hours; no-reply follow-up after 2 days; review
   request on won/completed; booking reminders are already the chain's), AI
   reply mode `draft`, business hours, widget welcome copy.
4. **Preview**: the existing onboarding preview component, extended for the
   new preset fields: "Esto es lo que voy a crear — y nada de lo que ya tenés
   se borra".
5. **Apply**: `applyVerticalPreset` with the plan's preset; `setup_plans` row
   updated with the outcome; audit entry; dashboard checklist items flip.
6. **After**: the memory page shows the completion percentage and the coach
   nags about gaps. Re-running the assistant later produces a new plan that
   is applied idempotently by name (existing rows untouched, new ones added).

Preset shape extensions (data only, in `verticals.ts` + zod):
`tags: string[]`, `quickReplies: {name, body}[]`, `PresetFlow.trigger` widened
to `wa_message_received | lead_received | deal_won | booking_no_show |
booking_completed`, `PresetFlow.conditions?: ["outside_business_hours"]`,
`stages` with `staleAfterDays`, `aiMode: "draft"`, `widget?: {welcome, capture
AfterMessages}`. `verticals-apply.ts` grows one apply step per new field, each
idempotent by name, each covered by the existing apply integration test
pattern.

### 16.6 Phases (wave K — can run beside the P-wave)

K1 and K2 own files the P-wave does not touch (new module, new routes,
`lib/ai/**`, `modules/ai/**`); they may run in parallel with §15.8. K3 needs
P1/P5's variable registry and P7's coach module, so it runs after P8.

| Phase | Lane | Model | Prompt | Owns | Depends on |
|---|---|---|---|---|---|
| K1 Business memory | 1 | Opus | `prompts/opus-k1-business-memory.md` | `src/modules/memory/**` (new), `src/db/schema/memory.ts` + migration, `src/lib/ai/prompt.ts`, `src/lib/ai/types.ts` (+`generateStructured`), `src/lib/ai/openai.ts`, `src/lib/ai/gemini.ts`, `src/modules/ai/config.ts`, `src/modules/ai/reply.ts` context call, `src/modules/chatwidget/reply.ts` context call, `src/app/(app)/settings/negocio/**` (new route), memory keys in `messages/*` | — |
| K2 Setup assistant | 1 | Opus | `prompts/opus-k2-setup-assistant.md` | `src/modules/setup/**` (new), `src/modules/tenancy/verticals.ts` + `verticals-apply.ts` (shape extensions), `src/app/(app)/onboarding/**`, `src/app/(superadmin)/tenants/[id]/SetupWithAi*`, setup keys | K1 |
| K3 Imports, variables, coach rows | 2 | Sonnet | `prompts/sonnet-k3-memory-imports.md` | `src/modules/memory/imports.ts` (new), `src/app/(app)/settings/negocio/importar/**`, variable resolver registration, coach rules file, public page/PDF reads, keys | K2, P8 |

### 16.7 Owner decisions (none block K1)

1. Whether the assistant is offered to every tenant on first login or only
   run by the owner during "Puesta en orden" (default in the spec: every
   tenant, because the memory is what makes AI replies good, and the plan is
   preview-then-apply).
2. Which AI driver handles JSON-mode setup generation (OpenAI and Gemini both
   support structured output; K1 implements it on both).
3. Whether PDF import is in K3 or parked (spec: in, using the storage driver
   and a text extractor; a scanned PDF without text is reported, not OCR'd).

### 16.8 Wave K build log index

One line per phase when merged: phase, PR, `docs/log/<phase>.md`.
