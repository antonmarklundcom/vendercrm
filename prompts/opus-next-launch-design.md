# Next session: launch inputs, then a design pass on both sites

Repo: `antonmarklundcom/vendercrm`. Run on **Opus**, never Fable
(fable-cost-guardrail). Anton is at the keyboard for this one, so ask him
directly when you need something instead of parking questions in a doc.

**Anton's standing rule for this session:** every PR you open is merged by you
once CI is green on its current head and it has no conflict, in the order
opened. Squash-merge, like the repo's history.

## State when this was written (2026-09-23)

On `main` and live after the next deploy:
- Marketing site repositioned for pymes (#138): three sector pages, and 16
  `/recursos` articles in 8 clusters (#140).
- Fix for the WhatsApp button that showed no label on light pages, and
  `docs/CLIENT_EMAIL_OPTIONS.md` with the mailbox provider research (#139).
- `/contacto` heading order fix (#141).
- Lighthouse on the production build, mobile: accessibility and SEO are 100
  on every page tested. Measured LCP is 1.1–1.8 s with throttling.

Owner decisions, do not reopen:
- clientes.com.py sells **results** (clients, sales, bookings), not the CRM.
  **No public pricing** on this site.
- **No invented social proof:** no testimonials, logos or case numbers.
- No Google Analytics until there is traffic.
- Generate images or video **only** when Anton writes "Generate image" or
  "Generate video" in this chat. Then follow the `higgsfield-image-pipeline`
  skill: GPT Image 2.5 Sunburst for stills, Seedance 2.5 for video, and a
  `get_cost` preflight first.

## 1. First ten minutes: collect Anton's launch inputs

Ask Anton in one message for all of these, then act on each answer:

1. **Contact details:** phone, public email, address (one line) and RUC. Put
   them in `src/lib/site-config.ts`; each field is a `null` with a
   `TODO(owner)` today. Every component renders them automatically once
   they're set. Check the footer, the trust ribbon (RUC) and the tel: link at
   390px.
2. **Is `VENDERCRM_API_KEY` set on the Hostinger app?** If yes, walk him
   through one real test submission on clientes.com.py/contacto. Then check
   that the contact and the deal appear in the CRM, and that a second submit
   deduplicates (`docs/MARKETING_DESIGN.md` §7). If not, give him the steps:
   1. In the CRM, open Sitios and create the site "clientes.com.py".
   2. Copy the key into Hostinger's env vars.
   3. Redeploy.
3. **Did he add `*.cloudfront.net` to the cloud environment's allowed
   domains?** Test with
   `curl -sI -m 15 https://d8j0ntlcm91z4.cloudfront.net/`.
   - A 403 or 000 means no. Tell him the fix once and move on.
   - Yes means you can self-host the existing hero video: download the URL
     in `HERO_VIDEO_SRC` (`src/lib/site-config.ts`), re-encode it to H.264
     under about 4 MB with a poster frame, commit it as
     `public/videos/hero-loop.mp4`, and point the constant at it.
4. **Mailbox decisions:** has he answered §7 of
   `docs/CLIENT_EMAIL_OPTIONS.md`? If yes, note the answers there. Don't
   build the feature in this session unless he asks.

Batch the site-config edit and the video into one PR.

## 2. Design pass: clientes.com.py (the marketing site)

Anton thinks the design can be better. He's right to ask; nobody has done a
critical design review since the first build.

1. **Audit before touching anything.** Run a production build locally.
   - `npm run build && npx next start`, with a throwaway `.env` holding
     dummy DATABASE_URL, APP_ENCRYPTION_KEY (64 hex), CRON_SECRET,
     BETTER_AUTH_SECRET, WHATSAPP_APP_SECRET and
     WHATSAPP_WEBHOOK_VERIFY_TOKEN. Marketing pages render without a DB.
     Delete `.env` before committing.
   - Screenshot every marketing route at 390px and 1366px with Playwright:
     install `playwright-core` in the scratchpad, not the repo; Chromium is
     at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
   - Look at the screenshots yourself. Judge hierarchy, rhythm and spacing,
     type scale, how distinct the pages are from each other (the 8 sector
     pages share one template), how mobile feels, and whether the CTAs stand
     out.
2. **Show Anton a short findings list** (max about 10 items, each with the
   screenshot it came from) and your proposed changes. Build only what he
   approves.
3. **Constraints:**
   - Keep the EDITORIAL track and tokens in `docs/MARKETING_DESIGN.md`. The
     contrast ratios in the `globals.css` header are measured; any colour
     change must be re-measured and re-documented.
   - Copy lives in `messages/{es,en,sv}.json` with key parity (enforced by
     `src/i18n/messages.test.ts`).
   - One `h1` per page, no horizontal overflow, reduced-motion honoured, and
     every CTA keeps its `data-ev` / `data-ev-loc`.
   - Watch CSS specificity: a `.mk <tag>` rule outranks single-class
     components. That caused the invisible-label bug; the fix was
     `:where(.mk) a`.
4. **Verify before the PR.** Compare before/after screenshots of every
   changed page, rerun Lighthouse on /, /contacto, one sector page and one
   article, and run lint, typecheck and
   `npx vitest run src/i18n src/middleware.test.ts`.

## 3. Design pass: crm.clientes.com.py (the CRM app)

`prompts/fable-crm-design-calm-down.md` specifies a redesign of the
signed-in shell that was **never carried out**. The evidence:
- `/pipeline` still stacks the create-deal and create-pipeline forms under
  the board.
- `/products`, `/quotes` and `/documents` still show the literal
  placeholder `Descripción` as their page description.

**Execute that prompt as written, on Opus instead of Fable.** Its problem
statement, five goals, hard constraints (colour tokens, routes, role gating,
i18n) and its "show the plan before building it" step all apply.

- **Seeing it:** the CRM needs a database to render. Start a throwaway local
  MySQL, run the migrations and seed one tenant with a handful of contacts
  and deals so the screenshots show real density. Check `docs/DEPLOY.md` and
  `package.json` scripts for the migrate and seed commands. If MySQL can't
  run in the environment, say so and design from the code plus login-page
  screenshots rather than guessing silently.
- **Scope:** one PR for the shell (sidebar hierarchy, page-header pattern,
  business switcher with search) and one for moving the creation forms into
  dialogs, if the diff gets large.

## 4. If time remains

- **Diagnóstico report template.** This is the sales tool from
  `docs/MARKETING_NEXT_STEPS.md` §4: what Anton hands a pyme after the free
  30-minute call. It shows where their enquiries are being lost, what fixing
  it involves, and the paid next step. Write it in Paraguayan Spanish with
  voseo, as `docs/sales/diagnostico-template.md`. Ask Anton whether he also
  wants it as a document he can share.
- **Google Business Profile** for clientes.com.py (`gbp-optimizer` skill),
  once the contact details from §1 exist.

## Handover

End with a short list for Anton covering:
- what merged;
- what's live after the next deploy;
- what still needs him (anything from §1 he hasn't done).

If a phase is left unfinished, write the next hand-off prompt as
`prompts/opus-next-<topic>.md`, the way this one was written.
