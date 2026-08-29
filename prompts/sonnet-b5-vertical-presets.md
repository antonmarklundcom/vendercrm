# Phase B5 — Vertical presets + onboarding wizard. Paste into a fresh SONNET session, ONLY after B4 is merged.

Read `plan-booking.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan-booking §6.1 under the autonomy protocol §4.

HARD LIMITS (Sonnet phase): NO schema, auth, slot-logic, or notification-chain
changes. Create data only through existing module services (booking, crm,
automations, tenancy). If a preset needs something the foundation lacks: workaround
+ Backlog note, never a foundation change.

Phase rules:
- Branch `phase/b5` off latest main. B4 unmerged ⇒ finish it first.
- Load skills: `paraguay-business-apps` (§5 pipeline stages, siesta hours, voseo).
- Presets are code (typed catalog), applied additively + idempotently — re-applying
  never duplicates or deletes tenant data; `vertical` stored in TenantSettings.
- Each preset includes: booking types with realistic PY durations/buffers/questions,
  resources, availability with siesta split where the rubro warrants it, pipeline
  stages (Nuevo → Contactado (WhatsApp) → Cotizado → Negociando → Ganado/Perdido),
  no-show reactivation flow, post-completed review-request flow.
- Wizard: rubro picker → preview of what will be created → apply → "conectá tu
  WhatsApp" pointer → share `/b/` link. Voseo copy; es/en/sv keys in sync.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: every preset applied to a fresh demo tenant yields a working public booking
page (manually verified via the run skill or a seed test); idempotency test green;
messages test green; lint/build/tests green; PR merged.

## After this phase — hand off (fresh session)
Four gates (merged green; exit checklist; pre-handoff audit; §9 entry), then
`create_session` (inherit env + permission mode, never `plan`; model: Sonnet — never
Fable) with prompt exactly:
`Read prompts/sonnet-b6-polish-widget.md in this repo and execute it.`
No `create_session` → continue in this window (same model).
