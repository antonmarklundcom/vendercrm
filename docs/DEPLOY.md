# Deploy runbook — Hostinger

VenderCRM runs as a single Next.js app on Hostinger's managed Node.js hosting
(PLAN.md §2.1: one process, no Redis, no separate worker dyno — the job
queue worker starts in-process from `instrumentation.ts`). This doc covers a
first deploy and every routine redeploy after it.

## 1. One-time setup

1. **hPanel → Websites → Add Website → Node.js Apps → Import Git Repository.**
   Authorize GitHub, select this repo and the branch to deploy (`main`).
2. Verify auto-detected settings: framework Next.js, build command
   `npm run build`, start command `npm start`.
3. **Create the MySQL database** (hPanel → Databases → MySQL Databases) if it
   doesn't exist yet. Note the internal host (usually `localhost`), db name,
   user, password.
4. **Environment variables** — add all of these in hPanel (never commit
   secrets; `.env.example` documents each one):
   - `NODE_ENV=production`
   - `DATABASE_URL` — use the **internal** `localhost`/`127.0.0.1` host for
     the live app, not the external `srv####.hstgr.io` host (that's only for
     remote/local connections, see §3 below)
   - `APP_ENCRYPTION_KEY` — 32-byte hex, generate with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `APP_URL` — the final deployed URL (Hostinger subdomain or custom domain)
   - `STORAGE_DRIVER` — `local` works to launch with no Cloudflare account
     needed, but treat Hostinger disk as non-durable (PLAN.md §2.1): quote
     PDFs re-render on demand so those are recoverable, but inbound
     WhatsApp media is downloaded once from Meta's expiring URL and is gone
     for good if the disk is. Switch to `s3` before onboarding any tenant
     beyond the owner's own.
   - `STORAGE_LOCAL_PATH` — only read when `STORAGE_DRIVER=local`.
     Whichever driver is chosen, verify it with `npm run smoke-storage`
     (`docs/SMOKE_TEST.md` §8) — it runs the whole put/read/sign/delete
     lifecycle against the configured driver and exits non-zero on failure.
   - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` —
     required when `STORAGE_DRIVER=s3`; the app fails to boot without them
     (validated in `src/lib/config/env.ts`). For Cloudflare R2: dashboard →
     R2 → create a bucket, then **Manage R2 API Tokens** → create a token
     with read+write on that bucket. `S3_ENDPOINT` is
     `https://<account-id>.r2.cloudflarestorage.com` (account ID is in the R2
     dashboard URL). `S3_REGION` defaults to `auto`, which is what R2
     expects — leave it unset. R2's free tier (10GB storage, **no egress
     fee** — the reason it's the recommended provider here over S3 itself)
     covers this workload comfortably.
   - `CRON_SECRET` — arbitrary long random string, shared with the Hostinger
     cron job set up in §5
   - `BETTER_AUTH_SECRET` — >=32 chars, generate the same way as the
     encryption key
   - `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — from the Meta
     developer app (PLAN.md §6.1)
   - `APEX_HOST`, `APP_HOST` — optional; default to `clientes.com.py` and
     `crm.clientes.com.py`. Set them only when a deployment answers on other
     hostnames (a staging domain, a rename). `middleware.ts` routes on these,
     so a wrong value sends the marketing site and the app to each other's
     host (PLAN.md §14 I2 #3).
   - `WHATSAPP_GRAPH_API_VERSION` — optional; defaults to the version the app
     was built against. The superadmin WhatsApp health page warns once the
     configured version is past its documented review date, which is the cue
     to bump this rather than wait for Meta to retire it out from under every
     tenant.
   - `RATE_LIMIT_DRIVER` — optional; leave unset. Unset means the rate-limit
     windows live in MySQL (PLAN.md §14 I1), which is what makes a limit
     survive a redeploy and hold if the app is ever run as more than one
     process. Setting it to `memory` returns to per-process counting and is
     for debugging the limiter only.
   - `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production` —
     optional; leave unset to run without error tracking
   - `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` — optional, only
     needed to upload source maps at build time
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — optional; leave unset to run
     with invites/password-reset shown as an on-screen link instead of
     emailed (PLAN.md §10 1M). Get a key from resend.com, verify the sending
     domain there, then set `RESEND_FROM_EMAIL` to an address on it (e.g.
     `no-reply@tudominio.com`) — an unverified domain's sends are rejected.
5. **Deploy** once so the app and its build exist, then map the custom
   domain (hPanel → domain mapping on the app, SSL is automatic). Update
   `APP_URL` to match once the domain is live, then redeploy.

## 2. Running migrations

Run migrations from a **local machine**, not Hostinger SSH — see §3 for why.

1. hPanel → Databases → **Remote MySQL** → add your current public IP.
2. Get the external host/port shown on that same page (different from the
   app's internal `localhost` connection).
3. Set `DATABASE_URL` for your local shell to that external host/port, then:
   ```
   npx drizzle-kit migrate
   ```
4. First deploy only — seed the owner's real tenant (PLAN.md §10 1H #1):
   ```
   TENANT_NAME="..." TENANT_SLUG=... TENANT_ADMIN_EMAIL=... \
   TENANT_ADMIN_PASSWORD=... TENANT_ADMIN_NAME="..." \
   npx tsx scripts/seed-tenant.ts
   ```
   Safe to re-run later (e.g. to reset the admin password) — see the script
   header. Bootstrap a platform superadmin the same way with
   `npm run create-superadmin -- <email> <password> <name>` if one doesn't
   exist yet.

Every subsequent deploy that adds a migration: repeat step 3 against the
external host **before** or immediately after the code deploy — this app
doesn't run migrations automatically on boot.

## 3. Why not run migrations via Hostinger SSH

Hostinger's shared servers have a documented history of broken IPv6 routing
to external DB endpoints; even though this is Hostinger's own MySQL (not an
external provider like Neon), the safer, verified path is to keep one-off DB
commands on a local machine (IPv4) rather than debugging it fresh on every
deploy. If SSH is used anyway: `npm`/`npx` aren't on the default PATH —
`export PATH=/opt/alt/alt-nodejsNN/root/usr/bin:$PATH` first (match the
installed Node version under `/opt/alt/`).

## 4. Point Meta's webhook at the app

Required before inbound WhatsApp works at all — outbound sending needs only
the per-tenant token, but nothing arrives in the Inbox until this is set.
One endpoint serves every tenant; Meta routes by `phone_number_id`
(PLAN.md §6.3), so this is configured once per Meta app, not per tenant.

1. Meta developer app → **WhatsApp → Configuration → Webhook → Edit**.
2. Callback URL: `https://<app-domain>/api/webhooks/whatsapp`
3. Verify token: the exact `WHATSAPP_WEBHOOK_VERIFY_TOKEN` value set in
   hPanel. Meta immediately GETs the URL with a challenge and expects it
   echoed back — a mismatch (or an app that hasn't been restarted since the
   env var was added) fails verification with a 403.
4. Subscribe the app to the **`messages`** webhook field.
5. Confirm `WHATSAPP_APP_SECRET` in hPanel matches the Meta app's secret —
   POSTs are rejected with 401 on a signature mismatch, which looks
   identical to "no messages arriving" from the UI.

Meta pauses a subscription that keeps failing, so re-check this after any
domain change. `docs/SMOKE_TEST.md` §2 verifies inbound delivery end-to-end.

## 5. Cron fallback (worker safety net)

The job queue worker ticks in-process every ~2s via `instrumentation.ts`
(§2.1: "no cron guarantees" on Hostinger, hence a fallback, not the primary
mechanism). Set up an external cron (Hostinger's own cron jobs, or any free
uptime/cron pinger) to hit:

```
GET https://<app-domain>/api/cron/tick
Header: x-cron-secret: <CRON_SECRET>
```

Every 1–5 minutes is plenty — it just processes one due job per call as a
backstop if the in-process loop ever stalls. It also indirectly keeps the
`webhook_events` pruning chain (PLAN.md §10 1H #3) alive if the worker loop
itself isn't running for some reason, since a stalled worker means both the
regular loop and the pruning chain are stuck at the same time.

### Subscription expiry warnings (§10 1M)

A second, independent cron entry — once a day is enough, this isn't a queue:

```
GET https://<app-domain>/api/cron/subscription-warnings
Header: x-cron-secret: <CRON_SECRET>
```

Emails every admin of a tenant whose subscription crosses 7 days or 1 day
from expiry. No-ops silently (logs instead) if `RESEND_API_KEY` /
`RESEND_FROM_EMAIL` aren't set — safe to add this cron entry before email is
configured.

### Ingest alerts (§5.2.5)

A third daily cron entry — the one that tells the owner a client site stopped
delivering leads before a customer does:

```
GET https://<app-domain>/api/cron/ingest-alerts
Header: x-cron-secret: <CRON_SECRET>
```

Emails every admin of a tenant when one of its sites' **last** ingest attempt
failed, or when a site that used to produce leads has been silent for 3+ days.
Notifies on the transition, not daily until it's fixed, and re-arms itself once
the site recovers. Daily is the intended cadence: the failure being caught is
"this has been broken since Tuesday", and a broken client form isn't fixed any
faster by hearing about it hourly. Same optional-email behavior as the
subscription warnings — safe to add before `RESEND_API_KEY` is configured, and
the per-site status column on `/sites` is the fallback surface either way.

### AI auto-reply (§10 1O)

Off by default and safe to deploy unconfigured: with `AI_DRIVER=none` the
`ai_reply` automation node skips with reason `ai_not_configured` and nothing
else changes.

To enable, set on the app's environment:

| Var | Value |
|---|---|
| `AI_DRIVER` | `openai` or `gemini` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | only the selected driver's key is required — the app refuses to boot if it's missing |
| `AI_MODEL` | optional; defaults to `gpt-4o-mini` / `gemini-2.0-flash` |
| `AI_BASE_URL` | optional; for Azure OpenAI or an OpenAI-compatible gateway |

**Cost is per-token and per-tenant.** The provider bill is the platform's, not
the tenant's, so treat these as spend controls, not preferences:

- Every tenant starts with AI **off**, and on **draft** mode if turned on. A
  flow node cannot send autonomously while the tenant is on draft — both
  switches have to be flipped, deliberately, by a tenant admin.
- The per-conversation and per-tenant daily caps (Configuración → Respuestas
  con IA) bound provider calls, drafts included. Defaults: 3 per conversation,
  200 per tenant, per day; hard ceilings of 20 and 2000 that the form cannot
  exceed.
- Monthly token totals per tenant are on the same settings page. Check them
  after the first week of any tenant you switch to autonomous.

Nothing is ever sent outside the WhatsApp 24-hour window — outside it the only
legal message is a Meta-approved template, which an LLM cannot author, so
generation is refused rather than drafted.

### The website chat widget shares this budget

The embeddable chat widget (Chat web) uses **the same driver and the same env
vars** — there is no second AI configuration to set. Two things follow, and
both matter on the bill:

- **The per-tenant daily cap is one number across both channels.** A WhatsApp
  reply and a chat reply spend from the same 200/day. That is why `ai_replies`
  carries a `channel` column rather than the widget having its own table.
- **The per-conversation cap is separate**, because a website chat is chattier
  than a WhatsApp thread: 12 per conversation per day by default, ceiling 60,
  set per widget.

The same draft-first rule applies and is enforced the same way: while the
tenant is on draft, a widget set to autonomous still drafts. A visitor is never
shown a draft, a tripped cap, or a provider error — all four cases read as "a
person will reply shortly", so the tenant's billing state never reaches their
customer.

The widget's own key (`data-widget="wgt_…"` in the embed snippet) is **public
by design**, like a Turnstile site key. It is not a secret and nothing is
authorised by holding it; the widget is served in an iframe from this app's own
origin, so no CORS header is added anywhere and `/api/v1/leads` is untouched.

## 6. Process restart

hPanel → the app → **Restart**. Required after any environment variable
change (redeploy also restarts it; editing env vars alone does not take
effect until a restart/redeploy). The in-process worker restarts
automatically with the app — no separate process to manage.

## 7. Rollback

1. hPanel → the app → **Deployments** (or Git tab) → redeploy a previous
   commit/build. Hostinger's Node.js apps keep recent build history for
   this.
2. If the bad deploy included a migration that needs reverting: check
   `drizzle/` for the corresponding down migration, or, given how young this
   schema is, prefer a forward-fixing migration over an automatic down —
   Drizzle Kit doesn't auto-generate downs, and this schema has no data
   migrations complex enough yet to make a manual down risky to write.
3. After rolling back code, verify `DATABASE_URL` and the other env vars in
   hPanel still match what the rolled-back build expects (a schema/env drift
   between them is the usual cause of a rollback still crashing).
4. Confirm with `docs/SMOKE_TEST.md` before calling the rollback done.

## 8. Diagnosing a blank HTTP 500

In production Next.js returns an empty 500 body for any unhandled error, and
the login form shows one generic "wrong credentials" message no matter what
actually failed — so a broken database connection and a wrong password look
identical from the browser. Ask the app directly instead:

```
curl -s -i -H "x-cron-secret: <CRON_SECRET>" https://<app-domain>/api/health/db
```

- `200 {"ok":true,...}` — the app can reach MySQL; the 500 is elsewhere.
- `503` with `"code":"ER_ACCESS_DENIED_ERROR"` — credentials/grant problem.
  Check the reported `target.host`/`target.user`/`target.database` against
  hPanel; note the app connects over the **internal** host, whose MySQL grant
  is separate from the Remote MySQL allowlist used for migrations, so
  changing the password in one place does not necessarily fix the other. If
  the user shows as `'user'@'::1'` in the server log, see below.
- `503` with `ECONNREFUSED` — wrong host/port.
- `401` — `CRON_SECRET` in hPanel doesn't match what you sent.

**`Access denied for user '...'@'::1'`**: Node 18+ resolves `localhost` to
the IPv6 loopback `::1`, which Hostinger's grant (`@localhost`/`@127.0.0.1`)
doesn't cover. `src/db/url.ts` now rewrites a `localhost` (or `[::1]`) host
in `DATABASE_URL` to `127.0.0.1` at pool creation, so a deploy of this code
fixes it without an env change; setting `DATABASE_URL` to `127.0.0.1`
directly is equivalent.

## 9. Post-deploy checklist

- [ ] App loads at the deployed URL over HTTPS
- [ ] Login works with real (not seed-default) admin credentials
- [ ] `docs/SMOKE_TEST.md` passes
- [ ] `/api/cron/tick` returns 401 without the header and 200 with it
- [ ] Meta webhook shows as verified and subscribed to `messages` (§4)
- [ ] Sentry (if configured) shows the deploy's release/environment

## 10. Confirming `TRUSTED_PROXY_HOPS`

Every per-IP rate limit in the app — the public quote and nota de venta
pages and their PDF routes, `/api/storage`, the login limiter, the public
form endpoint — asks `src/lib/http/client-ip.ts` who the caller is. That
helper reads `x-forwarded-for` **from the right**, because the right-hand
entries are the ones our own infrastructure appended; anything further left
was supplied by the caller and can say whatever it likes. `TRUSTED_PROXY_HOPS`
is how many entries at that end belong to us.

`1` is the default and matches this deploy as it stands: LiteSpeed proxies to
the Node process and appends the address it accepted the connection from.
**Put a CDN in front — Cloudflare, or Hostinger's own — and the value becomes
`2`**, because the CDN edge appends one entry and LiteSpeed appends the edge's
address on top of it. Nothing in the code changes; only the env var does.

Too low and the limiter keys on our own proxy's address, so every visitor
shares one bucket. Too high and it keys on a caller-supplied entry, which is
the spoofable state this exists to prevent. So verify it once per topology
change, and again after any CDN or DNS change:

1. Submit one lead from a machine whose public IP you know — the live public
   form, or `curl -X POST https://<app>/api/v1/leads -H 'x-api-key: …'` with a
   throwaway payload.
2. Read back what was stored:
   ```sql
   SELECT ip_address, created_at FROM lead_submissions ORDER BY created_at DESC LIMIT 1;
   ```
3. Compare:
   - **Your own public IP** → the value is right.
   - **A private address** (`10.x`, `172.16–31.x`, `127.0.0.1`) → too low; the
     proxy's own address is winning. Increase by one and repeat.
   - **A CDN edge** (Cloudflare's ranges, an address that isn't yours and
     isn't private) → too low by exactly the CDN hop; set `2`.
   - **An address you can't account for** → too high: the header is shorter
     than configured and the helper has clamped to a caller-supplied entry.
     Decrease and repeat.
