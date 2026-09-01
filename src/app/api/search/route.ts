import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { searchTenant } from "@/modules/crm/search";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import { requireSession, requireWithinRateLimit } from "@/lib/api/guards";

// Backs the ⌘K palette (PLAN.md §13 H8). Session-scoped like the inbox
// endpoints: the tenant comes from the session, never from the request, so
// there is no tenant id to tamper with. Rate limited per user because the
// palette fires on every keystroke the debounce lets through.
export const dynamic = "force-dynamic";

const LIMIT = 60;
const WINDOW_MS = 60_000;

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { ctx } = session;

  const limited = await requireWithinRateLimit(`search:${ctx.userId}`, LIMIT, WINDOW_MS);
  if (!limited.ok) return limited.response;

  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim().length < 2) return NextResponse.json({ query, hits: [] });

  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  const results = await searchTenant(
    ctx,
    query.slice(0, 100),
    settings.defaultCountry ?? DEFAULT_COUNTRY,
    await getLocale(),
  );

  return NextResponse.json(results);
}
