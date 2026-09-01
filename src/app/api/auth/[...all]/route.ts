import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";
import { checkLoginAttempt, isGuardedAuthPath } from "@/lib/auth/login-rate-limit";
import { clientIp } from "@/lib/http/client-ip";

// Better Auth's catch-all route handler — mounts sign-in/sign-up/session and
// the admin plugin's impersonation/ban/list-users endpoints under
// /api/auth/*. Authorization for the admin endpoints is enforced by the
// plugin's `adminRoles` gate (src/lib/auth/server.ts); superadmin-console
// server actions additionally verify getSuperadminContext() before calling
// them (defense in depth, PLAN.md §3.3).

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

// Sign-in and the password-reset mailers are rate limited here rather than
// inside Better Auth: this is the one place every credential POST passes
// through, whichever client made it (PLAN.md §13 H3 #4).
export async function POST(request: Request) {
  const { pathname } = new URL(request.url);

  if (isGuardedAuthPath(pathname)) {
    let email: string | null = null;
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      if (typeof body?.email === "string") email = body.email;
    } catch {
      // Not JSON, or already consumed — the per-IP window still applies.
    }

    if (await checkLoginAttempt({ ip: clientIp(request.headers), email })) {
      return NextResponse.json(
        { error: { code: "TOO_MANY_REQUESTS", message: "Too many requests" } },
        { status: 429, headers: { "retry-after": "600" } },
      );
    }
  }

  return handlers.POST(request);
}
