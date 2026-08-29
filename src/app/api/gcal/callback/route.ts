import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { requireTenantContext } from "@/modules/tenancy/context";
import { connectGcal, isGcalConfigured } from "@/modules/calendar/gcal";

// Google's OAuth callback (plan-booking.md §5.4).
//
// The `state` Google echoes back is treated as a nonce to compare against,
// never as a source of identity: the tenant and user are re-derived from the
// caller's own session, and a state that doesn't match the signed-in user is
// refused. Otherwise a crafted callback URL could attach an attacker's
// calendar to somebody else's account.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const settings = new URL("/settings", env.APP_URL);

  if (!isGcalConfigured()) {
    settings.searchParams.set("gcal", "not_configured");
    return NextResponse.redirect(settings);
  }

  // Google reports a denied consent screen as `error=access_denied`, which is
  // a normal thing for a person to do, not a failure worth an error page.
  if (url.searchParams.get("error")) {
    settings.searchParams.set("gcal", "cancelled");
    return NextResponse.redirect(settings);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) {
    settings.searchParams.set("gcal", "failed");
    return NextResponse.redirect(settings);
  }

  const ctx = await requireTenantContext();
  if (state !== `${ctx.tenantId}:${ctx.userId}`) {
    settings.searchParams.set("gcal", "failed");
    return NextResponse.redirect(settings);
  }

  try {
    await connectGcal(ctx, ctx.userId, code);
    settings.searchParams.set("gcal", "connected");
  } catch {
    settings.searchParams.set("gcal", "failed");
  }

  return NextResponse.redirect(settings);
}
