import { env } from "@/lib/config/env";
import { createCloudflareProvider } from "./cloudflare";
import { createResendProvider } from "./resend";
import type { EmailProvider } from "./types";

export type { EmailProvider, ProviderMessage, ProviderResult } from "./types";

// Provider selection (PLAN-EMAIL.md §3, E1). Two independent questions:
//
//   platformProvider() — password reset, invites, notifications. Follows
//     EMAIL_PROVIDER (default `resend`). `cloudflare` without its vars falls
//     back to Resend with a warning; nothing configured at all is `null`,
//     which sendEmail() already treats as "log and skip".
//   mailboxProvider()  — tenant mailbox replies (E4). Always Cloudflare,
//     independent of EMAIL_PROVIDER, or `null` when it isn't configured.

type ProviderConfig = {
  EMAIL_PROVIDER?: "resend" | "cloudflare";
  RESEND_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
};

function cloudflareFrom(config: ProviderConfig): EmailProvider | null {
  if (!config.CLOUDFLARE_ACCOUNT_ID || !config.CLOUDFLARE_EMAIL_API_TOKEN) return null;
  return createCloudflareProvider({
    accountId: config.CLOUDFLARE_ACCOUNT_ID,
    apiToken: config.CLOUDFLARE_EMAIL_API_TOKEN,
  });
}

export function resolvePlatformProvider(
  config: ProviderConfig,
  warn: (message: string) => void = console.warn,
): EmailProvider | null {
  const resend = config.RESEND_API_KEY ? createResendProvider(config.RESEND_API_KEY) : null;
  if (config.EMAIL_PROVIDER !== "cloudflare") return resend;

  const cloudflare = cloudflareFrom(config);
  if (cloudflare) return cloudflare;
  warn(
    "[email] EMAIL_PROVIDER=cloudflare but CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_EMAIL_API_TOKEN are not set — falling back to Resend",
  );
  return resend;
}

export function resolveMailboxProvider(config: ProviderConfig): EmailProvider | null {
  return cloudflareFrom(config);
}

let platform: EmailProvider | null | undefined;
let mailbox: EmailProvider | null | undefined;

export function platformProvider(): EmailProvider | null {
  if (platform === undefined) platform = resolvePlatformProvider(env);
  return platform;
}

export function mailboxProvider(): EmailProvider | null {
  if (mailbox === undefined) mailbox = resolveMailboxProvider(env);
  return mailbox;
}
