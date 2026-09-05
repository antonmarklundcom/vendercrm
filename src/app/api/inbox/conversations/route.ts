import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api/guards";
import { getInboxRows, INBOX_FILTERS } from "@/app/(app)/inbox/rows";
import type { InboxListFilter } from "@/modules/whatsapp/inbox";

// Backs the inbox list's 5s poll (PLAN.md §6.5). Session-authenticated,
// same-origin only — no API key path, unlike /api/v1/leads. Accepts the same
// `filter`/`q` query params as the page itself, so the poll shows the exact
// list the rep filtered to rather than silently reverting to "all" every 5s
// (PLAN.md §15.8 P3).
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const url = new URL(request.url);
  const filterParam = url.searchParams.get("filter");
  const filter: InboxListFilter = INBOX_FILTERS.includes(filterParam as InboxListFilter)
    ? (filterParam as InboxListFilter)
    : "all";
  const q = url.searchParams.get("q") ?? undefined;

  const conversations = await getInboxRows(ctx, { filter, q });

  return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}
