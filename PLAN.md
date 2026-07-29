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
| Tenancy | Multi-tenant, single app: **superadmin** role manages all tenants; per-tenant logins with fully isolated data. |
| Sites per tenant | **One tenant owns many sites.** The owner's whole lead-gen network is a single tenant with N `sites` rows; leads share one pipeline and carry `site_id` for filtering/attribution. Never one-tenant-per-site (§5.1). |
| Lead ingest | **Server-to-server only**: the site's own backend POSTs to `/api/v1/leads` with `X-Api-Key`. Never from the browser. Hosted form pages stay available for sites with no backend. |
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
    tenancy/  auth/  crm/  forms/  inbox/  whatsapp/  automations/
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

Users belong to **exactly one tenant** (`users.tenant_id`, nullable only for
superadmins). No cross-tenant membership in Phase 1 — simpler and matches the market.

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
- `users` — tenant_id (nullable), email, name, role (`admin|agent|superadmin` — the third value exists only for the Better Auth admin-plugin gate, see §3.2), is_superadmin, Better Auth fields
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
for all Paraguay leads" work *without* cross-tenant membership — §3.1 stays exactly as
it is. One-tenant-per-site would force the owner through superadmin impersonation to
see their own leads, which is unusable daily.

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

## Phase 3 — marketing features (placeholder only)

Website builder, Google Business Profile, social automation, ad tools — likely sold
as manual services or routed through existing external tools, probably not built in
this repo. **No Phase 1/2 architecture anticipates this**; nothing blocks it either
(tenancy, auth, and the module pattern are reusable if any of it lands here).

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

### Build status (updated 2026-07-29)

**1A–1H are built and merged to `main`.** CI is green on the full suite: 11 files /
70 tests, run against a real MySQL 8 service with migrations applied — the §3.3 layer-3
cross-tenant isolation merge gate passes, as do the WhatsApp webhook, lead ingest,
quote-numbering, automation-engine and worker integration suites. `lint`, `typecheck`
and `next build` pass.

All *code* for Phase 1 is done. 1H's exit criteria are **not** met yet, because both
remaining items are owner actions, not build work:

- **Production deploy on Hostinger** — runbook is `docs/DEPLOY.md`; needs the env vars
  in §1 of that doc, a Meta webhook pointed at `/api/webhooks/whatsapp` (§4), and the
  cron pinger (§5).
- **Owner's team onboarded** — needs a superadmin (`scripts/create-superadmin.ts`) and
  the real tenant seeded (`scripts/seed-tenant.ts`).

Known gaps deliberately left in place, none blocking launch:

- `deals.assigned_user_id` and `conversations.assigned_user_id` exist in the schema and
  are read/written by `modules/crm/deals.ts` and `modules/whatsapp/inbox.ts`, and the
  `assign_user` automation action sets them — but **no UI assigns them by hand**. A rep
  can't be given a lead from the pipeline screen yet; only a flow can assign.
- The `s3` storage driver throws at boot (`src/lib/storage/index.ts`); `local` is the
  only working driver. Fine for one tenant, must be written before external ones.
- Round-robin assignment is specified in §7.1 but only "specific user" is implemented.

### Session estimate

| Milestone | Sessions (cumulative) |
|---|---|
| GHL-replacement milestone (1A–1E) | **~17** |
| Internal-tool milestone (1A–1F) | **~19** |
| Full Phase 1 (through 1H) | **~26** |

Estimates assume focused build sessions against this spec; Fable review gates (after
1B, 1D, 1G) are separate short sessions, not counted above.

---

## 11. Deferred / explicitly out of Phase 1

Payment gateway (Bancard/Pagopar), monthly billing, client-side quote acceptance,
websockets/SSE realtime, multi-tenant users (one user in many tenants), Guaraní/English
locales (i18n layer is ready), WhatsApp broadcast/bulk campaigns (compliance-sensitive —
revisit deliberately), mobile apps, SIFEN anything (Phase 2), all Phase 3 marketing
features. *(“Public API” is no longer deferred in full: 1E ships a deliberately narrow
one — lead ingest only, not a general CRUD API.)*

**GHL capabilities this deliberately does not replace in Phase 1.** Listed so the cutover
is planned, not discovered:

| GHL feature | Status here | Cheapest path when needed |
|---|---|---|
| Workflows / automations | **Replaced in 1G** (visual flow builder) | — |
| WhatsApp inbox + templates | **Replaced in 1D** ✅ | — |
| Lead capture from sites | **Replaced in 1E** | — |
| Transactional/marketing **email** | Not built | Resend or Postmark + own domain warmup — you now own deliverability |
| **SMS** | Not built | Twilio; Paraguay SMS pricing is poor and WhatsApp is the stronger channel anyway |
| **Booking / calendar** | Not built | Cal.com self-hosted |
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
   Without it the honeypot alone carries spam defense.
9. **Email**: is any current GHL email flow load-bearing for the Paraguay sites? If yes,
   §11's email gap needs scheduling; if it's WhatsApp-only follow-up, it doesn't.

*Answered 2026-07-29 (from the built code, not a decision):*

4. **Object storage** — **not needed to launch.** The `s3` driver isn't written; it
   throws at boot, so selecting it would take the app down (`src/lib/storage/index.ts`).
   `local`'s only cost today is that stored quote PDFs don't survive a redeploy, and the
   public quote route re-renders them on demand, so nothing is lost. The question becomes
   live when the S3 driver is written, i.e. before external tenants.
8. **Turnstile** — still open, and still *site-side*: §5.1 puts it on each connected
   site's own form handler, not in this app. No VenderCRM env var, no credential here.

---

## 13. Post-Phase-1 owner requests (raised 2026-07-29) — **pending Fable spec**

Recorded here so they aren't lost, and deliberately **not specced as architecture** —
per the header rule, a build model flags gaps rather than improvising the design. Each
item below states what exists today, what's genuinely missing, and the shape of the
decision Fable needs to make. Sizes are rough and assume the existing module/job
patterns are reused.

**None of these are Phase 2 (SIFEN).** If they're wanted first, they form a *Phase 1.5*
that delays SIFEN — that ordering is the owner's call, not a technical constraint.

### 13.1 WhatsApp auto-reply — **already built, no work needed**

Worth stating plainly because it was asked as if missing: the 1G flow builder already
does this. Trigger `wa_message_received` (with optional keyword match) → action
`send_whatsapp`. Build the flow in `/automations`, publish it, done. The engine's guards
(§7.2) already cover the things that make naive autoresponders dangerous: one run per
contact per flow, `optout` tag honored on every send (auto-applied on inbound
*BAJA*/*STOP*), and the 24-hour-window rule — outside the window only approved templates
can be sent, which the send action enforces rather than silently failing.

### 13.2 AI-generated WhatsApp replies — **new, needs a spec**

Not built, and the interesting problems are policy, not plumbing. The mechanical part is
small: one new action node (`ai_reply`) calling an LLM with conversation history, reusing
the existing job/retry infrastructure. What Fable needs to rule on:

- **Autonomy.** Fully automatic sends, or draft-for-approval in the inbox? Draft-first is
  strongly the safer default for a Paraguayan sales team whose WhatsApp number is their
  business — a hallucinated price or commitment is a real liability, and WhatsApp numbers
  get quality-rated and can be restricted by Meta on user blocks/reports.
- **Grounding.** Which tenant data is in scope (products/catalog, business hours, quote
  totals) and how it's fetched. Ungrounded replies about price or availability are the
  main failure mode.
- **Per-tenant config + cost.** Prompt/persona per tenant, spend caps, and whether the
  platform holds one API key or each tenant supplies theirs. This is the first
  *usage-metered* cost in a prepay-only billing model (§1.2) — plans currently have no
  concept of variable cost per tenant, so this touches billing.
- **Secrets.** Per-tenant keys go through §3.4 (AES-256-GCM), same as WhatsApp tokens.

Size: ~1 session for a draft-only version reusing 1G; more if autonomous sending, spend
metering, and billing changes are in scope.

### 13.3 Embeddable chat widget (the GHL-style snippet) — **new, needs a spec**

Not built, and it collides with a locked decision, so it needs an explicit ruling rather
than a build. §1.2 locks lead ingest to **server-to-server only, never from the browser**,
and §5.1 states the UTM snippet is "the only client-side code this project ships." A chat
widget is by definition browser-side and unauthenticated, so it is exactly the shape that
decision excluded.

That doesn't make it wrong to build — it makes it a decision to reopen deliberately. What
it would need beyond the widget itself: a public write endpoint that can't be used to
enumerate or spam a tenant (the current `checkRateLimit` is process-local in-memory, sound
only because Hostinger runs one process — a public chat endpoint is the point where that
becomes insufficient and needs to move to MySQL), an origin allowlist per site, a
visitor→contact identity model for people who haven't given a phone number yet (today
`contacts.phone` *is* identity, §5), and live agent delivery without websockets (§11
defers realtime; polling is the honest Phase 1 answer).

Note this is a genuinely different product surface from WhatsApp — a website visitor
chatting anonymously is not a WhatsApp contact, and merging the two inboxes is most of
the work.

Size: ~2–3 sessions, and it should not be started before the rate-limiter move.

### 13.4 Email — **new, needs a spec; explicitly not MVP**

§11 already flags this as a known GHL capability this repo doesn't replace, with Resend or
Postmark as the cheapest path. Two things the owner asked that are worth settling now:

- **A Google Workspace account is not a substitute.** Workspace is for humans reading and
  writing mail. Sending application email through it hits low sending limits, poor
  deliverability for bulk/transactional traffic, and no webhooks for bounces/opens. Use a
  transactional provider (Resend/Postmark) for app-sent mail; Workspace can stay as the
  team's own mailbox and receive replies.
- **Yes, it costs money, but not much at this scale.** Both have free/low tiers that
  comfortably cover transactional volume; the real cost is a domain plus the discipline of
  SPF/DKIM/DMARC and warmup. Deliverability becomes the owner's responsibility, which is
  the actual reason §11 called this out — it's ongoing operational work, not a one-off
  integration.

Size: ~1 session for transactional send (invites, quote delivery) behind an adapter, in
the same shape as `lib/storage`. Marketing/bulk email is a different, larger scope and
should not be bundled in.

### 13.5 Per-user access to specific leads — **collides with a locked decision**

Asked as part of "use it as SaaS and give access to specific accounts/leads." Two
different things are bundled there, and only one exists:

- **Superadmin controls tenants, tenants are fully isolated** — built (1B), and this is
  the SaaS control plane. `/tenants` creates/suspends, plans and payments are recorded,
  "ver como" impersonates, every impersonated action lands in `audit_log`.
- **Restricting a *user* to only certain contacts/leads inside one tenant** — **not
  built, and locked against.** §1.2: "all tenant users see all contacts/deals; deals &
  conversations assignable to a rep." Assignment is about *ownership*, not *visibility*.

If the owner wants true per-rep visibility limits, that reopens a locked decision and
changes the isolation story: §3.3's `tenantDb(ctx)` injects `tenant_id` only, so a second
scoping dimension has to be added at the same layer to be trustworthy, and the layer-3
isolation suite needs a matching set of per-user cases. This is a load-bearing change —
Opus work with a Fable review gate, not an incremental feature.

Cheaper interim step that doesn't touch the isolation layer: build the **missing
assignment UI** (see §10 build status) plus "assigned to me" filters on the pipeline and
inbox. That delivers most of the day-to-day benefit — reps working their own leads —
without weakening the guarantee that `tenant_id` is the one and only scope.
