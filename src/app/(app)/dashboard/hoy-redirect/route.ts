import { NextResponse } from "next/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { recordHoyAction, type HoyActionOrigin } from "@/modules/coach/hoy-actions";

// The tracked hop between a Hoy item's action (dashboard panel or morning
// push) and where it actually goes (PLAN.md §17.5, §17.2 P14). One
// `coach.hoy_action` audit row per click, then straight on to the real
// destination — nothing about the item itself lives here.
export async function GET(request: Request) {
  const ctx = await requireTenantContext();
  const url = new URL(request.url);

  const kind = url.searchParams.get("kind") ?? "unknown";
  const severity = url.searchParams.get("severity") ?? "low";
  const origin: HoyActionOrigin = url.searchParams.get("origin") === "push" ? "push" : "panel";
  const to = url.searchParams.get("to") || "/dashboard";

  await recordHoyAction(ctx, { kind, severity, origin });

  return NextResponse.redirect(new URL(to, request.url));
}
