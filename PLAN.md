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

### 1L — Feedback & polish *(partially done — see below)*
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

**Not done** — deferred, still open for whoever picks up next:
- Inbox 5s revalidation (§6.5) — the inbox is still load-once, no polling.
- Pipeline switcher for tenants with more than one pipeline (the page still
  hard-picks `pipelines[0]`).

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

### 1Q — Non-fiscal documents: notas de venta *(owner request)* — 🟡 engine done & merged; UI is 1R #2

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

**Not done — the Sonnet half**: the in-app UI (documents list, builder,
detail with the payment ledger, "convertir presupuesto", nav entry, i18n
strings). The engine is callable and tested; nothing renders it inside the
app yet.

### 1R — Daily-driver readiness *(Sonnet; the owner's own dogfooding run)* — ⏭ next

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

   **One leftover in the same area, pre-existing and not touched here**: on
   a rejected submit the contact `<select>` loses its selection — React
   resets the uncontrolled field once the action resolves, and unlike the
   `defaultValue` inputs the echo doesn't take on a `<select>` — so a second
   submit fails on `contactRequired` first. The line items themselves are
   React state and do survive.

   Actions reachable only from a hidden id (issue/send/suspend/toggle) were
   converted to `safeParse` + silent return rather than given form state:
   there is no user-fillable field for an error to sit under. Forms outside
   this pass still throw — `(superadmin)/tenants/[id]` (subscription,
   payment, impersonate), `users`, `inbox`, and the quote status actions.

**Operator tasks, not code** — these gate putting real client leads in, and
none of them are done:
- **Verify MySQL backups actually restore.** 1H listed backup verification;
  it has never been exercised. Restore into a scratch database and check row
  counts before a real lead depends on it.
- **1K's live R2 smoke test** — put a key, read it back, sign a URL. Until
  then `STORAGE_DRIVER=local` means WhatsApp media and quote/document PDFs
  sit on Hostinger disk, which §2.1 says to treat as non-durable.
- **Deploy and migrate**: 1O and 1Q add migrations `0010` and `0011`.

**Exit**: the owner runs a full day — leads arriving from a live site into
the right pipeline, WhatsApp follow-up in a self-refreshing inbox, a nota de
venta issued and paid — without opening a terminal or another tab.

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
| Feedback & polish (1L) | — partial, see §10 1L |
| Transactional email (1M) | — ✅ done |
| Sellable as SaaS (through 1N) | **~37** — 1N still blocked on Meta approval |
| AI auto-reply (1O) | **~40** — ✅ done, merged |
| Notas de venta engine (1Q) | — ✅ engine done, merged; UI is 1R |
| Daily-driver readiness (1R) | ⏭ **next up, Sonnet** — the owner's dogfooding run |
| Google Business Profile (1P) | unscheduled |

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
