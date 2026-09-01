import { checkRateLimit } from "@/lib/rate-limit";

// Credential endpoints had no limiter at all: an attacker could try
// passwords against a known email as fast as the network allowed, and a
// forgot-password loop could be used to mail-bomb a user (PLAN.md §13 H3
// #4). Two windows, because they answer different attacks — one IP spraying
// many accounts, and many IPs hammering one account.

const IP_LIMIT = 20;
const EMAIL_LIMIT = 6;
const WINDOW_MS = 10 * 60 * 1000;

/** Better Auth paths that accept credentials or trigger an email. */
const GUARDED = [
  "/sign-in/email",
  "/forget-password",
  "/request-password-reset",
  "/reset-password",
];

export function isGuardedAuthPath(pathname: string): boolean {
  return GUARDED.some((path) => pathname.endsWith(path));
}

export async function checkLoginAttempt(input: {
  ip: string;
  email?: string | null;
}): Promise<boolean> {
  const byIp = await checkRateLimit(`auth:ip:${input.ip}`, IP_LIMIT, WINDOW_MS);
  const email = input.email?.trim().toLowerCase();
  const byEmail = email
    ? await checkRateLimit(`auth:email:${email}`, EMAIL_LIMIT, WINDOW_MS)
    : { limited: false };

  return byIp.limited || byEmail.limited;
}
