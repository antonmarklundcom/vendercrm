# PLAN-PROSPECTING — Sales prospecting + rank & rent in VenderCRM

Status: R1 (this plan) approved by Anton, 2026-09-29. R2–R6 not started.
Written by Opus 5.5 after reading the code on `main` at b2b23b2.
Build prompts: `prompts/opus-r2-prospecting-mvp.md`, `prompts/sonnet-r3-goals-money.md`,
`prompts/opus-r4-ai-laptop.md`, `prompts/sonnet-r5-places-finder.md`,
`prompts/sonnet-r6-site-leads.md`.

**Rule for every R phase:** one PR per phase, merged green, then **stop and report
to Anton**. Do not start the next phase until he says so. Spawn no sessions.
Never Fable.

---

## 0. Summary

Anton owns local lead-generation sites in Paraguay (pozo.com.py, dentista.com.py,
ecografia.com.py, more coming). The sites rank on Google and produce leads. His
team sells those leads to local businesses: per lead, per sale, a monthly fee, or
exclusive per city. This plan adds what the team needs to **find, contact and
close** those businesses, and later to **route site leads to the paying client**.

The main user is a non-technical seller on an Android phone, working in Spanish.
The app must give her a clear list for today, one tap to call or WhatsApp, and
visible progress.

Two per-tenant modules, both off by default. Existing customers see nothing new.

| Module | Who | Contents |
|---|---|---|
| `prospecting` | Any small-business sales team. Can be sold as part of VenderCRM | Hoy call queue, prospect profile, import with undo, goals/streaks, seller earnings, AI sorting, business finder |
| `rankAndRent` | Anton's own tenant | Sites for rent, client agreements (per lead / per sale / monthly), lead forwarding, client reports |

Phases:

| Phase | Content | Model (effort) |
|---|---|---|
| R1 | This plan | Opus 5.5 (done) |
| R2 | MVP: modules, visibility, prospects, Hoy + outcomes, CSV/XLSX import with undo, offline outbox, PWA share | Opus 5.5 (medium) |
| R3 | Goals, streaks, celebrations, client agreements + monthly charges, seller earnings, admin sales panel, leaderboard | Sonnet 5.5 (medium) |
| R4 | AI: provider layer, laptop batch runner (Ollama), optional cloud, 4 AI jobs + embeddings, JSON/vCard/paste import | Opus 5.5 (medium) |
| R5 | Google Places finder, website enrichment, weekly searches, Google-data retention | Sonnet 5.5 (medium) |
| R6 | Site leads: forward mode, routing to the client, per-lead billing counts, monthly client report | Sonnet 5.5 (medium) |

Why this model split:
- **Opus** gets R2 and R4. R2's visibility scoping touches every read path and is a security boundary, and the offline replay has to be idempotent. R4 designs a protocol between the server and a laptop, plus prompts.
- **Sonnet** gets R3, R5 and R6, which are well-specified CRUD, UI and one external API each, following patterns that already exist in the repo.
- **High effort** only if medium fails the same exit criterion twice, and only after asking Anton.

---

## 1. Principles (non-negotiable)

1. **Everything is off by default.** With both module flags off, the app behaves exactly as today. Each phase adds a test proving it.
2. **Every new table carries `tenant_id`** and is read and written only through `tenantDb(ctx)`. Isolation tests are required: tenant A never sees tenant B, and seller A never sees seller B when visibility is `own`.
3. **Sellers never wait for AI.** Every screen works with AI off. AI results arrive in the background and are shown as "IA pendiente" until then.
4. **Contact is always manual.** A tap opens `tel:` or `wa.me` on her own phone. There is no bulk WhatsApp, no automated first contact and no bought lists. The WhatsApp Cloud API is used only for R6 forwarding to paying clients, never for cold contact.
5. **Do-not-contact (DNC) wins everywhere.** It covers the queue, Nuevos, imports, the finder, AI drafts and buttons. Deleting a DNC prospect leaves a suppression record so a re-import can't bring it back.
6. **Only business contact data, with sources.** Every AI fact stores its source URL. Every prospect can be exported and deleted.
7. **Money is PYG integers** (`bigint`), like `deals.value`. Percentages are stored as basis points (`int`, 1000 = 10.00%).
8. **Repo conventions apply:**
   - Services take `TenantContext` first.
   - Zod in every action and route.
   - Admin-only mutations use `requireTenantAdmin()` and `writeAuditLog`.
   - Every string goes through next-intl in es/en/sv (`es` is the reference; the parity test must pass).
   - Tests live beside modules.
   - One migration per phase; `npm run check:migrations` must pass.
   - No new GitHub workflow.

---

## 2. What already exists (reuse, do not duplicate)

| Need | Existing code |
|---|---|
| Tenants, roles admin/agent, auth | `src/modules/tenancy/context.ts` (`requireTenantContext`, `requireTenantAdmin`, `buildSystemTenantContext`), Better Auth `src/lib/auth/server.ts` |
| Scoped DB | `src/modules/tenancy/db.ts` (`tenantDb`, `tenantTransaction`) |
| Tenant settings JSON | `src/modules/tenancy/settings.ts` (`TenantSettings`, private `mergeTenantSettings`, one `updateTenantX` per key) |
| Contacts, phone dedupe | `contacts` (`contacts_tenant_phone_idx`), `src/modules/crm/contacts.ts` (`getContactByPhone`, `createContact`) |
| Phone | `src/lib/phone.ts` `normalizePhone(raw, country)`, `waMeHref(raw, country, text)`, `telHref` |
| Pipelines, deals, stage moves | `src/modules/crm/pipelines.ts`, `deals.ts` (`moveDeal`), board `src/app/(app)/pipeline/PipelineBoard.tsx` |
| Activities, tasks, timeline | `src/modules/crm/activities.ts` (`createActivity`), `tasks.ts`, `timeline.ts`. The `activities.type` enum is TS-only (varchar), so adding types needs no migration |
| CSV import | `src/modules/crm/import.ts` (`parseCsv`, `guessMapping`, `importContacts`), UI `src/app/(app)/contacts/import/*` |
| Merge + duplicates | `src/modules/crm/merge.ts` `mergeContacts`, `duplicates.ts` `findDuplicateCandidates` |
| Contact delete / export | `src/modules/crm/deletion.ts`, `src/modules/crm/export.ts` (`toCsv`) |
| Existing Hoy panel | `src/modules/coach/hoy.ts` `buildHoy`, `rank.ts`, rendered in `src/app/(app)/dashboard/page.tsx` |
| Job queue | `src/lib/queue/index.ts` `enqueue(type, payload, {tenantId, runAt, maxAttempts})`; handlers `registerHandler` in a module `jobs.ts`, side-effect import in `src/worker/index.ts`; self-rescheduling chains seeded in `src/worker/maintenance.ts` `ensureMaintenanceScheduled` (pattern: `coach.morning` hourly + tenant-local hour check) |
| AI drivers | `src/lib/ai/*` `AiDriver.generateStructured` (zod schema → JSON schema), `createOpenAiDriver(apiKey, model, baseUrl)`; usage meter `ai_replies` + `src/modules/ai/replies.ts` |
| Machine tokens pattern | `src/modules/ops/tokens.ts` (hash + prefix + `timingSafeEqual`), `src/modules/ops/http.ts` (`authenticateOpsRequest`, `readJson`), `src/modules/sites/keys.ts` |
| Rate limit | `src/lib/rate-limit/index.ts` `checkRateLimit(key, limit, windowMs)` |
| Lead ingest | `src/modules/sites/ingest.ts` `runIngest` → `src/modules/leads/submissions.ts` `recordLeadSubmission`; `SiteSettings` in `src/modules/sites/settings.ts` |
| Reports / PDF | `src/modules/reports/sales.ts` (`bySite`), `src/modules/renderable-document/pdf.tsx`, `src/modules/quotes/pdf.tsx` |
| Email / push / Telegram | `sendEmail` (`src/lib/email/index.ts`), `createNotification` / `enqueuePush` (`src/modules/notifications/*`), `sendTelegramMessage` |
| PWA | `src/app/manifest.ts`, `public/sw.js` (push only), `src/components/push-subscribe.ts` registers it, `install-app-button.tsx` |
| Theme / dark mode | `src/app/theme-actions.ts`, `src/lib/theme.ts` (already supports dark) |
| i18n | `messages/{es,en,sv}.json`, per-user locale in `src/i18n/request.ts`, parity test `src/i18n/messages.test.ts` |
| Nav | `src/app/(app)/layout.tsx` builds `NavGroup[]`, `src/components/app-nav.tsx`; gating pattern `...(flag ? [item] : [])` |
| Settings UI | `src/app/(app)/settings/page.tsx`, `SettingsForms.tsx`, `actions.ts` (`useActionState`, errors as i18n keys) |

Missing, and built in this plan:
- Mobile UI pieces: bottom nav, bottom sheet, tabs, badge, progress ring.
- Offline outbox, and a service-worker `fetch`/`sync` handler for it.
- Share target.
- Per-seller visibility.
- Import batches + undo, and XLSX / JSON / vCard / paste parsers.
- Prospect profile fields (geo, website, rating, score).
- Goals/streaks, agreements/charges/commissions.
- Laptop worker API, Places client, website fetcher, lead forwarding.

---

## 3. Tenancy: module flags and seller visibility (R2)

### 3.1 Module flags
- **Setting.** `TenantSettings.modules?: { prospecting?: boolean; rankAndRent?: boolean }`, with the updater `updateTenantModules`.
  - Only the **superadmin console** can change it: a toggle on `src/app/(superadmin)/tenants/[id]`, audited as `tenant.modules_updated`.
  - `rankAndRent` requires `prospecting`.
- **Helper.** `src/modules/tenancy/modules.ts`: `hasModule(ctx, "prospecting" | "rankAndRent"): Promise<boolean>` (reads the tenant row, cached per request with `react` `cache`).
- **Gating:**
  - Every new route calls `requireModule(ctx, name)`, which calls `notFound()` when the module is off.
  - Nav items are added with the existing spread pattern.
  - Jobs skip tenants without the module.
- **Test:** with no modules, the nav, routes and jobs are unchanged. Routes answer 404.

### 3.2 Visibility `all | own`
- **Setting.** `TenantSettings.visibility?: "all" | "own"` (default `all`, the current behaviour; PLAN.md §1.2 stays true for every existing tenant). Admin-editable in `/settings/prospeccion`. Audited.
- **Helper.** `src/modules/tenancy/visibility.ts`:
  - `isScoped(ctx)` = role `agent` AND visibility `own`.
  - `contactScope(ctx)` returns `undefined` or `eq(contacts.ownerUserId, ctx.userId)`.
  - `dealScope(ctx)` returns `undefined` or `eq(deals.assignedUserId, ctx.userId)`.
  - `taskScope(ctx)` uses `tasks.assignedUserId`.
  - `assertContactVisible(ctx, contactId)` throws `NotFound`.
- **Read paths to apply it to** (every one gets a test in `visibility.integration.test.ts`: seller A gets 404 or an empty result for seller B's prospect):
  - `crm/contact-list.ts`, `crm/search.ts`, contact detail `contacts/[id]/page.tsx` (+ its actions), `crm/timeline.ts`
  - pipeline board and `pipeline/[dealId]` (+ actions), `crm/tasks.ts` lists, `coach/hoy.ts` (`mine`)
  - `crm/export.ts` (agents export only their own), `reports/sales.ts` (an agent sees only their own rows)
  - global search / `command-palette`
  - all new prospecting reads
- **Unassigned prospects** (`ownerUserId = null`) sit in the **Nuevos pool**:
  - Scoped sellers see the pool only through `/prospectos/nuevos` and can press **Tomar** ("take"). That assigns the contact and its open deal to them in one transaction; if someone else took it first, the action fails and the pool refreshes.
  - Admins can also assign in bulk.
- Mutations re-check visibility server-side. Hiding a button is not security.

---

## 4. Data model

New migrations, in the numbering that is current when each phase starts. Today the next one is `0045`.

### 4.1 Reused as-is
- A **prospect is a contact**. `contacts.name` is the business name and `contacts.phone` the main phone (E.164, the dedupe key). `ownerUserId` is the seller.
- Its sales state is a **deal** in the pipeline **"Venta"**. The seed creates it with these stages:

  | Stage | Flag |
  |---|---|
  | Nuevo | |
  | Contactado | |
  | Interesado | |
  | Reunión / Demo | |
  | Prueba | |
  | Cliente | `isWon` |
  | Perdido | `isLost`, reason in `deals.lostReason` |

  Stages stay editable (`/pipeline/etapas`). The prospecting code finds stages by a **role key** rather than by name: `TenantSettings.prospecting.stageRoles = { new, contacted, interested, meeting, trial, won, lost }` holds stage ids set by the seed, editable in settings.
- `activities`: add the types `whatsapp` and `visit` (TS enum only).
  - Outcome payload shape: `{ outcome, channel, attempt, clientOpId?, note? }`.
  - `outcome` is one of `no_answer | interested | call_later | not_interested | wrong_number`.
- `tasks`: follow-ups stay tasks. The prospecting ones are titled via i18n and flagged in the new `prospect_profiles.next_task_id` pointer. There is exactly one open follow-up per prospect.

### 4.2 New tables

**R2**

`niches`
| column | type | notes |
|---|---|---|
| id, tenant_id | char(26) | |
| name | varchar(100) | "Perforación de pozos" |
| slug | varchar(60) | unique per tenant |
| search_phrases | json | `["perforación de pozos", "pozos artesianos"]`, used by R5 |
| wa_first_template | text | variables `{negocio} {contacto} {ciudad} {sitio} {vendedor}` |
| wa_followup_template | text | |
| created/updated | datetime | |

`prospect_profiles` (1:1 with `contacts`, PK = contact_id)
| column | type | notes |
|---|---|---|
| contact_id, tenant_id | char(26) | |
| niche_id | char(26) null | |
| target_site_id | char(26) null | the site we pitch to this prospect |
| contact_person | varchar(200) null | person at the business; `contacts.name` is the business |
| phones | json | extra E.164 numbers `[{e164, label}]` |
| whatsapp | varchar(20) null | E.164; defaults to the main phone when it is a PY mobile |
| email2, website | varchar | website normalized to `https://host/path` |
| domain_norm | varchar(190) null | host without `www.`, index; null for social/marketplace hosts |
| address | varchar(500) null | |
| city, department | varchar(100) null | index (tenant, city) |
| lat, lng | decimal(9,6) null | |
| google_place_id | varchar(255) null | unique (tenant, google_place_id) |
| rating | decimal(2,1) null | |
| reviews_count | int null | |
| socials | json | `{facebook, instagram, tiktok, linkedin}` |
| source | varchar(40) | `import_csv, import_xlsx, import_json, import_vcf, paste, manual, google_places, site_lead` |
| field_sources | json | per field: `{rating: {source: "google_places", at}}`; used by R5 retention |
| name_city_key | varchar(250) | normalized name + "|" + city, index (tenant, key) |
| base_score | tinyint | deterministic 0–100, computed without AI (§5.4) |
| ai_score | tinyint null | R4 |
| ai_score_reason | varchar(200) null | R4 |
| ai_summary | json null | R4 `{summary, services[], signals{}, facts:[{text, sourceUrl}]}` |
| drafts | json null | R4 `{first, followUp, model, at}` |
| ai_status | varchar(20) | `none, pending, done, failed` |
| do_not_contact | boolean | default false |
| dnc_reason | varchar(200) null | |
| attempts | smallint | consecutive no-answer count; reset on any real conversation |
| last_contacted_at | datetime null | |
| next_task_id | char(26) null | the one open follow-up |
| import_batch_id | char(26) null | |
| raw_import | json null | the original row, kept for audit |
| enriched_at | datetime null | |
| google_fields_purged_at | datetime null | R5 |
| created/updated | datetime | |

`prospect_suppressions` (DNC tombstones that survive deletion)
| column | notes |
|---|---|
| id, tenant_id | |
| kind | `phone`, `domain` or `place_id` |
| value_hash | SHA-256 of the normalized value, unique (tenant, kind, value_hash) |
| reason | |
| created_by, created_at | |

`site_offers` (1:1 with `sites`; `rankAndRent` only)
| column | notes |
|---|---|
| site_id (PK), tenant_id | |
| niche_id | |
| city | null means the whole country |
| status | `available`, `trial` or `rented` |
| list_price_monthly_pyg, list_price_per_lead_pyg | bigint null; a guide only |
| notes | |
| created/updated | |

`import_batches`
| column | notes |
|---|---|
| id, tenant_id, created_by | |
| file_name, format | format: `csv, xlsx, json, vcf, paste, google_places` |
| mapping | json |
| niche_id, assign_to_user_id | |
| counts | json `{total, created, merged, skipped, errors}` |
| status | `done`, `undone` or `partially_undone` |
| undone_at, undone_by | |
| created_at | |

`import_batch_rows`
| column | notes |
|---|---|
| id, tenant_id, batch_id | |
| row_no | |
| action | `created`, `merged` or `skipped` |
| contact_id | null |
| reason | varchar(100); for skipped: `no_phone, invalid_phone, dnc, duplicate_in_file, error` |
| before | json null; for merged: the exact contact + profile fields changed, and their old values |

`client_ops` (idempotency for offline replays)
| column | notes |
|---|---|
| tenant_id, user_id | |
| client_op_id | char(26) ULID from the phone; unique (tenant, client_op_id) |
| kind | |
| result | json |
| created_at | |

Pruned after 30 days by a daily chain.

**R3**

`seller_goals`
| column | notes |
|---|---|
| tenant_id, user_id | PK (tenant, user) |
| daily_contacts | smallint, default 20 |
| workdays | json, default `[1,2,3,4,5,6]` (Mon–Sat) |
| updated_by, updated_at | |

`seller_days` (one row per seller per local day; updated on every outcome)
| column | notes |
|---|---|
| tenant_id, user_id, day | date in the tenant timezone; PK (tenant, user, day) |
| contacts | distinct prospects with an outcome that day |
| calls, whatsapps, interested, won | |
| goal | copied at first write, so later goal changes don't rewrite history |
| goal_met | boolean |

`client_agreements` (1:1 with a won deal)
| column | notes |
|---|---|
| id, tenant_id | |
| deal_id | unique |
| contact_id | the client |
| site_id | the site whose leads they receive; null for a sales-only deal |
| model | `monthly`, `per_lead` or `per_sale` |
| monthly_fee_pyg | bigint null |
| price_per_lead_pyg | bigint null |
| monthly_minimum_pyg | bigint null |
| sale_fee_pyg | bigint null; fixed per sale |
| sale_fee_bps | int null; % of sale value |
| exclusive | boolean |
| city | exclusive area |
| delivery_email, delivery_whatsapp | R6 forwarding targets |
| duplicate_window_days | default 30; the same caller within the window is not billed again (R6) |
| start_date, end_date | end_date null |
| status | `active`, `paused` or `ended` |
| seller_user_id | |
| seller_bps | int null; empty = no commission |
| notes | |
| created/updated | |

`client_charges`
| column | notes |
|---|---|
| id, tenant_id, agreement_id | |
| period | char(7) `YYYY-MM`; unique (agreement, period) |
| leads_delivered | int; R6 fills it automatically, before that admin enters it |
| sales_reported, sales_value_pyg | |
| amount_due_pyg | computed (§6.4), editable by admin with a note |
| amount_paid_pyg | |
| paid_at | |
| status | `open`, `paid`, `partial` or `waived` |
| note | |
| created/updated | |

`commissions`
| column | notes |
|---|---|
| id, tenant_id, user_id, charge_id | unique (charge, user) |
| amount_pyg | = paid × seller_bps / 10000, recomputed when the payment changes |
| status | `pending` or `paid` (paid to the seller) |
| paid_at | |
| created/updated | |

Seller default %: `TenantSettings.prospecting.sellerDefaultBps: Record<userId, number>`, which pre-fills `client_agreements.seller_bps`.

**R4**

`worker_tokens`
| column | notes |
|---|---|
| id, tenant_id | |
| label | |
| token_hash | unique |
| token_prefix | |
| scopes | json `["ai"]` |
| last_used_at, last_seen_version | |
| revoked_at | |
| created_by, created_at | |

`ai_jobs`
| column | notes |
|---|---|
| id, tenant_id | |
| kind | `classify, enrich, draft, dedupe, embed, map_columns` |
| subject_type | `contact` or `import_batch` |
| subject_id | |
| input_hash | char(64), index (tenant, kind, input_hash) |
| payload | json: the full prompt package built server-side (§7.3) |
| priority | tinyint |
| status | `pending, claimed, done, failed, cancelled` |
| lane | `local` or `cloud` |
| claimed_by | worker token id or `cloud` |
| lease_until | datetime |
| attempts | |
| result | json |
| provider, model | |
| prompt_tokens, completion_tokens | |
| cost_micros | int, USD × 1e6 |
| duration_ms | |
| error | varchar(500) |
| created/updated | |

`prospect_embeddings`
| column | notes |
|---|---|
| contact_id (PK), tenant_id | |
| model | e.g. `bge-m3` |
| dims | |
| vector | blob, float32 little-endian |
| text_hash | |
| created_at | |

**R5**

`places_searches`
| column | notes |
|---|---|
| id, tenant_id, niche_id | |
| city | |
| text_query | |
| weekly | boolean |
| max_pages | tinyint, default 3 |
| assign_to_user_id | |
| last_run_at, active | |
| created/updated | |

`places_runs`
| column | notes |
|---|---|
| id, tenant_id, search_id | |
| requests_estimated, requests_used | |
| results, new_prospects, duplicates, no_phone | |
| status | |
| error | |
| started_at, finished_at | |

`place_candidates` (results not yet a prospect, e.g. no phone)
| column | notes |
|---|---|
| id, tenant_id | |
| place_id | unique (tenant, place_id) |
| search_id | |
| raw | json, Google fields |
| status | `new, prospect, no_phone, ignored, suppressed` |
| contact_id | null |
| fetched_at | |
| purged_at | |

`website_snapshots`
| column | notes |
|---|---|
| id, tenant_id, contact_id | |
| url | |
| http_status | |
| robots_allowed | boolean |
| fetched_at | |
| text_excerpt | text, ≤ 8,000 chars |
| signals | json: phones, waLinks, emails, socials, hasPixel, hasGtag, hasViewport, https, cms |
| sources | json: the list of URLs fetched |

**R6**
- `lead_submissions.contact_id` becomes **nullable**. Forward-mode leads don't create a contact. Audit every reader of `contactId` in `reports/*`, `timeline.ts` and the sites pages.
- New table `lead_forwards`:

  | column | notes |
  |---|---|
  | id, tenant_id | |
  | submission_id | |
  | agreement_id | null when unrouted |
  | channel | `email`, `whatsapp_template` or `manual` |
  | status | `queued, sent, failed, unrouted, duplicate` |
  | billable | boolean |
  | sent_at | |
  | error | |
  | created_at | |
- New table `site_events`:

  | column | notes |
  |---|---|
  | id, tenant_id, site_id | |
  | kind | `call_click`, `wa_click` |
  | page_url | |
  | created_at | |

  Counted in reports. Not billable unless the agreement says so.
- New table `client_report_links`:

  | column | notes |
  |---|---|
  | id, tenant_id, agreement_id | |
  | token_hash | |
  | period | |
  | expires_at | |
  | created_at | |

---

## 5. R2 — MVP

Goal: the seller installs the app, imports a list, works her Hoy list with one-tap
call/WhatsApp and outcomes, and moves a prospect from Nuevo to Cliente.
Deployed. No AI and no Google API yet.

### 5.1 Routes

All under `src/app/(app)/`, gated by `prospecting`.

| Route | Who | What |
|---|---|---|
| `/hoy` | all | Seller home (§5.3). `/dashboard` redirects agents here when the module is on |
| `/prospectos` | all | List (default) and board (`?vista=tablero`, reuses `PipelineBoard` filtered to the Venta pipeline). Filters: niche, target site, city, stage, tag, score band, "sin contactar". Search box |
| `/prospectos/nuevos` | all | Unassigned pool plus her own untouched prospects, sorted by score. **Tomar** / **Descartar** (discard means Lost, with the reason "descartado") |
| `/prospectos/[id]` | all | Mobile prospect card (§5.5). Links to the full `/contacts/[id]` |
| `/prospectos/nuevo` | all | Quick add: business name, phone, niche, city (dedupe check before saving) |
| `/prospectos/importar` | all | Import wizard (§5.6) |
| `/prospectos/importar/lotes` | all | Batch list with **Deshacer** (creator or admin) |
| `/settings/prospeccion` | admin | Niches + templates, stage roles, visibility, default follow-up rules, sellers' daily goals (R3), seller default % (R3), leaderboard toggle (R3), AI (R4) |
| `/alquiler` | admin, `rankAndRent` | Sites for rent: status, niche, city, list price, current client (R3) |

**Mobile bottom nav** (`src/components/bottom-nav.tsx`, `md:hidden`, shown when `prospecting` is on):

| Tab | Destination |
|---|---|
| Hoy | `/hoy` |
| Nuevos | `/prospectos/nuevos` |
| Prospectos | `/prospectos` |
| Ganancias | added in R3; shown only if the seller has a % |
| Más | opens the existing nav |

- Icon + label, 56 px tall, safe-area inset.
- The desktop sidebar gets the same items in a new "Prospección" group.

**New UI primitives** in `src/components/ui/`:
- `sheet.tsx` (bottom sheet): focus trap, Esc/back-button closes, drag handle.
- `tabs.tsx`, `badge.tsx`, `progress-ring.tsx`.
- No new UI library.

**Tap targets:** at least 48 px, and the main action buttons 56 px.

### 5.2 Services

New module `src/modules/prospecting/`:
- `profiles.ts`: get/upsert profile, `computeBaseScore`, `normalizeWebsite`, `nameCityKey`.
- `pool.ts`: `listPool`, `takeProspect` (transaction with a conditional update `WHERE owner_user_id IS NULL`), `assignProspects` (admin).
- `queue.ts`: `buildQueue(ctx, now)`, plus the pure `rankQueue(items, now)` with unit tests.
- `outcomes.ts`: `recordOutcome(ctx, input)` (§5.4), idempotent on `clientOpId`.
- `followups.ts`: the pure `nextFollowUp(outcome, attempts, now, tz, workdays)` with unit tests.
- `dnc.ts`: `setDoNotContact`, `isSuppressed(ctx, {phone, domain, placeId})`, `suppress`.
- `templates.ts`: `renderTemplate(tpl, vars)`, which escapes nothing (plain text for `wa.me`), max 1,000 chars, unknown variables left blank.
- `dedupe.ts`: `findExisting(ctx, candidate)` checks, in order: phone (main + `phones[]`) → `domain_norm` → `name_city_key`. Pure key builders get unit tests.
- `import/`: see §5.6.
- `privacy.ts`: `exportProspect(ctx, id)` returns JSON of contact + profile + activities + tasks + deals. `deleteProspect(ctx, id)` wraps `crm/deletion.ts` and writes suppression rows when DNC.
- `jobs.ts`: the `prospecting.client_ops.prune` daily chain.
- `seed.ts`, used by the script.

`src/lib/phone.ts` gets additions only; don't change existing behaviour:
- `isPyMobile(e164)`: `+5959` followed by 8 digits.
- `isPlausiblePy(e164)`: mobile, or a landline with area code (`+59521…`, `+595` + 2–3 digit area + 5–7 digits).
- The import rejects implausible numbers as `invalid_phone`.

### 5.3 Hoy screen

Top card:
- Greeting + date.
- Goal ring `contactados hoy / meta` (R2 counts today's distinct prospects with an outcome; the goal defaults to 20 until R3 adds per-seller goals).
- Pending-sync chip when the outbox is not empty.

Queue order (`rankQueue`):
1. Overdue follow-ups (oldest first).
2. Follow-ups due today (by time).
3. Deals in "Interesado" or later with no open follow-up (safety net).
4. Her untouched prospects (stage Nuevo), sorted by `ai_score ?? base_score`, then rating × log(1 + reviews).

Excluded: DNC, won/lost deals, and other sellers' prospects when scoped. Show 30, with "Ver más".

Each item:
- Business name.
- A line of niche · city · stage badge.
- The reason it's in the list ("Seguimiento vencido hace 2 días", "Nuevo · puntaje 82").
- Two big buttons: **Llamar** (`tel:`) and **WhatsApp** (`wa.me` to `whatsapp ?? phone`, with the niche's first or follow-up template rendered; follow-up when `attempts > 0` or the stage is past Contactado).
- Tapping the card opens `/prospectos/[id]`.
- No buttons when DNC.

After a tap on Llamar or WhatsApp:
- The item id and channel are saved to `sessionStorage`.
- When the page becomes visible again (`visibilitychange`), the **outcome sheet** opens for that prospect.
- The sheet can also be opened from the card at any time.

Outcome sheet: four big buttons, plus "Número equivocado" in a small link.

| Button | Effect | Next follow-up (`nextFollowUp`) |
|---|---|---|
| No contestó | `attempts += 1` | +1 workday at the same hour. From attempt 3: +7 days. At attempt 6: the sheet suggests "Marcar perdido: no contesta" (one tap, not automatic) |
| Interesado | stage → Interesado if earlier; `attempts = 0`; optional note field | +2 workdays |
| Llamar después | `attempts = 0`; chips Hoy 17:00 / Mañana / En 3 días / Próxima semana / date+time picker | as picked |
| No interesado | reason chips: No le interesa / Ya tiene proveedor / Muy caro / Cerró el negocio / Otro (text). "No volver a contactar" checkbox sets DNC. Deal → Perdido with `lostReason` | none |
| Número equivocado | removes the phone; if no other phone exists, the prospect goes to "Sin teléfono" | none |

Common effects of every outcome, in **one transaction**:
- An activity (`call` or `whatsapp`) is written.
- The open follow-up is completed and the next one created (assigned to the seller); `next_task_id` is updated.
- Stage Nuevo → Contactado on the first outcome.
- `last_contacted_at` is set.
- `seller_days` is upserted (R3; in R2 the count is read from activities).
- A `client_ops` row is written.

After saving: a toast, the item leaves the queue, and the ring updates. Celebrations come in R3.

### 5.4 Base score (deterministic, no AI)

`computeBaseScore(profile)`, 0–100, with unit tests:

| Signal | Points |
|---|---|
| Has PY mobile / WhatsApp | +25 |
| Has website | +15 |
| Rating ≥ 4.0 | +10 |
| Reviews ≥ 10 | +10 |
| Reviews ≥ 50 | +10 more |
| City matches the target site's city | +10 |
| Niche set | +10 |
| Has email | +5 |
| Has socials | +5 |

Capped at 100. Recomputed on every profile write.

### 5.5 Prospect card `/prospectos/[id]`

Sections, top to bottom:
1. **Header:** name, stage badge, score (with the AI reason in R4), owner.
2. **Action row:** Llamar / WhatsApp / Registrar resultado / ⋯ (Asignar, No contactar, Exportar, Eliminar).
3. **Datos:** contact person, phones (each with call/WA), email, website (opens), address + city, socials, rating ★ + reviews, source, import batch.
   - Google-sourced values carry a "Google Maps" label (R5 attribution).
4. **Mapa:** a "Abrir en Google Maps" link (`https://www.google.com/maps/search/?api=1&query=lat,lng` or `&query_place_id=`). Shown only when lat/lng or place_id exists. No map tiles and no API key needed in R2.
5. **Resumen IA:** in R2 an empty state "Se completa automáticamente (IA)". Filled in R4.
6. **Mensaje:** the rendered template (editable textarea); "Enviar por WhatsApp" opens `wa.me` with the edited text.
7. **Historial:** the existing `getContactTimeline` entries, filtered to this contact.
8. **Seguimiento:** the next follow-up + reschedule.

Editing: one form (`useActionState`), zod-validated. Changing the phone re-runs the dedupe check and refuses to collide with another contact (it offers to merge).

### 5.6 Import (R2: CSV + XLSX; R4 adds JSON, vCard, paste, AI mapper)

`src/modules/prospecting/import/`:

| File | Purpose |
|---|---|
| `parse.ts` | `parseUpload(fileName, bytes)` → `{headers, rows}`. CSV reuses `crm/import.ts` `parseCsv` (auto-detects `;` separators, common in Spanish Excel exports). XLSX uses `read-excel-file` (MIT, small, server-side, first sheet). Limits: 5 MB, 5,000 rows, same as today |
| `fields.ts` | Target fields: `name`, `contactPerson`, `phone`, `phone2`, `whatsapp`, `email`, `website`, `address`, `city`, `department`, `lat`, `lng`, `rating`, `reviewsCount`, `niche`, `tags`, `notes`, `facebook`, `instagram`, `placeId`, `category` |
| `guess.ts` | Header synonym table (es/en, with and without accents), including the common Google Maps export shapes: `title`, `phone`, `phoneUnformatted`, `website`, `address`, `street`, `city`, `totalScore`, `reviewsCount`, `placeId`, `categoryName`, `location/lat`, `location/lng`, `url`. Returns a mapping + confidence per field |
| `clean.ts` | Name cleanup: trim, collapse spaces, strip emoji, Title Case when ALL CAPS, keep acronyms of ≤ 4 letters. Phones: split cells with `/`, `,` or `y` into several numbers, normalize with `normalizePhone(…, "PY")`, validate `isPlausiblePy`. Website: `normalizeWebsite`, and ignore facebook/instagram/wa.me/linktr.ee hosts as domain keys (moving them to socials) |
| `run.ts` | `importProspects(ctx, rows, {mapping, nicheId, targetSiteId, assignTo, tagIds, format, fileName})` → `ImportReport` + batch id |
| `undo.ts` | `undoBatch(ctx, batchId)` |

What `run.ts` does:
1. Checks the plan limit once, like `importContacts`.
2. Creates `import_batches`.
3. For each row:
   - clean
   - suppression check (skip as `dnc`)
   - dedupe within the file (`duplicate_in_file`)
   - `findExisting` → **merge**: fill only empty fields, record the old values in `before`, and put conflicting values into `raw_import.conflicts`; never touch a DNC flag or an owner that is already set
   - or **create**: contact + profile + deal in Nuevo (assigned to `assignTo` or to nobody, which means the pool)
   - write a `import_batch_rows` row
4. Processes rows in chunks of 100, each in a transaction.

What `undo.ts` does:
- A **created** contact is deleted only if it has had no user activity, stage change or edit since the batch. Otherwise it is kept and reported as "kept: already worked".
- A **merged** contact gets its `before` values restored, but only for fields still holding the imported value.
- Status becomes `undone` or `partially_undone`. Audited.
- Allowed for 30 days.

Wizard (client, `useActionState`, mobile-first):
1. **Archivo:** file picker (`accept=.csv,.xlsx`), or arrives via share target.
2. **Columnas:** a mapping list with a select per target field, pre-filled by `guess`. Low-confidence fields are highlighted.
3. **Opciones:** niche, target site, assign to (admin: seller or pool; agent: herself), tags.
4. **Vista previa:** the first 10 cleaned rows, plus a dry-run count of `created / merged / skipped by reason` (runs `run.ts` with `dryRun: true`, no writes).
5. **Importar:** shows the report + "Ver prospectos" + "Deshacer este lote".

Sample file: `docs/samples/prospectos-ejemplo.csv`, 25 rows. It deliberately includes: a local-format phone, two numbers in one cell, an in-file duplicate, a duplicate of a seed prospect, a row with no phone, an ALL-CAPS name, a website with `www.`, and a Facebook URL in the website column.

### 5.7 Offline outbox + PWA

- **Where outcomes are posted.** `POST /api/app/outcomes` (route handler, not a server action, so it can be replayed).
  - Requires the session.
  - Checks `Origin` equals `APP_URL` (CSRF).
  - Rate-limited to 120/min per user.
  - Body validated with zod: `{clientOpId, contactId, outcome, channel, at, followUpAt?, reason?, dnc?, note?}`.
  - Idempotent: a replayed `clientOpId` returns the stored result.
  - `at` is the tap time (clamped to within 7 days); stats use it.
- **Client outbox** (`src/lib/offline/outbox.ts`): IndexedDB, hand-written, no library.
  - `queueOp(op)` → try `fetch`. On network error or 5xx, store it and show the pending chip.
  - Flushes on `online`, `visibilitychange` → visible, app start, and Background Sync (`registration.sync.register("outbox")`).
  - A 4xx is dropped with a visible error ("No se pudo guardar el resultado de X"), except 401, which keeps the op and shows "Iniciá sesión de nuevo".
- **Hoy data offline.** `/hoy` renders from `GET /api/app/hoy` (JSON). The last response is cached in IndexedDB; when offline, it shows the cached list with a "Sin conexión, datos de las 08:12" banner. Ops already done locally are removed from the list. `tel:` works with no data at all.
- **Service worker** (`public/sw.js`) keeps the push handlers and adds:
  - A `sync` handler that flushes the outbox.
  - A `fetch` handler for **only**:
    - the share-target POST (§5.8)
    - an app-shell fallback: for navigations when offline, serve the cached `/hoy` HTML shell (precached on install)
  - Bump the SW version constant.
- **Manifest:**
  - `start_url` stays `/dashboard` (it redirects agents to `/hoy` when the module is on).
  - Add `shortcuts` (Hoy, Importar) and `share_target`.
  - Dark `theme_color` via the existing theme.

### 5.8 Share-to-app (Android)

`share_target`:
```json
{ "action": "/compartir", "method": "POST", "enctype": "multipart/form-data",
  "params": { "title": "title", "text": "text", "url": "url",
              "files": [{ "name": "file", "accept": [".csv", ".xlsx", ".vcf", ".json", "text/csv", "text/vcard", "application/json", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] }] } }
```
- The SW intercepts `POST /compartir`, stores the file or text in IndexedDB, and responds with a redirect to `/prospectos/importar?compartido=1`.
- The wizard reads it from IndexedDB and continues at step 2.
- Shared **text** is kept for the R4 paste importer. In R2 the page shows "Importar texto llega pronto".

### 5.9 Seed and fake data

`scripts/seed-prospecting.ts`, following the `seed-tenant.ts` rules: env/CLI only, no PII, never prints passwords, idempotent upserts.
- **Tenant.** Default `TENANT_SLUG=rank-and-rent` (name "Rank & Rent PY"): modules on, visibility `own`, `defaultCountry` PY, timezone `America/Asuncion`.
- **Users.** The admin (`SEED_ADMIN_EMAIL`) + one seller (`SEED_SELLER_EMAIL`). Passwords come from `SEED_*_PASSWORD` or, when unset, an invitation link written to a local file under `.seed-output/` (gitignored).
- **Pipeline** "Venta" with its stages + `stageRoles`.
- **Niches and sites:**

  | Niche | Site | City |
  |---|---|---|
  | Perforación de pozos | pozo.com.py | Central |
  | Dentistas | dentista.com.py | Asunción |
  | Ecografía | ecografia.com.py | Asunción |

  Each gets Paraguayan-Spanish WA templates. The three sites get `site_offers` rows (available; list prices null) and are linked if they already exist by domain; otherwise they are created inactive.
- **Prospects.** 12 fake ones: numbers `+595981000101`–`+595981000112`, `example.com.py` websites, spread across niches, cities and stages; 3 in the pool, 1 DNC.
- `--demo-only` flag: adds only the fake prospects to an existing tenant. `--remove-demo`: removes them (tagged `demo`).

### 5.10 Exit criteria R2
- `npm run lint`, `typecheck`, `test` (with a local MariaDB `DATABASE_URL`), `build` and `check:migrations` are all green.
- Tests:
  - `rankQueue`, `nextFollowUp`, `computeBaseScore`, dedupe keys, `clean.ts`, `guess.ts` (unit)
  - import + undo + merge-restore (integration)
  - outcome idempotency (the same `clientOpId` twice gives one activity)
  - visibility (seller A vs B across every read path in §3.2)
  - modules off = unchanged (routes 404, nav unchanged)
  - DNC (the import skips a suppressed phone after delete)
  - parity test
- **Browser walk at 375 × 812** (in-app browser, mobile preset), as the seed seller:
  1. Install prompt available.
  2. Import the sample CSV → the report matches the expected counts.
  3. Undo the batch → the counts are restored.
  4. Re-import.
  5. Hoy shows ranked items.
  6. Call → back → outcome "No contestó" → the next follow-up is tomorrow.
  7. WhatsApp link has the prefilled text.
  8. "Interesado" → stage moves.
  9. Offline (DevTools offline) → tap an outcome → pending chip → online → synced once.
  10. Board view shows the stages.
  11. Move a prospect through to Cliente from the card.
- Light and dark screenshots attached to the PR.
- `docs/log/r2.md` records what Anton must do (§12).

---

## 6. R3 — Goals, streaks, money, admin panel

### 6.1 Goals and streaks
- **Goals.** `seller_goals` is editable by the admin in `/settings/prospeccion` (per seller: daily contacts and workdays). A seller sees her goal but can't change it.
- **`seller_days`** is upserted inside `recordOutcome` using the tenant-local day of `at`. `contacts` counts distinct contacts per day: check for an existing outcome activity for that contact and day before incrementing.
- **Streak** = consecutive workdays up to yesterday with `goal_met`, plus today if already met. Non-workdays are skipped, not broken. Computed by a pure `computeStreak(days, workdays, today)` with unit tests.
- **Weekly bar** = the week's contacts / (goal × workdays in the week).
- **Hoy top card:** ring (today), 🔥 streak, weekly bar, and an earnings chip (if the seller has a %).

### 6.2 Celebrations
- `src/components/celebrate.tsx`: a small CSS/canvas burst, no dependency, respects `prefers-reduced-motion`.
- Triggered client-side from the action result, on:
  - an outcome that moves the stage forward
  - the daily goal reached (once per day)
  - a deal won ("¡Nuevo cliente!")
  - streak milestones 5 / 10 / 20

### 6.3 Leaderboard
- `TenantSettings.prospecting.leaderboard: boolean`, default true.
- Shown on `/hoy` (collapsed) only when the tenant has ≥ 2 active sellers.
- This week: contacts, interested, won. Sorted by won, then contacts.
- Names are first names only.

### 6.4 Client agreements, charges, commissions (`rankAndRent`)
- **Creating an agreement.** When a Venta deal enters the `won` stage (board move, card or outcome), the UI opens the **Acuerdo** form: client (the deal's contact), site (the list defaults to `site_offers` available/trial in the same niche), model, terms, exclusive + city, delivery email/WhatsApp, start date, seller, seller % (pre-filled from `sellerDefaultBps`).
  - Saving sets the `site_offers.status` to `rented` (or `trial` when the stage was Prueba).
  - The deal's `value` is set to the monthly fee or the expected monthly amount.
- **Pages** (admin; sellers see their own read-only):
  - `/acuerdos`: list with status, model, site, client, MRR.
  - `/acuerdos/[id]`: terms (audited edit), the charges table, pause/end.
- **Monthly charges.** A `prospecting.charges.monthly` chain runs hourly and acts at tenant-local 06:00 on day 1 (the `coach.morning` pattern). It creates `client_charges` for the previous month for every agreement active in that month.
- **`computeAmountDue(agreement, charge)`** (pure, with unit tests):

  | Model | Amount due |
  |---|---|
  | `monthly` | fee, prorated by days active in the first and last month |
  | `per_lead` | max(minimum, billable leads × price) |
  | `per_sale` | sales × fixed fee + sales value × bps / 10000 |

  Until R6, `leads_delivered` is entered by the admin; R6 fills it from `lead_forwards`.
- **Commissions.** The admin enters a payment (`amount_paid_pyg`, `paid_at`), which upserts `commissions` for the agreement's seller when `seller_bps` is set. Changing the payment recomputes it. The admin marks a commission "pagada".

### 6.5 Mis ganancias `/ganancias`
Shown only if the seller has any agreement with a % or a default %.
- **Big number:** "Ganado este mes", the sum of this month's commissions from paid charges.
- **Second:** "Por cobrar", the expected amount from open charges and active agreements this month.
- **List:** her clients with their model and last payment.
- **Chart:** 6-month bars (CSS bars, as in `reports/page.tsx`).
- Admin sees a per-seller selector.

### 6.6 Admin panel `/panel-ventas` (admin)
- Period picker 7 / 30 / 90 days (reuse `reportWindow`).
- **Pipeline value:** open Venta deals × value, by stage.
- **Conversion per stage:** from `stage_change` activities in the period (entered → moved forward), plus median days in stage.
- **Activity per seller:** contacts/day, calls, WhatsApps, interested, won, and goal-met days.
- **Sites:** available / trial / rented by niche and city; a list of **unrented sites**.
- **Money:** MRR (monthly + the average of the last 3 per-lead/per-sale charges), open charges, commissions pending.
- CSV export of each table (reuse `toCsv`).

### 6.7 Exit criteria R3
- Gates green.
- Unit tests for `computeStreak`, `computeAmountDue` and the commission math.
- Integration test for won → agreement → monthly job → payment → commission.
- **Browser walk at 375 px:**
  1. Log 20 outcomes → ring full + celebration.
  2. Streak increments across a simulated day (test clock).
  3. Win a deal → agreement form → run the charges job for the month → enter a payment.
  4. Mis ganancias shows the commission.
  5. The admin panel numbers match.

---

## 7. R4 — AI (batch on the laptop, $0 by default)

### 7.1 Principle
The AI work runs in batches on Anton's laptop through Ollama. The server never calls the laptop; the **laptop pulls work**. When the laptop is off, nothing breaks: templates and base scores cover the gap. An optional cloud lane exists, but it is off by default.

### 7.2 Provider layer
- `src/lib/ai/`:
  - Add `createOpenAiCompatibleDriver({baseUrl, apiKey, model, provider: "ollama" | "deepseek" | "dashscope" | "openai"})`. It reuses `openai.ts` internals, but sends `max_tokens` and `response_format: {type: "json_object"}` when the provider doesn't support `json_schema`; the zod parse + retry already exists in `structured.ts`.
  - The existing `getAiDriver()` stays as-is for the current features.
- `src/modules/prospecting/ai/settings.ts`: `TenantSettings.prospecting.ai = { mode: "off" | "local" | "local_then_cloud" | "cloud"; cloudAfterMinutes: number (default 720); monthlyBudgetUsd: number (default 5) }`.
  - Default mode is `local` for the seeded tenant, and `off` for every other tenant.
- Cloud credentials are platform env only: `AI_CLOUD_BASE_URL`, `AI_CLOUD_API_KEY`, `AI_CLOUD_MODEL`, `AI_CLOUD_PRICE_IN_PER_M`, `AI_CLOUD_PRICE_OUT_PER_M` (all optional in `env.ts`). Without them the cloud lane is unavailable and the settings page says so.

### 7.3 Jobs (prompts live on the server; the laptop is a dumb runner)
Each `ai_jobs.payload` is a full package:
`{messages, jsonSchema, model_hint, options: {temperature, num_ctx, think: false}}`.
Prompts are versioned files in `src/modules/prospecting/ai/prompts/*.ts`, written in Spanish, with the output language fixed to Spanish.

| Kind | Trigger | Input | Output (zod) | Applied to |
|---|---|---|---|---|
| `classify` | new or changed prospect, import done | name, category/types, city, rating, reviews, website/social presence, snapshot signals (R5), niche list | `{nicheSlug \| null, isRealBusiness, buyerScore 0–100, reason ≤ 140}` | `ai_score`, `ai_score_reason`, niche if empty |
| `enrich` | after classify when `isRealBusiness`, and again after a website snapshot | profile + snapshot excerpt + source URLs | `{summary ≤ 400, services[], sizeSignals[], runsAds: yes\|no\|unknown, websiteQuality: good\|basic\|none, whatsappFound, facts:[{text, sourceUrl}]}` | `ai_summary`. **Facts whose `sourceUrl` is not in the provided list are dropped** |
| `draft` | after classify, and when the stage changes to Contactado or Interesado | niche template, business data, summary, stage, seller first name, tone (`usted` default, niche setting) | `{first ≤ 600, followUp ≤ 600}` | `drafts`. The seller edits before sending |
| `embed` | new prospect | `name + category + city + domain` | vector (Ollama `/api/embed`, `bge-m3`) | `prospect_embeddings` |
| `dedupe` | a pair with cosine ≥ 0.90 in the same city/niche, or name_city_key similarity | both profiles | `{sameBusiness, confidence 0–1, why}` | Shown in the existing duplicates panel as a suggestion. **Never auto-merged** |
| `map_columns` | an import whose guessed mapping has low confidence, **cloud lane only** (the laptop may be off during an import) | headers + 5 sample rows | mapping JSON | pre-fills step 2 of the wizard |

Rules:
- **Cache:** before enqueueing, reuse a `done` job with the same (tenant, kind, input_hash) from the last 90 days.
- **DNC:** DNC prospects get no `draft`/`enrich` jobs.
- **Priority:** prospects in the pool or in today's queue first.
- **Visible status:** `ai_status` on the profile drives an "IA pendiente" badge.

### 7.4 Laptop runner `workers/ai-local/`
- Its own `package.json`, Node ≥ 20, no dependencies, excluded from the Next build/tsconfig (like `workers/email-inbound`). Files: `run.mjs`, `.env.example`, `install-task.ps1`, `README.md` (in English).
- **Config:** `VENDERCRM_URL`, `VENDERCRM_WORKER_TOKEN`, `OLLAMA_URL` (default `http://127.0.0.1:11434`), `OLLAMA_MODEL` (default `qwen3:4b`), `OLLAMA_EMBED_MODEL` (default `bge-m3`), `MAX_JOBS` (default 500).
- **Loop:**
  1. `POST /api/v1/ai-worker/claim` with `{max: 5, kinds, models}` returns jobs with a 10-minute lease.
  2. For each job: call Ollama `/api/chat` (`format` = the job's JSON schema, `think: false`, `keep_alive: "10m"`) or `/api/embed`.
  3. `POST /api/v1/ai-worker/jobs/:id/result` with `{ok, output, model, promptTokens, completionTokens, durationMs, error?}`.
  4. The server validates with the kind's zod schema, applies the result, and marks the job done or failed (retry up to 3 attempts).
  5. Stop when a claim returns nothing, or at `MAX_JOBS`.
- **Commands:** `npm run once` (drain the queue) and `npm run loop` (poll every 60 s).
- **`install-task.ps1`:** registers a Windows Task Scheduler task. It runs `npm run once` daily at 22:00 and at logon, only when on AC power, and won't start a second copy.
- **Server routes** (`src/app/api/v1/ai-worker/*`): auth via the `X-Worker-Token` header against `worker_tokens`.
  - The token code follows the `ops/tokens.ts` pattern, and `authenticateWorkerRequest` follows `ops/http.ts`.
  - Rate limits: 300/min per IP before auth, 120/min per token.
  - Add an eslint raw-db allowlist entry only if unavoidable; prefer `buildSystemTenantContext(token.tenantId)` + `tenantDb`.
  - `POST /heartbeat` stores `last_seen_version` + the models present, so the settings page can show "Laptop vista hace 3 h · qwen3:4b".
- **Settings UI:** "Crear token del worker" shows the token once (the same pattern as site API keys). There is a list with revoke, a queue size, and the last run.

### 7.5 Cloud lane (optional)
- A `prospecting.ai.cloud_sweep` chain runs every 10 minutes. For tenants in `local_then_cloud` it takes jobs pending longer than `cloudAfterMinutes`; for `cloud` it takes them immediately.
- It runs them through the cloud driver while the month's `cost_micros` sum is under budget. At the budget it stops and notifies the admin once.
- Tokens are logged per job. `ai_replies` is not reused, because its kinds are chat-oriented; `ai_jobs` is the meter for this module.

### 7.6 More import formats (R4)
- **JSON:** an array of objects, or `{data: [...]}`, or a GeoJSON FeatureCollection. Google Takeout "Saved places" gives `properties.Title`, `Location.Address`, `geometry.coordinates`, Google Maps URL. Flattened with `a/b` paths, then goes through the same `guess.ts`.
- **vCard (.vcf):** a small hand-written parser for vCard 2.1/3.0/4.0 (`FN`, `ORG` → business name when present, `TEL` (multiple), `EMAIL`, `URL`, `ADR`, `NOTE`, folded lines, QUOTED-PRINTABLE 2.1).
- **Pasted text** (a WhatsApp list, text copied from a web page):
  - Split into blocks by blank lines or one line per entry.
  - Extract PY phone numbers with a regex, URLs and emails.
  - The remaining text is the name candidate; a city is detected from a list of the 263 PY districts (`src/modules/prospecting/data/py-cities.ts`).
  - Preview lets the seller fix each row.
  - When the cloud lane is available, a "Mejorar con IA" button structures the messy blocks.
- **Share target** now routes text and `.vcf` / `.json` to these parsers.

### 7.7 Exit criteria R4
- Gates green.
- Tests:
  - worker auth (bad, revoked or expired token → 401)
  - claim lease + expiry + no double-claim (two concurrent claims)
  - the result validator drops facts with unknown sources
  - cache reuse
  - budget stop
  - DNC → no draft
  - parsers (JSON, GeoJSON, vCard 2.1 + 4.0, paste)
- **Real run on Anton's laptop:**
  1. `ollama pull qwen3:4b`.
  2. `npm run once` against a local dev server with the seed data.
  3. All 12 fake prospects get a score, reason, summary and drafts.
  4. The log shows per-job time.
  5. Report the average seconds per job.
- **Browser at 375 px:** the prospect card shows the AI summary with sources and the draft; Hoy is sorted by AI score.

---

## 8. R5 — Business finder (Google Places) + website enrichment

### 8.1 Places client
- **Module and key.** `src/modules/prospecting/places/client.ts`, using `GOOGLE_PLACES_API_KEY` (server env only).
- **Request.** `POST https://places.googleapis.com/v1/places:searchText` with header `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types,places.primaryType,places.businessStatus,places.googleMapsUri,nextPageToken`. Body: `{textQuery: "<phrase> en <city>, Paraguay", regionCode: "PY", languageCode: "es", pageSize: 20}`.
  - Follow `nextPageToken` up to `max_pages` (default 3).
- **Billing.** The phone, website and rating fields bill each request as **Text Search Enterprise**. The first 1,000 per month are free, then US$35 per 1,000 (verified 2026-09-29 at developers.google.com/maps/billing-and-pricing/pricing; recheck before go-live).
- **Cost guard:**
  - Each run first shows its estimate, e.g. "Hasta 3 solicitudes · usadas este mes: 140 / tope 900 · costo estimado US$0".
  - The tenant setting `prospecting.places.monthlyRequestCap` defaults to 900, so it stays under the free 1,000. A run that would cross the cap is refused.
  - Usage = the month's sum of `places_runs.requests_used`.
- **Ingest per result:**
  - `businessStatus` other than OPERATIONAL is skipped.
  - A suppressed place_id or phone is marked `suppressed`.
  - An existing place_id or phone → the existing prospect's empty fields are updated.
  - A phone is present → a prospect is created (source `google_places`, `field_sources` stamped, owner = the search's `assign_to_user_id` or the pool). Then classify/embed jobs are queued and a website fetch if there is a website.
  - No phone → a `place_candidates` row with status `no_phone`, plus a website fetch. If the fetch finds a phone, the candidate is promoted to a prospect.

### 8.2 Searches
- **Page.** `/buscar-negocios` (admin): saved searches (niche + city + phrase, weekly toggle, assign to), "Buscar ahora" with the estimate, the run history, and the no-phone candidates list (promote manually by adding a phone, or ignore).
- **Weekly job.** The `prospecting.places.weekly` chain runs hourly and acts on Monday at 05:00 tenant-local, for each active weekly search. New prospects land in Nuevos. The seller gets a push: "12 negocios nuevos en Nuevos".
- **Presets.** Pre-filled suggestions per seeded niche: "perforación de pozos" in Central, Luque, San Lorenzo, Capiatá, Limpio; "clínica dental" / "dentista" in Asunción, San Lorenzo, Lambaré, Fernando de la Mora; "ecografía" in Asunción, Luque, San Lorenzo.

### 8.3 Website enrichment
- **Job.** `prospecting.web.fetch` (`src/modules/prospecting/web/fetch.ts`).
- **robots.txt:** `/robots.txt` is read once per host and cached 24 h. The rules for `VenderCRMBot` and `*` are respected; if disallowed, the fetch is skipped and `robots_allowed=false` recorded.
- **Pages fetched:** the homepage + up to 2 same-host links whose path or text matches `contact|contacto|nosotros|about|ubicacion`.
- **Politeness:**
  - Timeout 10 s, max 1 MB, `text/html` only, max 3 redirects, same-site only.
  - A per-host rate limit of 1 request per 5 s (`checkRateLimit("web:" + host, 1, 5000)`, requeue on limit).
  - User agent `VenderCRMBot/1.0 (+https://clientes.com.py/bot)`. Add a public `/bot` page in `(marketing)` explaining the bot and how to opt out.
- **Extraction** (pure, with unit tests on fixture HTML):
  - `tel:` and `wa.me` / `api.whatsapp.com` links, PY phone regex, `mailto:`, social links.
  - `<title>`, meta description.
  - Signals: `gtag|googletagmanager` → hasGtag, `fbq(` → hasPixel, viewport meta, https, CMS hints (wp-content, wix, shopify).
- **Result.** A `website_snapshots` row. Profile fields are filled only when empty, with `field_sources` = the page URL. Then an `enrich` job is re-queued with the snapshot.

### 8.4 Google data retention (terms of service)
- **What Google allows.** Its Places terms allow storing `place_id` indefinitely, but not caching other Places content long-term.
- **Default policy:**
  - A daily `prospecting.places.retention` job takes prospects whose `field_sources` include `google_places` and that have **no user activity** 30 days after creation.
  - It clears the Google-sourced values (rating, reviews count, address, lat/lng, Google phone if not confirmed elsewhere), keeps `place_id`, and sets `google_fields_purged_at`.
  - `place_candidates.raw` older than 30 days is purged the same way.
- **What stays:**
  - Data the seller confirms in conversation, or that comes from the business's own website, is first-party and stays.
  - A "Actualizar desde Google" button re-fetches with Place Details (Essentials/Pro fields as needed; counted against the cap).
- **Attribution.** Show "Datos de Google Maps" next to Google-sourced values, with a link to `googleMapsUri`.
- This is a business decision for Anton; see §13.

### 8.5 Other sources (options, not built)

| Source | Legal | Cost | Verdict |
|---|---|---|---|
| DNIT (ex-SET) public RUC list (bulk download) | Public data | Free | Useful later to check "real business / RUC active". No phones |
| OpenStreetMap / Overpass | ODbL (attribution, share-alike on the derived DB) | Free | Thin coverage in PY; optional import |
| Online directories (yellow-pages style) | Most terms forbid scraping | — | Manual copy + paste import only |
| Facebook / Instagram pages | Meta terms forbid scraping | — | Manual copy only |
| Bought lists | No | — | Never |

### 8.6 Exit criteria R5
- Gates green.
- Tests (using `fetch` mocks and HTML fixtures; no real Google calls in CI):
  - field mask + paging + estimate
  - cap refusal
  - ingest dedupe (place_id, phone), no-phone → candidate → promotion
  - robots parser, extractor, per-host limit
  - retention purge
- **One real run by Anton** (key required) with max 1 page. Report requests used and results. Browser: Nuevos shows the new prospects with the Google attribution.

---

## 9. R6 — Site leads to paying clients + client reports (`rankAndRent`)

### 9.1 Forward mode
- **Setting.** `SiteSettings.leadMode?: "crm" | "forward"` (default `crm`, which is today's behaviour), editable on the site page for `rankAndRent` tenants.
- **Ingest branch.** In `runIngest`, after validation and Turnstile: when `forward`, call `recordForwardedLead(ctx, site, input)` instead of `recordLeadSubmission`. It:
  - inserts `lead_submissions` with `contact_id = null`
  - keeps idempotency, UTM, `fields` and the health recording unchanged
  - enqueues `prospecting.lead.forward`
- **Routing** (pure `routeLead(site, agreements, leadFields)`, with unit tests):
  1. Take active agreements on the site.
  2. If more than one, match `city` against `fields.ciudad` / `fields.city`, then exclusive first.
  3. Else the oldest active.
  4. None → `unrouted`: push + Telegram to admins ("Lead sin cliente en pozo.com.py") and show it in the unrouted list.
- **Billable:** a lead is not billable if the same normalized phone was forwarded to the same agreement within `duplicate_window_days`. Status `duplicate` is still delivered but not counted.

### 9.2 Channels
- **Email (default, free).** `sendEmail` to `delivery_email`, kind `automated` (counts toward `maxEmailsPerDay`).
  - Spanish template: name, phone (as a `wa.me` link and `tel:`), message, page, date.
  - Reply-To set to the lead's email when present.
- **WhatsApp template (optional).** Used only if the tenant has a connected WhatsApp account and an approved utility template (`nuevo_lead`, variables: site, name, phone, message). It uses the existing `src/modules/whatsapp` send path.
  - Meta bills utility templates per message by country; check Meta's rate card for Paraguay before enabling.
  - The template must be created and approved by hand in Meta.
- **Manual (always available).** The lead appears in `/leads-sitios` with "Reenviar por WhatsApp", which opens `wa.me/<client>` with the lead text prefilled. The admin or seller taps send.
- **Status tracking.** `lead_forwards` records every attempt. A failed email is retried by the queue (max 5), then pushed to admins.

### 9.3 Click events
- **Endpoint.** `POST /api/v1/events` (site API key, same guards as `/api/v1/leads`), body `{kind: "call_click" | "wa_click", page_url, idempotency_key}`, stored in `site_events`.
- **Snippet.** A one-line snippet for the sites, documented in the `vendercrm-lead-capture` skill references (a PR to that skill repo is out of scope; note it in the log).
- **Where they show.** Counted in reports as "clics para llamar / WhatsApp". Not billable unless the agreement says so (future).

### 9.4 Client report
- **Monthly charges.** The charges job (R3) now fills `leads_delivered` from billable `lead_forwards` of the period.
- **Report contents** (`/acuerdos/[id]/informe?mes=YYYY-MM` and PDF `renderClientReportPdf`, following `quotes/pdf.tsx`):
  - site
  - leads delivered (per week bars)
  - clicks
  - the list of leads (date, name, phone, message excerpt)
  - amount due
- **Sharing.** A public, read-only link `/informe/[token]` (`client_report_links`, token hashed, expires in 90 days) that the admin can WhatsApp to the client.
- **Automatic send.** On day 1 at 08:00, the report email goes automatically to `delivery_email` when the agreement has `sendMonthlyReport` true (default true). Subject: "Tus consultas de septiembre: 23 clientes interesados".

### 9.5 Lead list `/leads-sitios` (admin; sellers see the leads of their own clients)
- Filters: site, client, status, month.
- Per-site and per-client monthly counts.
- The unrouted queue, with "Asignar a cliente".

### 9.6 Exit criteria R6
- Gates green.
- Tests:
  - `crm` mode unchanged (existing ingest tests still pass)
  - forward mode creates no contact/deal
  - routing rules
  - duplicate window
  - unrouted alert
  - report numbers
  - public link expiry
- Real run: post a test lead with a site key to the local server → the email is logged (Resend test or dev log) → the charge counts it → the PDF renders.

---

## 10. Security, privacy, operations

- **Auth.** Better Auth email + password with the existing reset and rate limit. Magic link is not added; the existing flow works for a small team.
- **CSRF.**
  - Server actions rely on Next's origin check.
  - New cookie-authenticated route handlers (`/api/app/*`) check `Origin` against `APP_URL`.
  - Token routes (`/api/v1/ai-worker/*`, `/api/v1/events`) use header tokens, not cookies.
- **Input validation.** Zod on every action and route. File uploads are size-capped and parsed as data only (formulas in XLSX are ignored; values only). CSV export already neutralizes formula cells (`neutralize` in `crm/export.ts`); every new export must go through `toCsv`.
- **SQL.** Drizzle parameterized queries only; no string-built SQL.
- **Rate limits.**
  - `/api/app/outcomes` 120/min per user.
  - Worker routes 120/min per token.
  - Imports 10/hour per user.
  - Places runs 20/day per tenant.
- **Secrets.** Only in env (`GOOGLE_PLACES_API_KEY`, `AI_CLOUD_*`). Worker tokens and site keys are stored hashed and shown once. Nothing secret in the repo, logs or reports.
- **Privacy.**
  - Business contact data only.
  - Per-prospect **Exportar** (JSON) and **Eliminar** (with a DNC tombstone when flagged).
  - Add a "Datos de prospectos" section to `(marketing)/privacidad`: what is stored, the sources (public business listings, the business's own site), how a business can ask for removal (DNC + delete within 7 days), and the contact email.
- **Backups.** Keep hPanel daily backups (docs/BACKUPS.md). Before the R2 go-live, Anton runs `npm run verify-restore` once; HANDOFF says it was never run.

---

## 11. Monthly cost

| Item | Cost |
|---|---|
| Hosting + MySQL | $0 extra (existing VenderCRM Node slot and DB) |
| Google Places | $0 while under 1,000 requests/month; capped at 900 by default |
| AI on the laptop (Ollama) | $0 |
| AI cloud lane | off by default; if enabled, about US$0.002 per job with DeepSeek V4.1 Flash, capped at US$5/month |
| Email forwarding and reports | $0 at this volume (existing provider, counted in `maxEmailsPerDay`) |
| WhatsApp template forwarding | optional; Meta utility rate for PY per message |
| **Total** | **$0/month by default** |

---

## 12. What Anton does by hand, per phase

**R2**
1. Merge the PR. Hostinger rebuilds from `main`.
2. On his PC, allowlist the IP in hPanel → Remote MySQL, then run `npm run db:migrate` with the production `DATABASE_URL` set in the shell (never written to a file in the repo).
3. Run `npx tsx scripts/seed-prospecting.ts` with `SEED_ADMIN_EMAIL`, `SEED_SELLER_EMAIL` (and passwords, or use the invitation file).
4. On the seller's phone, open `https://crm.clientes.com.py` in Chrome, log in, then ⋮ → **Instalar app**.
5. Run `npm run verify-restore` once.

**R3**
- Migrate.
- Set her daily goal and, if wanted, her %.

**R4**
1. Migrate.
2. `ollama pull qwen3:4b` (~2.5 GB).
3. `cd workers/ai-local`, copy `.env.example` to `.env`, and paste the worker token from Settings → Prospección → Worker.
4. Run `npm run once`, then `powershell -File install-task.ps1`.
5. Optional: set `AI_CLOUD_*` in hPanel.

**R5**
1. Google Cloud Console: create a project, enable billing, enable **Places API (New)**, create an API key restricted to Places API (New).
2. Set a **daily quota cap** (e.g. 60 requests/day) under APIs → Places API (New) → Quotas as a hard stop.
3. Add `GOOGLE_PLACES_API_KEY` in hPanel env, then redeploy.

**R6**
1. Set `leadMode = forward` on the rented sites, and the delivery email/WhatsApp on each agreement.
2. Optional: create and get approval for the `nuevo_lead` WhatsApp template in Meta.
3. Put the click snippet on the sites.

---

## 13. Open decisions (Anton)

1. **CI minutes.** `.github/workflows/ci.yml` runs 2 jobs (one with MySQL) on every PR push and every push to `main`. Keep it, or switch it to `workflow_dispatch` / label-gated per the budgeted-runner policy? It is untouched until Anton decides.
2. **Google data retention.** The 30-day purge of Google-sourced fields for prospects never contacted (§8.4) is the default. Anton can accept it or ask for a different rule.
3. **Seller %.** None is set by default. Anton sets per seller in settings when wanted.
4. **Message tone.** `usted` by default for first contact. Per-niche `vos` is possible.
5. **Share target text** (R2 shows "llega pronto") vs. pulling the paste importer into R2. The default is R4.

---

## 14. Build log

| Phase | Log | PR |
|---|---|---|
| R1 | this file | docs PR |
