# Phase R4 — AI on the laptop (Ollama), optional cloud, more import formats. OPUS 5.5 session (medium effort).

Read first:
- `PLAN-PROSPECTING.md` §1, §4.2 (R4 tables), §7 and §10.
- `docs/log/r2.md`, `docs/log/r3.md`.
- `src/lib/ai/{types,index,openai,structured}.ts`.
- Token and route pattern: `src/modules/ops/{tokens,http}.ts`, `src/modules/sites/keys.ts`.
- `src/lib/rate-limit/index.ts`, `src/lib/config/env.ts`.
- `src/modules/prospecting/**`.
- Separate-package pattern: `workers/email-inbound/` (package, and how it is excluded from the build).

Branch: `phase/r4-ai` off the latest `main`. One PR. Log in `docs/log/r4.md`.

## Hard rules
- **The app works fully with AI off.** Nothing a seller does may wait on an AI job.
- **Prompts live on the server.** The laptop runner is a thin client: claim → call Ollama → post the result. The server validates every result with zod before applying it.
  - Enrich facts whose `sourceUrl` was not in the input are dropped.
  - DNC prospects get no draft/enrich jobs.
- **Worker tokens:** hashed, shown once, revocable, tenant-scoped.
  - Rate limits: per IP before auth, per token after.
  - Leases prevent double processing; add a test with two concurrent claims.
- **Cloud lane:** off by default, platform env only (`AI_CLOUD_*`, all optional in `env.ts`), and a monthly budget stop based on `ai_jobs.cost_micros`. Never print or log keys or tokens.
- **`workers/ai-local/`:** its own `package.json`, no dependencies, excluded from the Next build/tsconfig. Ollama calls use `think: false` and `format` = the job's JSON schema.
  - `install-task.ps1` registers a Task Scheduler task (22:00 daily + at logon, AC power only, single instance).
- **Parsers** (JSON/GeoJSON, vCard 2.1–4.0, pasted text) are pure, with fixture tests. The PY districts list is a static data file.
- **Tables:** one migration, tenant-scoped, isolation tests.
- **i18n:** es/en/sv, parity green.
- **No new GitHub workflow.**

## Real run (required, on Anton's laptop)
1. `ollama pull qwen3:4b`. This is a ~2.5 GB download: ask Anton before pulling.
2. Start the dev server against local MariaDB with the seed data.
3. Create a worker token in the UI and run `npm run once` in `workers/ai-local`.
4. All 12 fake prospects get a score, reason, summary with sources, and drafts.
5. Report the average seconds per job and any JSON failures.

## Exit
Everything in plan §7.7:
- Gates green.
- The real run above.
- The browser at 375 px showing the AI summary and draft on the card, with Hoy sorted by AI score.
- `docs/log/r4.md`.
- PR merged.

Then **stop and report to Anton**. Do not start R5. Spawn nothing. Never Fable.
