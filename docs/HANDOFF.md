# Handoff — after PRs #51, #52 and the 1V bug hunt

Written 2026-08-20. #51 was the `x-forwarded-for` fix; #52 wired conversation
ownership. Two parts: **what you do** (deploy + verify + dogfood) and
**what Claude Code does next** (a prompt to paste into a fresh window).

---

## Part 1 — What to do yourself

> **Order matters more than it looks.** §1.3's `verify-restore` belongs
> *before* §1.1's migration run, not after. §1.1 applies nine migrations
> (`0010`→`0018`) to a live database, and the only thing standing between a
> migration that fails halfway and a lost tenant is a backup nobody has ever
> restored. Restoring one takes twenty minutes; discovering it doesn't
> restore, after the schema is half-migrated, takes the whole product.

### 1.1 Deploy and migrate (do this once the backup is proven)

The live app is behind `main` by several merged PRs, and two of them add
tables. Migrations run from **your machine, not Hostinger SSH** (docs/DEPLOY.md
§3 — Hostinger's IPv6 routing breaks the external MySQL host).

```bash
git pull origin main
npm ci
# DATABASE_URL pointed at the EXTERNAL srv####.hstgr.io host, not localhost
npm run db:migrate
```

> **On Windows, run these in PowerShell** from the repo folder. `db:migrate`
> reads `.env` on its own (`drizzle.config.ts` loads dotenv), so put the
> external `DATABASE_URL` in a local `.env` rather than exporting it — the
> `VAR=value command` prefix form below is bash syntax and does nothing in
> PowerShell.

Expected to apply: `0010_add_ai_replies`, `0011_add_nonfiscal_documents`, and
everything after them through `0018_add_deal_close_reason`.

Then in hPanel → the app's environment variables, add the one new var:

```
TRUSTED_PROXY_HOPS=1
```

Redeploy. `1` is the default even if you forget, so this is belt-and-braces —
but set it explicitly so the value is visible next to the others.

### 1.2 Confirm `TRUSTED_PROXY_HOPS` is right (10 minutes, do it once)

This is the one thing PR #51 could not verify from CI, and it is the whole
point of the PR. Full procedure with the failure modes is in **docs/DEPLOY.md
§10**; the short version:

1. From your laptop, note your public IP: `curl -s https://ifconfig.me`
2. Submit one lead to the live app:
   ```bash
   curl -X POST https://<app-url>/api/v1/leads \
     -H 'content-type: application/json' \
     -H 'x-api-key: <a real site key from /sites>' \
     -d '{"phone":"+595981000000","name":"prueba xff","source":"handoff-check"}'
   ```
3. Read back what got stored:
   ```sql
   SELECT ip_address, created_at FROM lead_submissions ORDER BY created_at DESC LIMIT 1;
   ```
4. Compare:
   - **your own public IP** → correct, nothing to change;
   - **a private address** (`10.x`, `172.16–31.x`, `127.0.0.1`) → too low,
     set `TRUSTED_PROXY_HOPS=2` and repeat;
   - **an address that is neither yours nor private** → a CDN edge is in the
     chain, set `2` and repeat;
   - **NULL** → no proxy header at all; tell Claude, that changes the design.

Delete the test contact afterwards from `/contacts` (admin only, guarded
delete — it has no history so it will let you).

### 1.3 The two operator scripts that have never been run

Both exist and are unrun; both gate putting real client leads in. **Run the
backup one first, before §1.1** — see the note at the top of Part 1.

**Backup restore** (docs/BACKUPS.md §2):
```bash
# after restoring a real hPanel dump into a throwaway database
RESTORE_DATABASE_URL=mysql://... npm run verify-restore
```

PowerShell — set the variable first, since the one-line prefix form is bash
only, and `verify-restore` does not read `.env`:

```powershell
$env:RESTORE_DATABASE_URL = "mysql://user:pass@srv####.hstgr.io:3306/vendercrm_restore_test"
npm run verify-restore
```
Exits non-zero with a named report if any table is missing, if
tenants/users/contacts/deals are empty, or if the newest rows are too old
(i.e. a stale file with a fresh timestamp).

**Storage smoke test:**
```bash
SMOKE_STORAGE_BASE_URL=https://<app-url> npm run smoke-storage
```

PowerShell, same shape — and this one also needs the app's own env
(`DATABASE_URL`, `APP_ENCRYPTION_KEY`, `STORAGE_*`), which `tsx` will not read
from `.env` by itself:

```powershell
$env:SMOKE_STORAGE_BASE_URL = "https://<app-url>"
npx tsx --env-file=.env scripts/smoke-storage.ts
```
Runs put → read-back → sign → fetch the signed URL → delete → confirm gone.
Run it once on `local` today. Run it again the day you cut `STORAGE_DRIVER=s3`
over to Cloudflare R2 — same command, no changes. Until then WhatsApp media
sits on Hostinger disk, which PLAN.md §2.1 says to treat as non-durable.

### 1.4 URLs to click through

Tenant app (logged in as **admin**):

| URL | What to confirm |
|---|---|
| `/dashboard` | loads, numbers are not all zero |
| `/inbox` | list refreshes on its own every 5s without eating a half-typed reply |
| `/inbox/<id>` | send a text inside the 24h window; send a template outside it |
| `/inbox` + `/inbox/<id>` | **new:** assign the conversation to a rep, confirm the list row shows the owner, reassign to "sin asignar" |
| `/contacts` → `/contacts/<id>` | timeline shows quotes, notas de venta, conversations |
| `/contacts/<id>` → conversación tab | **new:** the same owner picker, in sync with the inbox's |
| `/contacts/import` | import a small CSV with a deliberate duplicate and a bad row |
| `/pipeline?pipeline=<id>` | the switcher survives a reload; drag a deal between stages |
| `/pipeline/<dealId>` | won/lost with a reason; the deal leaves the active columns |
| `/pipeline/etapas` | rename/reorder a stage |
| `/quotes/<id>` | send over WhatsApp; "convertir presupuesto" into a nota de venta |
| `/documents/<id>` | issue, record a payment, confirm void is blocked once paid |
| `/products`, `/forms`, `/sites`, `/automations`, `/users`, `/settings` | load; admin-only actions present |

Public, unauthenticated — **open these in a private window**, they must work
with no session at all:

| URL | What to confirm |
|---|---|
| `/q/<token>` and `/q/<token>/pdf` | quote view + PDF render |
| `/d/<token>` and `/d/<token>/pdf` | nota de venta + PDF, with the "no tiene validez tributaria" notice |
| `/f/<tenantSlug>/<formSlug>` | submit; lands in the CRM; `/gracias` after |
| `/api/storage?key=…&sig=…` | a valid signed URL serves; a mangled one 404s (never 403) |

Superadmin console (a **superadmin** account, not a tenant admin):

| URL | What to confirm |
|---|---|
| `/tenants`, `/tenants/<id>` | list and detail load |
| `/plans` | plan limits visible |
| `/audit` | rows appear for the deletes and voids you did above |
| `/whatsapp-health` | per-tenant status; dead/stuck jobs listed |
| impersonation | enter a tenant, banner shows, "volver a la consola" returns you |

### 1.5 Roles to check

Three identities. The fastest real test is **log in as an agent and confirm the
admin-only things are not merely hidden but refused.**

- **agent** — should NOT be able to: create/publish automations, create forms,
  create a pipeline, create/toggle products, void a document, delete a payment,
  delete a contact or deal, ban a user or change a role. Should be able to:
  everything selling — inbox, quotes, issue documents, record payments, move
  deals.
- **admin** — all of the above, plus `/users` (invite, deactivate, role change)
  and `/settings`.
- **superadmin** — the console only. Confirm a superadmin session cannot read
  a tenant's data *without* impersonating.
- **banned user** — ban an agent from `/users`, then reload in the browser
  where that agent is logged in. The live session must be dead on the very
  next request, not at the next login.

### 1.6 Your dogfooding day (PLAN.md §10 1R exit criterion)

The bar is one full working day on the three sites — dentista, tasacion, pozo
— where a lead arrives from a live site into the right pipeline, gets WhatsApp
follow-up in the self-refreshing inbox, and ends in a nota de venta issued and
paid — **without opening a terminal or another tab.** Note every place you had
to leave the app; that list is the next phase's spec.

---

## Part 1.7 — What changed in the 1V bug hunt (nothing for you to do)

The bug hunt Part 2 used to schedule has been run and merged (PLAN.md §10
1V). Nothing in it needs an operator action; it is listed here so the
behaviour change isn't a surprise during the dogfooding day.

- **The 24h window now starts when the customer wrote**, not when the
  webhook job ran. If the worker has been down, conversations will correctly
  show *less* window remaining than they did before. Inbound messages are
  also timestamped from Meta, so a thread read after a backlog shows the
  customer's own times.
- **A message's delivery ticks no longer go backwards** when Meta redelivers
  a status webhook.
- **A flow that dies mid-run no longer replays from the start** when the
  stuck-job reaper retries it — it resumes at the node that was in flight.
  If you have ever seen a duplicate automated WhatsApp message, that was
  this.
- **The money path was audited and not changed** — quote and nota de venta
  totals, and the payment ledger, were found correct.

---

## Part 2 — Prompts for tomorrow

The 1V bug hunt this section used to schedule has been run and merged, and
with it there is **no unblocked code work left in the repo**. Everything
still open is either an operator task in Part 1 or gated on someone else:
1N on Meta Tech Provider approval, 1P's API half on Google's review, the R2
cutover on opening the account. So tomorrow is not a build session. It is
the deploy and the dogfooding day, with Claude Code alongside to fix what
the day surfaces.

Three prompts below, for the three shapes tomorrow can take. Use one.

### 2A — The dogfooding day (the one to use if the deploy went fine)

Paste this in the morning and leave the window open all day. Bring it every
friction point as you hit it, in whatever words you'd use to complain about
it. That is the session's input.

> VenderCRM (antonmarklundcom/vendercrm), `main` at the 1V merge. I am
> running the §10 1R dogfooding day today: real leads from dentista,
> tasacion and pozo into the live app, WhatsApp follow-up in the inbox, and
> a nota de venta issued and paid — without opening a terminal or another
> tab. Read PLAN.md §10 1R (the exit criterion), §10 1S/1T/1U/1V for the
> right size of task, and §13 for the conventions.
>
> Your job today is not to build a phase. It is to sit next to a live run:
> I will paste friction as I hit it, and for each one decide which it is,
> out loud, before touching anything —
>
> - **a bug** → smallest fix that closes it, a regression test beside the
>   module, one PR, merged when CI is green;
> - **a missing affordance** → say what it would cost and what it displaces,
>   and wait for me to say go;
> - **working as designed** → say so plainly and tell me why, rather than
>   coding around my complaint.
>
> Keep a running list of everything I report, in the order I report it, and
> at the end of the day write it into PLAN.md as the next phase's spec —
> ordered by what actually blocked the day, not by size, the way §10 1R is
> ordered. That list is the real output; the fixes are a side effect.
>
> Conventions: services take `TenantContext` first and reach the DB only
> through `tenantDb`; zod in every server action; destructive actions are
> `requireTenantAdmin()` + `writeAuditLog`; every user-facing string goes
> through next-intl in `messages/es|en|sv.json`; tests live beside the
> module. No MySQL in the container, so DB-backed suites only run in CI —
> run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
> locally and say plainly which suites could not run.

### 2B — The deploy went wrong

> VenderCRM (antonmarklundcom/vendercrm). I tried the §1.1 deploy and it
> failed. Here is what I ran and what came back: <paste>. Read
> docs/DEPLOY.md and PLAN.md §2.1 first — the Hostinger constraints there
> are the reason the procedure looks the way it does, and the failure is
> more likely to be one of those than something new. Diagnose before
> changing anything, and tell me whether the fix belongs in the app, in the
> hPanel config, or in the procedure doc.

### 2C — A Fable review gate, if you want one before letting real leads in

Worth one short session. §13 exists because Fable read the whole repo once;
every wave it produced has now merged, and nothing has re-read the result.

> VenderCRM (antonmarklundcom/vendercrm), `main` at the 1V merge. You wrote
> PLAN.md §13 after a full-repo review; every batch in it (H1–H9) has since
> merged, plus §10 1R–1V. Re-read the repo and answer three things:
>
> 1. **What did §13 miss?** Not what it deferred on purpose (§13.1 lists
>    that) — what a reader looking at the whole thing fresh would now flag.
> 2. **What did the batches break or half-finish?** Nine waves of change
>    landed against a spec written before any of them; say where the code
>    and PLAN.md have drifted apart.
> 3. **What is the riskiest hour in Part 1 of docs/HANDOFF.md**, and is the
>    procedure written for it good enough? Specifically: nine migrations
>    (`0010`→`0018`) applied to a live database whose backups have never
>    been restore-tested, with no rollback step written down.
>
> Output the same shape §13 has: numbered batches, one PR each, file-
> disjoint within a wave, with a model tier and exit criteria per batch. No
> code this session.

### The original 1V prompt, for the record

> VenderCRM (antonmarklundcom/vendercrm), continuing after PRs #51 and #52
> merged. #51 was the `x-forwarded-for` fix — one `clientIp()` helper in
> `src/lib/http/client-ip.ts` counting from the right, `TRUSTED_PROXY_HOPS`
> env, procedure in docs/DEPLOY.md §10. #52 wired inbox conversation
> ownership — `AssigneePicker`, agent-accessible, guarded by an active-member
> check. Read PLAN.md §10 1R/1S/1T/1U and §13 first for the conventions and
> for recent examples of the right size of task.
>
> Hunt for real bugs in three paths and fix what you find, with a regression
> test per fix:
>
> - **Money** — `src/lib/money.ts` and everything that totals a quote or a
>   nota de venta (`src/modules/quotes/`, `src/modules/documents/`,
>   `src/modules/renderable-document/`). Guaraníes have no minor unit; look
>   for rounding that loses or invents one, IVA computed on an already-rounded
>   subtotal, and a payment ledger whose balance can disagree with the sum of
>   its rows.
> - **The WhatsApp 24h window** — `src/modules/whatsapp/send.ts` and
>   `isWithinFreeFormWindow`. Which timestamp closes the window, what happens
>   exactly at the boundary, and whether an AI draft approved a moment late is
>   re-checked rather than trusted.
> - **The automation engine** — `src/modules/automations/`. Runs that can fire
>   twice for one trigger, a job that strands mid-flow, a flow edited while a
>   run is in flight.
>
> Tell me plainly if a path is clean rather than inventing work — a "no bugs
> found, here is what I checked and how" answer is a good outcome.
>
> Conventions: services take `TenantContext` first and reach the DB only
> through `tenantDb`; zod in every server action; destructive actions are
> `requireTenantAdmin()` + `writeAuditLog`; every user-facing string goes
> through next-intl in `messages/es|en|sv.json` (the parity test fails on a
> missing key); tests live beside the module.
>
> No MySQL in this container, so the DB-backed suites can only be verified in
> CI — run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`
> locally, say plainly which suites could not run, and let CI be the check on
> those. Work on a new branch, open a PR, merge it once both CI jobs are
> green. Ask me before anything that needs a product decision.

### If the dogfooding day comes first

Skip the prompt above and just run the day (§1.6). A bug you hit yourself
with a real lead in front of you is worth more than one found by reading, and
the list of places you had to leave the app is the next phase's spec.

---

## Part 3 — Wave 1 (P1–P7) deploy

Written after PRs #96–#103 merged (PLAN.md §15.5 "now" batch, §15.8's phase
table). Seven phases: the automation library and web push (lane 1, Opus),
then inbox ergonomics, email identity, pipeline polish + custom fields,
quote accept/reject + receipts, and the rule-based "Hoy" dashboard panel
(lane 2, Sonnet, one session, sequential). `docs/log/p1.md` through
`docs/log/p7.md` are the per-phase detail; this is the one deploy pass for
all seven.

### 3.1 Migrations to run

Six new migrations, `0029` through `0034`, additive only (new tables and
nullable columns — nothing altered or dropped):

```bash
git pull origin main
npm ci
npm run db:migrate
```

Expected to apply: `0029_add_notifications`, `0030_add_push_subscriptions`,
`0031_add_quick_replies_and_notes`, `0032_add_email_identity`,
`0033_add_pipeline_polish_and_custom_fields`,
`0034_add_quote_acceptances_and_receipts`.

### 3.2 Env vars to add

Both are optional — the features they gate simply stay hidden with nothing
configured, same posture as every other optional integration in
`.env.example`.

**Web push** (§15.5 J2 — the bell's push half):
```bash
npm run generate-vapid
```
prints a keypair; paste it into hPanel's env vars as:
```
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:soporte@clientes.com.py
```
Generate this **once for the whole platform**, not per tenant. Changing it
later invalidates every existing browser subscription (they silently
re-subscribe on next visit).

**Tenant email sending identity** (§15.1, P4 — used when a tenant hasn't
verified their own domain yet):
```
EMAIL_DEFAULT_DOMAIN=mail.clientes.com.py
```
A subdomain you control's DNS for, not the apex — see `.env.example`'s own
comment for why (reputation isolation from the marketing site and from
tenants who verify their own domain). Leaving it unset keeps every tenant on
`RESEND_FROM_EMAIL`, exactly the pre-P4 behavior.

Redeploy after either is added.

### 3.3 The two human checks this wave needs

Neither is a click-through — both need a real device/account, the same
reason `TRUSTED_PROXY_HOPS` (Part 1) needed a real request.

**Push on Android** (10 minutes):
1. With `WEB_PUSH_*` set and deployed, open the app in Chrome on an Android
   phone and log in.
2. "Add to home screen" (or accept the install banner) so the PWA runs
   standalone — a push that arrives while the tab is merely open in a
   browser is not the real test.
3. From another session, do something that writes a `notifications` row for
   that user (assign them a conversation, or wait for an overdue task to
   push through P7's `coach.morning` digest at their tenant's local 08:00).
4. Confirm the notification appears on the phone with the app closed, and
   tapping it opens the right page.
   iPhone/Safari needs the same install step before push works at all —
   that's Apple's platform rule, not a bug (P2's `docs/log/p2.md` Known
   issues).

**Resend domain verification** (15 minutes, needs a real domain you control
DNS for):
1. As a tenant admin, go to `/settings` and add a sending domain in the
   email section P4 added.
2. Add the TXT/CNAME/MX records Resend returns to that domain's DNS.
3. Within a few minutes to a few hours (DNS propagation), the domain's
   status in `/settings` should flip from pending to verified — this is
   `modules/tenancy/email-jobs.ts`'s polling chain, not something to force.
4. Send a quote or document by email from that tenant (the "Enviar por
   email" button on a quote/document detail page) and confirm the message
   arrives from the verified domain, not the platform default.

### 3.4 New URLs, for the smoke test

Already folded into `docs/SMOKE_TEST.md` §9 — listed here only as a quick
index of what is new this wave: `/inbox/quick-replies`,
`/contacts/campos`, `/pipeline/etapas`'s stale-threshold field, the email
section on `/settings`, the "Enviar por email" buttons on quotes/documents,
`/q/[token]`'s new accept/reject form, `/r/[token]` (+ `/pdf`), and the
"Hoy" panel at the top of `/dashboard`.
