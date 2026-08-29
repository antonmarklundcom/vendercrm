# Phase B1 — Foundation: middleware fix, schema, WA-first notifications. Paste into a fresh OPUS session.

Read `plan-booking.md` FIRST, in full — plus its §9 build log and `KNOWN-ISSUES.md`.
Also skim `PLAN.md` §on booking/whatsapp and `docs/SPEC-BOOKING.md` before coding.
Execute plan-booking §5.1 under the autonomy protocol §4. Build nothing outside the plan.

Phase rules:
- Branch `phase/b1` off latest main.
- Load skills: `paraguay-business-apps` (WhatsApp-first + money rules), `nodejs-mysql-hostinger-stack`.
- ALL new schema from plan-booking §2 lands here, including columns B2–B4 use. Follow
  existing migration + schema-file conventions in `src/db/`; tenant_id everywhere;
  isolation tests for the new module.
- The fallback chain (template → free-form if 24h window open → email → logged skip)
  is ONE implementation used by every notification kind. Reminders must stop
  silently skipping.
- Template copy: Paraguayan voseo Spanish; variables via the existing wa_templates
  sync module; per-tenant approval status stored and shown.
- Don't touch slot logic, quotes/documents, or marketing pages.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: `/b/` + `/w/` public and covered by the middleware unit test; migrations apply
cleanly; notification chain unit tests cover all four selection branches; booking
detail shows delivery timeline; lint/build/tests green; PR merged.

## After this phase — hand off (fresh session)
Four gates (PR merged green; exit checklist; pre-handoff audit: re-run build+tests,
adversarially re-read the merged diff, fix findings; §9 build-log entry committed),
then `create_session` (inherit env + permission mode, never `plan`; model: Opus —
never Fable) with prompt exactly:
`Read prompts/opus-b2-engine-extensions.md in this repo and execute it.`
No `create_session` available → continue in this window (same model).
