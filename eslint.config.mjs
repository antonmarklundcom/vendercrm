import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Raw DB access is confined to src/db, src/worker, and the tenancy
    // module — everywhere else must go through the tenant-scoped access
    // layer (PLAN.md §3.3). This is a merge gate, not a suggestion.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/client", "**/db/client"],
              message:
                "Raw db import is banned here — use the tenancy-scoped db access layer (PLAN.md §3.3). Allowed only in src/db, src/worker, src/modules/tenancy.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/db/**/*.{ts,tsx}",
      "src/worker/**/*.{ts,tsx}",
      "src/lib/queue/**/*.{ts,tsx}",
      // Same rationale as lib/queue: the rate limiter is platform-level
      // infrastructure with no tenant at all — it counts requests from
      // unauthenticated callers *before* anyone is identified (PLAN.md §14
      // I1 #1). Its one table holds no tenant data.
      "src/lib/rate-limit/**/*.{ts,tsx}",
      "src/modules/tenancy/**/*.{ts,tsx}",
      // JUDGMENT CALL (flagged for Fable review): the WhatsApp webhook
      // receiver has no session and no tenant slug — it only has a Meta
      // phone_number_id, and must find *which* tenant owns it before any
      // TenantContext can exist (PLAN.md §6.3 rule 3: "route phone_number_id
      // → wa_accounts → tenant"). That one routing lookup is structurally a
      // platform-wide read, the same shape as tenancy's own token/slug
      // lookups — everything else in this module still goes through
      // tenantDb once the tenant is resolved.
      "src/modules/whatsapp/**/*.{ts,tsx}",
      // Same rationale as whatsapp above: the public lead-ingest endpoint
      // authenticates by API key and must resolve key → site → tenant
      // *before* any TenantContext can exist (PLAN.md §5.1). Only that
      // routing lookup touches raw db; every CRM-side write goes through
      // modules/leads and tenantDb once the tenant is known.
      "src/modules/sites/**/*.{ts,tsx}",
      // Same rationale again: the public quote view /q/[token] resolves an
      // unguessable token to its quote — and therefore its tenant — before
      // any TenantContext exists (PLAN.md §8). That single lookup is the
      // only raw-db use here; the items and everything else are read back
      // through tenantDb once the tenant is known.
      "src/modules/quotes/**/*.{ts,tsx}",
      // Same rationale as quotes: the public nota de venta view /d/[token]
      // resolves an unguessable token to its document — and therefore its
      // tenant — before any TenantContext exists (PLAN.md §10 1Q). That
      // single lookup is the only raw-db use here; items, payments and
      // everything else are read back through tenantDb once the tenant is
      // known.
      "src/modules/documents/**/*.{ts,tsx}",
      // Same rationale as quotes and documents: the public booking surface
      // resolves a tenant *slug* (/b/[tenantSlug]/[typeSlug]) and an
      // unguessable manage token (/b/g/[token]) to their tenant before any
      // TenantContext exists (docs/SPEC-BOOKING.md §5). Those two lookups
      // are the only raw-db use here; slots, reservations and cancellations
      // all go through tenantDb once the tenant is known.
      "src/modules/booking/**/*.{ts,tsx}",
      // Same rationale as booking: the public chat widget resolves a
      // `widgetKey` from an embed snippet to its tenant before any
      // TenantContext exists (docs/SPEC-CHAT-WIDGET.md §3). That one lookup
      // is the only raw-db use here; conversations, messages and the AI
      // spend caps all go through tenantDb once the tenant is known.
      "src/modules/chatwidget/**/*.{ts,tsx}",
      // Same rationale as the routing lookups above, from the other
      // direction: a web push endpoint is the identity of a *browser*, and
      // `push_subscriptions.endpoint` is unique platform-wide because a
      // browser is one browser (PLAN.md §15.5 J2). Re-subscribing after
      // switching business — or after somebody else signs in on the same
      // phone — has to clear the row that endpoint already holds, which by
      // definition may sit in a tenant the caller has no context for. That
      // one delete-by-endpoint is the only raw-db use here; every other read
      // and write in this module goes through tenantDb.
      "src/modules/notifications/**/*.{ts,tsx}",
      // JUDGMENT CALL (flagged for Fable review, not explicit in PLAN.md
      // §3.3's exemption list): the Better Auth instance (src/lib/auth/server.ts)
      // is infra wiring handed the raw `db` client by the Drizzle adapter,
      // the same shape as db/client.ts or worker/index.ts — not business
      // logic. Everything that actually reads/writes tenant data still goes
      // through src/modules/tenancy or src/modules/auth (which holds no raw
      // db import of its own).
      "src/lib/auth/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
