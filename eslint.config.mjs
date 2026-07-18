import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/db/**",
      "src/worker/**",
      "src/lib/queue/**",
      "src/lib/auth.ts",
      "src/modules/tenancy/**",
      "src/modules/audit/**",
      "src/modules/billing/**",
      "src/modules/forms/public.ts",
      "src/modules/whatsapp/webhook-ingest.ts",
      "src/modules/whatsapp/webhook-process.ts",
      "src/modules/whatsapp/admin-queries.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/db/client",
              message:
                "Do not import the raw db client outside src/db, src/worker, or the tenancy module. Use the tenant-scoped access layer instead.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
