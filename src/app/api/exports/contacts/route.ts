import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { resolveTenantByContactsFeedToken } from "@/modules/tenancy/settings";
import { exportContactsCsv } from "@/modules/crm/export";
import { parseContactOptions, parseContactQuery } from "@/app/(app)/contacts/query";
import {
  apiError,
  requireSession,
  requireToken,
  requireWithinRateLimit,
} from "@/lib/api/guards";

// Contacts CSV. One endpoint, two ways in:
//
// 1. **Session** — the download button on /contacts, carrying whatever
//    filters the list is showing.
// 2. **Feed token** (`?token=`) — Google Sheets' IMPORTDATA fetches this
//    from Google's servers, which carry no session and no custom headers, so
//    the token in the URL is the credential. Same model as the public quote
//    link `/q/[token]` (§8): unguessable, read-only, revocable by rotation.
//
// Read-only by construction — there is no write path here at all.

const FILENAME = "contactos.csv";

/** Excel needs a BOM to read UTF-8 accents; Sheets' IMPORTDATA does not and
 * is happier without one, so only the download path gets it. */
const BOM = "﻿";

function csvResponse(body: string, { download }: { download: boolean }) {
  return new Response(download ? BOM + body : body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      ...(download
        ? { "Content-Disposition": `attachment; filename="${FILENAME}"` }
        : {}),
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (token) {
    // Per-token limiter: a misconfigured sheet on a 1-minute refresh must not
    // be able to hammer the CRM.
    const limited = await requireWithinRateLimit(`export-feed:${token.slice(0, 16)}`, 30, 60_000);
    if (!limited.ok) return limited.response;

    const guard = await requireToken(token, resolveTenantByContactsFeedToken);
    if (!guard.ok) return guard.response;

    const ctx = await buildSystemTenantContext(guard.resolved.id);
    if (!ctx) return apiError("not_found", 404);

    // Deliberately unfiltered: a spreadsheet wants the whole book, and the
    // token carries no user identity to scope it by.
    return csvResponse(await exportContactsCsv(ctx), { download: false });
  }

  const session = await requireSession();
  if (!session.ok) return session.response;
  const { ctx } = session;

  const downloadLimit = await requireWithinRateLimit(
    `export-download:${ctx.tenantId}`,
    20,
    60_000,
  );
  if (!downloadLimit.ok) return downloadLimit.response;

  // Same parser the list page uses, so the download is exactly the filtered
  // set on screen — including sort-independent filters like date range and
  // has-open-deal.
  const params = Object.fromEntries(url.searchParams);
  const csv = await exportContactsCsv(
    ctx,
    parseContactQuery(params),
    parseContactOptions(params),
  );

  return csvResponse(csv, { download: true });
}
