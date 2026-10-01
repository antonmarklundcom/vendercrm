import { apiError } from "@/lib/api/guards";
import { getSuperadminContext } from "@/modules/tenancy/context";
import { exportPlatformLeads } from "@/modules/tenancy/platform-crm";
import { parsePlatformLeadsParams, platformLeadsHref } from "../filters";
import { platformLeadsCsv, platformLeadsCsvFilename } from "../export-csv";

// CSV export of the cross-account leads view (PLAN.md §19.5 C3): the rows the
// active filters match on /platform-leads, all of them up to the cap, as one
// audited download.
//
// A route handler is not wrapped by the (superadmin) layout, so the
// superadmin check is here, first, before the query string is even parsed:
// a tenant admin or an anonymous caller gets a 403 and nothing is read or
// audited. The reader re-checks against the users table on top of that.
//
// Same query parameters as the page, through the same parser, so the file is
// exactly the filtered set on screen. `view` and `page` are ignored: this
// exports leads only (deals/contacts export is out of scope, §19.6), and a
// page number must not shift or widen what an export holds.
export async function GET(request: Request) {
  const sa = await getSuperadminContext();
  if (!sa) return apiError("forbidden", 403);

  const url = new URL(request.url);
  const params: Record<string, string[]> = {};
  for (const [key, value] of url.searchParams) (params[key] ??= []).push(value);
  const parsed = parsePlatformLeadsParams(params);

  let result: Awaited<ReturnType<typeof exportPlatformLeads>>;
  try {
    result = await exportPlatformLeads(sa, parsed.filters);
  } catch (error) {
    // The session said superadmin but the users table no longer does.
    if (error instanceof Error && error.message === "Superadmin required") {
      return apiError("forbidden", 403);
    }
    throw error;
  }

  if (!result.ok) {
    // Never a partial file: back to the list with the same filters and a
    // banner asking to narrow them.
    const back = platformLeadsHref(
      { ...parsed, view: "leads", page: 1 },
      { exportError: result.reason },
    );
    // A relative Location (RFC 7231): no host taken from the request, which
    // behind the hosting proxy is not the public one.
    return new Response(null, { status: 303, headers: { Location: back, "Cache-Control": "no-store" } });
  }

  return new Response(platformLeadsCsv(result.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${platformLeadsCsvFilename()}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
