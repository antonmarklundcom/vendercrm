# Fable 5.1 — CRM interface: reduce density, modernise the shell

Run this in a fresh Claude Code session at the root of `antonmarklundcom/vendercrm`.

---

You are redesigning the signed-in application shell of VenderCRM
(`crm.clientes.com.py`), a multi-business CRM used in Paraguay. Next.js 15
App Router, Tailwind v4, React Server Components, `next-intl` with three
locales (es / en / sv).

## The problem, stated precisely

The app is **not ugly — it is overwhelming.** Every screen presents everything
at once, so nothing has priority and the product reads as a database with a
menu rather than a tool. Two specific causes:

**1. Pages stack creation forms under working surfaces.**
`/pipeline` renders the kanban board, then a full "Nuevo negocio" form, then a
second "Nueva pipeline" form, all inline on the same scroll. The board is the
page; the forms are occasional actions. This pattern repeats across the app.

**2. The sidebar shows 23 items, always expanded, in four groups.**
Every business shows the same 23 whether or not that business uses bookings,
WhatsApp, contracts or products. A dentist rank-and-rent site and a crane hire
get an identical wall of navigation.

The owner runs **27 businesses** from one login and switches between them
constantly, so the shell is the surface he sees most and the one that most
needs to feel calm.

## What to do

1. **Move occasional creation into overlays.** Inline creation forms become a
   primary action in the page header opening a dialog or side drawer. The
   working surface — board, table, list — becomes the whole page. Use the
   existing `src/components/ui/dialog.tsx`; do not introduce a new primitive.

2. **Give the sidebar a hierarchy.** 23 flat items is the core problem. Options
   worth weighing (pick and argue for one, don't do all three): collapse
   groups to the active one; demote configuration behind a single entry;
   surface a small pinned set and put the rest behind a command palette
   (⌘K). Nav order and grouping live in `src/app/(app)/layout.tsx`.

3. **Establish one page-header pattern** — title, one-line description,
   primary action, and where relevant filters — and apply it consistently.
   `src/components/page-header.tsx` exists; several pages bypass it.

4. **Make the business switcher feel like the important control it is.**
   At 27 businesses a dropdown listing them alphabetically is already
   straining. It needs search, and ideally recency.

5. **Modernise the surface treatment.** Right now nearly every block is a card
   with the same radius and border, which flattens hierarchy — everything
   looks equally important. Spend border, fill and elevation by role instead.

## Hard constraints

- **Do not touch the colour tokens in `src/app/globals.css`.** They are
  deliberate, derived from the marketing site's accent, with measured WCAG
  ratios documented in the file header. Work within them. If you believe a
  token is genuinely wrong, say so in your summary rather than changing it.
- **Do not rename or move routes.** URLs are referenced from outside the app.
- **Do not change role gating.** The `Captación` group and several
  `Configuración` items are admin-only by design (`isAdmin` in the layout);
  hiding them from agents is a security posture, not a style choice.
- **All user-visible strings go through `next-intl`** — add keys to all three
  of `messages/{es,en,sv}.json`. Spanish is the primary locale.
- **Three pages ship the literal placeholder `Descripción`** as their page
  description: `/quotes`, `/documents`, `/products`. Write real Spanish copy
  for them (and en/sv) as part of this work. What they do:
  - *Presupuestos* — quotes: numbered, PDF, sent over WhatsApp, accepted by
    the client from a public link, expiring on a schedule.
  - *Notas de venta* — non-fiscal sale notes and receipts, tracking what has
    been paid; what's used until SIFEN electronic invoicing ships.
  - *Productos* — the catalogue feeding quotes and sale notes, CSV-importable.
- `npm run typecheck`, `npm run lint` and `npm test` must all pass. The
  DB-backed suites skip without `DATABASE_URL`; that is expected.

## Method

Start by reading `src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`,
`src/components/page-header.tsx` and two contrasting pages — `/pipeline`
(dense, board) and `/contacts` (dense, table).

**Show the plan before building it.** Describe the redesigned shell and the
one sidebar approach you chose, and say what you are deliberately leaving
alone. A design that changes less but makes the hierarchy legible beats a
reskin.

Then implement across the whole app, not one page — consistency is the point.
Commit to a branch and open a PR with before/after notes per surface.

## What good looks like

Opening `/pipeline` on a business you haven't touched in a month, you see the
board and immediately know which deals need attention. Creating a deal is one
obvious click. The sidebar tells you where you are without making you read 23
labels. And it looks like software someone chose, not software someone
generated.
