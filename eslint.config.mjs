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
      "src/modules/tenancy/**/*.{ts,tsx}",
      // Auth operates on platform-level, intentionally un-scoped auth tables
      // (login resolves a user by email across all tenants) — PLAN.md §3.3.
      "src/modules/auth/**/*.{ts,tsx}",
      // Audit writes only its own platform-level table, keyed by an explicit
      // tenantId argument — it never reads tenant data (PLAN.md §3.3).
      "src/modules/audit/**/*.{ts,tsx}",
      // Billing (plans/subscriptions/payments) is superadmin-managed and
      // platform-level, not tenant-scoped operational data (PLAN.md §3.1).
      "src/modules/billing/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
