# Deploy runbook — Hostinger

Written for the managed Node.js hosting plan. Roughly 45 minutes end to end.

## What you need first

- A Hostinger plan with **Node.js hosting** (any region — the server's location
  only affects latency, not behaviour; a US plan serving Paraguay is fine).
- A subdomain or domain pointed at it, e.g. `crm.tudominio.com`.
- **HTTPS enabled.** Not optional: Meta refuses to deliver WhatsApp webhooks
  to plain HTTP, and it fetches quote PDFs over the public URL too.

## 1. Create the MySQL database

Yes — you create it in Hostinger, the app does not do it for you.

1. hPanel → **Databases → MySQL Databases**
2. Create a database, a user, and a strong password. Note all three.
3. Hostinger shows the host as `localhost` for apps on the same plan. Use that
   rather than the public hostname when the app and database share a plan.

The connection string becomes:

```
mysql://DBUSER:DBPASSWORD@localhost:3306/DBNAME
```

If you ever host the database elsewhere, enable **Remote MySQL** and whitelist
the app's IP, otherwise the connection is refused.

## 2. Deploy the code

hPanel → **Website → Node.js**: connect the GitHub repo, branch `main`.

- Build command: `npm run build`
- Start command: `npm start`
- Node version: 22

## 3. Environment variables

hPanel → Node.js → **Environment variables**. All of these are required — the
app validates them at boot and refuses to start with a clear error rather than
failing mysteriously later.

| Variable | Value |
|---|---|
| `DATABASE_URL` | from step 1 |
| `APP_URL` | `https://crm.tudominio.com` — must be the real public URL, it is used to build WhatsApp document links |
| `APP_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BETTER_AUTH_SECRET` | same generator, a different value |
| `CRON_SECRET` | same generator, a different value |
| `WHATSAPP_APP_SECRET` | Meta app → Settings → Basic → App Secret |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | any string you invent; you paste the same one into Meta |
| `STORAGE_DRIVER` | `local` to start (see the warning below) |
| `NODE_ENV` | `production` |

**Keep `APP_ENCRYPTION_KEY` safe and never rotate it casually.** WhatsApp access
tokens are encrypted with it; change it and every connected number stops working
until you reconnect it.

## 4. Run the migrations

SSH into the plan, then:

```bash
cd ~/domains/crm.tudominio.com/public_html   # wherever hPanel put the app
npm run db:migrate
```

If `npm` isn't found over SSH, use the full path Hostinger's Node version
provides — hPanel → Node.js shows it.

Re-run this after every deploy that adds a migration. It is safe to run when
there is nothing to apply.

## 5. Create your superadmin

Public sign-up is deliberately closed, so the first account is made by script:

```bash
npm run create-superadmin -- tu@correo.com "una-contraseña-larga" "Tu Nombre"
```

Then log in at `/login` and go to `/tenants` to create your first company.

## 6. Point Meta at the webhook

Meta app → WhatsApp → Configuration → Webhook:

- Callback URL: `https://crm.tudominio.com/api/webhooks/whatsapp`
- Verify token: the `WHATSAPP_WEBHOOK_VERIFY_TOKEN` you set
- Subscribe to the **messages** field

Meta calls the URL immediately to verify. If it fails, the usual causes are
HTTPS not being active yet or a typo in the token.

## 7. Smoke test

1. `/login` loads and you can sign in.
2. `/tenants` — create a company; a default pipeline appears in it.
3. `/sites` — create a site, copy the key, and post a test lead:
   ```bash
   curl -X POST https://crm.tudominio.com/api/v1/leads \
     -H 'Content-Type: application/json' -H "X-Api-Key: TU_CLAVE" \
     -d '{"phone":"0981123456","name":"Prueba","idempotency_key":"test-1"}'
   ```
   Expect `201`. Repeat the exact same command: expect `200` with
   `"duplicate": true` and still only one contact.
4. `/whatsapp` — connect a number, then message it from your phone. The message
   should appear in `/inbox` within a few seconds.
5. `/quotes` — create a quote and open its public link.

## Known Hostinger specifics

- **Disk is not durable.** Files written by the app can disappear on redeploy.
  Quote PDFs survive because they are re-rendered on demand, but **downloaded
  WhatsApp media does not**. Move `STORAGE_DRIVER` to S3-compatible storage
  (Cloudflare R2) before this matters to you.
- **One Node process.** The background worker runs inside the web process
  (`instrumentation.ts`). It starts automatically; there is nothing separate to
  keep alive. This is also why the job queue is in MySQL and not Redis.
- **Restarts clear rate-limit counters.** Harmless — they exist to blunt floods.
- **The app must actually be running** for automations and scheduled sends to
  fire. If Hostinger idles the process, delayed steps run late, not never — they
  are rows in the database, so they resume when the process comes back.

## Backups

hPanel → Files → Backups covers the database. Verify a restore *before* you
rely on it: download a dump, import it into a scratch database, and confirm the
tables have rows. An unverified backup is not a backup.

## Error tracking

Errors are emitted as structured JSON lines, greppable by `event` and `scope` in
Hostinger's log view. To send them somewhere, wire a reporter in the single
function `src/lib/observability/index.ts` — that is the only place that needs to
change.
