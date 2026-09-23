# Next session: finish launch inputs, then the rest of the CRM calm-down

Repo: `antonmarklundcom/vendercrm`. Run on **Opus 5.5, medium or high effort**,
never Fable (fable-cost-guardrail). Anton is at the keyboard, so ask him
directly instead of parking questions in a doc.

**Anton's standing rule:** merge every PR you open yourself once CI is green
on its current head and it has no conflict, in the order opened. Squash-merge,
like the repo's history.

## Where the last session left off (2026-09-23)

Merged to `main` (live after the next deploy):
- **#143 Marketing design pass.** Mobile menu, a header CTA ("Diagnóstico
  gratis"), `:where(.mk) p` (fixes the grey statement and the eyebrow/meta
  paragraphs), ~30% tighter section padding, full-width CTAs on phones, the P3
  grid ending on a full row, "Otros rubros" as text links, the closing-band
  panel beside its heading, and the article header aligned with the body.
  Recorded in `docs/MARKETING_DESIGN.md` §3 "Design pass, 2026-09-23".
- **#144 CRM shell.** Seven pinned daily items plus three folding groups; a
  mobile menu bar instead of the 23-item strip; a business switcher with
  search, recents and arrow keys; one `PageHeader` pattern (actions right,
  toolbar row under); deal-card values formatted.
- **#145 CRM create dialogs.** `components/create-dialog.tsx`. Pipeline,
  contacts (+ tag), products, quotes, sale notes, companies, contracts,
  automations and calendar create in a dialog from the page header. The old
  `#nuevo-*` anchors still open it.
- **#146 Contacts filters.** Search stays visible; the other nine filters
  fold behind "Más filtros", which opens when one is set in the URL.
- **#147 Docs.** `docs/sales/diagnostico-template.md` (the post-call report,
  Paraguayan Spanish with voseo) and this prompt.

Check the PR list first. If any of #143–#147 is still open, drive it to green
and merge it before anything else.

Owner decisions, do not reopen: sell **results**, not the CRM; **no public
pricing**; **no invented social proof**; no Google Analytics until there is
traffic; images or video **only** when Anton writes "Generate image" or
"Generate video" (then follow `higgsfield-image-pipeline`).

## 1. Still waiting on Anton: ask in one message, first thing

None of these were answered last session:

1. **Contact details:** phone, public email, one-line address, RUC →
   `src/lib/site-config.ts` (each is a `null` with `TODO(owner)`). Check the
   header phone link, footer and trust-ribbon RUC at 390px after.
2. **`VENDERCRM_API_KEY` on Hostinger?** If yes: one real submission on
   clientes.com.py/contacto, confirm the contact and deal in the CRM, submit
   again and confirm it deduplicates (`docs/MARKETING_DESIGN.md` §7). If no:
   Sitios → create "clientes.com.py" → copy the key into Hostinger env vars →
   redeploy.
3. **`*.cloudfront.net` in the cloud environment's allowed domains?** Test
   `curl -sI -m 15 https://d8j0ntlcm91z4.cloudfront.net/`. It returned **403
   from the proxy** last session. If it works now: download `HERO_VIDEO_SRC`,
   re-encode H.264 under ~4 MB with a poster, commit
   `public/videos/hero-loop.mp4`, point the constant at it.
4. **Mailbox decisions** (`docs/CLIENT_EMAIL_OPTIONS.md` §7): note any answers
   there; don't build.
5. **Two design decisions from the audit:**
   - **M3:** the two floating WhatsApp buttons (his earlier request). On a
     phone the top one covers the page eyebrow under the header and the
     bottom one covers the page's own WhatsApp CTA. Proposal: move the top one
     into the header as a WhatsApp icon link, keep the bottom one.
   - **M8:** a sector-specific visual beside each `/soluciones` heading (the
     eight sector pages open with an identical text-only block). Proposal: the
     home hero's "consultas de esta semana" preview with per-rubro example
     enquiries, labelled "Ejemplo ilustrativo". That's copy for 8 sectors × 3
     locales.

Batch any site-config edit, video and M3 into one PR.

## 2. Finish the CRM calm-down (`prompts/fable-crm-design-calm-down.md`)

Done: goals 2, 3 and 4, most of goal 1, and the contacts filter bar.
Remaining, in order:

1. **Goal 1, remaining pages.** Still stacking forms inline: `/forms`,
   `/sites` (careful: creating a site reveals an API key once, so a dialog
   must not close on success — keep it open until the user dismisses it, and
   make it `dismissible={false}` while the key is showing), `/users`,
   `/whatsapp`, `/booking`, `/chat`, `/settings`. Use `CreateDialog` and the
   three close paths documented at the top of `create-dialog.tsx`. Only move
   *occasional creation*; settings forms that *are* the page stay inline.
2. **Goal 5, surface treatment.** Almost every block is the same bordered
   card. Spend border, fill and elevation by role: board columns as a quiet
   fill, cards raised, tables unboxed. **Don't touch the colour tokens** in
   `globals.css`.
3. **Dialog primitive.** `ui/dialog.tsx` has no focus trap and doesn't return
   focus to the trigger on close. Add both there, not in each caller.

One PR per numbered item is fine. They're independent.

## 3. If time remains

- **Google Business Profile** for clientes.com.py (`gbp-optimizer` skill),
  once §1.1 contact details exist.
- Ask Anton whether he wants `docs/sales/diagnostico-template.md` as a
  shareable document too.

## Seeing the CRM locally (worked last session)

```bash
npm ci
# throwaway .env: DATABASE_URL=mysql://root:root@127.0.0.1:3306/vendercrm,
# APP_ENCRYPTION_KEY (64 hex), CRON_SECRET, BETTER_AUTH_SECRET,
# WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN. Delete before committing.
apt-get update && apt-get install -y mariadb-server && service mariadb start
mysql -uroot -e "CREATE DATABASE vendercrm; ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('root');"
npx drizzle-kit migrate
set -a; . ./.env; set +a
TENANT_NAME="Clínica Demo" TENANT_SLUG=demo TENANT_ADMIN_EMAIL=admin@demo.test \
  TENANT_ADMIN_PASSWORD='DemoPass!2026' TENANT_ADMIN_NAME="Ana Demo" npx tsx scripts/seed-tenant.ts
```

Then seed ~12 contacts and deals with `createContact` / `createDeal` from
`src/modules/crm/` and ~26 extra businesses (`createTenant` + `addMembership`
as admin) in a throwaway script under a git-excluded folder. Wrap the script
body in `async function main()`, because tsx runs it as CJS. `npm run build &&
npx next start` on a single CPU takes ~8 minutes. Screenshot with
`playwright-core` installed in the scratchpad (Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), logging in at
`/login`. Killing processes with `pkill -f <pattern>` can match your own shell
and MariaDB; target `^next-server` exactly. If MariaDB stops, run
`service mariadb start`.

Lighthouse in this sandbox reads LCP 3–4.4 s on **both** `main` and branches
(one CPU), so compare against a `main` build on the same machine, not against
the production numbers.

## Handover

End with a short list for Anton: what merged, what's live after the next
deploy, and what still needs him. If a phase is left unfinished, write the
next prompt as `prompts/opus-next-<topic>.md`.
