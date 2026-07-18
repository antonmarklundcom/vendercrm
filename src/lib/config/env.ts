import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ENCRYPTION_KEY: z
    .string()
    .length(64, "APP_ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./.storage"),
  QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  // Platform-level Meta app (one app for the whole platform, per PLAN.md
  // §6.1) — per-tenant WhatsApp access tokens live in wa_accounts, encrypted.
  WHATSAPP_APP_SECRET: z.string().min(1, "WHATSAPP_APP_SECRET is required"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Invalid environment configuration:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid environment configuration");
  }

  return parsed.data;
}

export const env = loadEnv();
