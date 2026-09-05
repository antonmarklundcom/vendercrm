# Phase P8 — Link pass for the P-wave. SONNET session. Sequential, after P3–P7 merge.

Read ONLY: this file, PLAN.md §15.8, §15.9, `plan-booking.md` §4, and
`docs/log/p1.md` … `docs/log/p7.md`. Execute under the autonomy protocol.

Owns: `src/components/app-nav.tsx` (menu entries for quick replies, custom
fields, email settings, notifications), dashboard onboarding checklist rows
(P7's file), `docs/HANDOFF.md` (a new Part for this wave: env vars to add —
VAPID, `EMAIL_DEFAULT_DOMAIN`; migrations to run; the Android push check; the
Resend domain check), `docs/SMOKE_TEST.md` rows, `KNOWN-ISSUES.md` (create;
promote only still-open cross-phase items from the seven logs), `messages/*`
for the nav keys, `docs/log/p8.md`, PLAN.md §15.9 index.

Budget: one session, ≤ 60 min. Branch `phase/p8` off latest main.

Rules:
- Cross-cutting edits only; no feature work. Anything you are tempted to build
  goes to PLAN.md §15.6.
- Run the full local checks once; CI is the check on integration suites.
- Closing report in the PR body: what merged, the env vars and migrations the
  owner must apply, the two human checks (push on Android, own-domain email).

Exit: nav shows every new surface; parity test green; HANDOFF Part written;
lint/typecheck/test/build green; PR merged.

## After this phase
Delete the watcher Routine, then STOP with the closing report. Spawn nothing.
