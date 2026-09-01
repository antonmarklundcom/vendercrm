# Prompt — clientes.com.py: finish and launch the marketing site

Model: Opus (never Fable — fable-cost-guardrail). Repo: `antonmarklundcom/vendercrm`.

You are continuing work that is already built and validated on branch
`claude/clientes-frontend-service-offer-osgdkc` (merge or branch from it —
check whether its PR has merged first).

Read, in this order, before writing any code:

1. `docs/MARKETING_NEXT_STEPS.md` — the working plan. Follow it top to bottom:
   §2 launch blockers (ask Anton for the site-config values and the
   `VENDERCRM_API_KEY` if he hasn't provided them), then §3 build work.
2. `docs/MARKETING_SITE_PLAN.md` — positioning source of truth. §1.2 locked
   decisions are not up for debate.
3. `docs/MARKETING_DESIGN.md` — the resolved design system (EDITORIAL track,
   palette, patterns). New sections must use the same `.mk` tokens and pass the
   same QA gate.

Skills to load when their step comes: `web-design-system` (any markup change),
`higgsfield-web-imagery` (the imagery pass, mind the credit budget),
`seo-web-builds` (any new page), `gbp-optimizer` (after launch),
`vendercrm-lead-capture` (verifying the form round-trip),
`nextjs-deploy-hostinger` (anything touching deploy/env).

Hard rules carried over from Anton:

- Do not touch CRM code or behavior on `crm.clientes.com.py`. The CRM ideas in
  `MARKETING_NEXT_STEPS.md` §5 are a backlog for Anton to approve, not tasks.
- No fabricated testimonials, cases, numbers, or logos anywhere.
- Paraguayan Spanish with voseo, through `next-intl` (`messages/es.json`);
  en/sv must keep key parity (`src/i18n/messages.test.ts` enforces it).
- Validate before pushing: `npm run lint`, `npm run typecheck`,
  `npx vitest run src/middleware.test.ts src/i18n/messages.test.ts`, and a
  production build. One PR per coherent step, per the repo's usual flow.
