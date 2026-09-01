import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    APP_ENCRYPTION_KEY: z
      .string()
      .length(64, "APP_ENCRYPTION_KEY must be a 32-byte hex string (64 chars)"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_PATH: z.string().default("./.storage"),
    // S3-compatible driver (PLAN.md §10 1K) — Cloudflare R2 is the intended
    // target: free egress, S3 API compatibility, no code specific to R2
    // beyond the endpoint URL. Optional at the schema level and required in
    // practice only when STORAGE_DRIVER=s3 (checked below) — keeping them
    // optional here means a tenant that never sets STORAGE_DRIVER doesn't
    // need to touch these at all.
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // R2 has no regions; the SDK still requires a value, and "auto" is what
    // Cloudflare's own docs tell every client to send.
    S3_REGION: z.string().default("auto"),
    CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),
    /**
     * Where the rate-limit windows live (PLAN.md §14 I1 #1). Unset means
     * MySQL everywhere except tests, which default to the in-memory driver
     * so a unit test needs no database. Set it to `memory` only to debug the
     * limiter itself — a production process on `memory` counts per process
     * and forgets everything on deploy.
     */
    RATE_LIMIT_DRIVER: z.enum(["mysql", "memory"]).optional(),
    /**
     * How many reverse proxies sit in front of this app. Decides which
     * `x-forwarded-for` entry lib/http/client-ip trusts, counting from the
     * right — see that module and docs/DEPLOY.md §10. 1 is Hostinger's
     * managed Node.js hosting as deployed (LiteSpeed → app); a CDN in front
     * makes it 2. Getting it wrong costs accuracy in the rate limiters, not
     * correctness elsewhere, so it defaults rather than being required.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
    // Better Auth session/cookie signing secret (distinct from APP_ENCRYPTION_KEY,
    // which is reserved for AES-256-GCM secrets-at-rest per §3.4).
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    WHATSAPP_APP_SECRET: z.string().min(1, "WHATSAPP_APP_SECRET is required"),
    /**
     * Meta Graph API version the WhatsApp module calls (PLAN.md §14 I2 #2).
     * Defaults to the version this app was built against; overridable so a
     * retirement can be answered with an env change and a restart instead of
     * a deploy. modules/whatsapp/graph.ts documents when each version is due
     * for review, and the superadmin health page warns once that date passes.
     */
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, "WHATSAPP_GRAPH_API_VERSION must look like v21.0")
      .default("v21.0"),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
      .string()
      .min(1, "WHATSAPP_WEBHOOK_VERIFY_TOKEN is required"),
    // Transactional email (PLAN.md §10 1M). Optional, same pattern as Sentry
    // in next.config.ts: absent means email sending no-ops (logs instead of
    // throwing) rather than the app refusing to boot. Lets every environment
    // — local dev, CI, a fresh prod deploy before DNS is warmed — run without
    // it, at the cost of invites/reset links only being usable via the
    // on-screen copy link until it's configured.
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    // AI auto-reply (PLAN.md §10 1O). Provider-neutral by the same shape as
    // STORAGE_DRIVER: one env picks the driver, the driver's own key is
    // required only when it's the selected one. `none` is the default and
    // means the ai_reply action node skips with a reason instead of the app
    // refusing to boot — an unconfigured tenant must still be able to run
    // every other automation.
    // Google Calendar busy-read (plan-booking.md §5.4). Optional by the same
    // rule as Resend and the AI drivers: absent means the feature no-ops —
    // the connect button says it isn't configured and slot generation runs
    // with no Google busy windows — rather than the app refusing to boot.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    AI_DRIVER: z.enum(["none", "openai", "gemini"]).default("none"),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    /** Overrides the driver's default model. Optional — see lib/ai/*.ts. */
    AI_MODEL: z.string().min(1).optional(),
    /**
     * Overrides the driver's API base URL. Needed for OpenAI-compatible
     * gateways (Azure OpenAI, a self-hosted proxy) and for pointing a
     * staging deploy at a stub instead of a billable endpoint.
     */
    AI_BASE_URL: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === "s3") {
      const required = {
        S3_ENDPOINT: value.S3_ENDPOINT,
        S3_BUCKET: value.S3_BUCKET,
        S3_ACCESS_KEY_ID: value.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: value.S3_SECRET_ACCESS_KEY,
      };
      for (const [key, present] of Object.entries(required)) {
        if (!present) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }

    if (value.AI_DRIVER === "openai" && !value.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when AI_DRIVER=openai",
      });
    }
    if (value.AI_DRIVER === "gemini" && !value.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when AI_DRIVER=gemini",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

// Validated once at module load — any code that imports this triggers a fast
// boot-time failure on misconfiguration instead of a runtime surprise later.
export const env: Env = envSchema.parse(process.env);
