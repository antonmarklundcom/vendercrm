import { getSalesReport } from "@/modules/reports/sales";
import { isReportTable, reportTableToCsv } from "@/modules/reports/export";
import { listTenantUsers } from "@/modules/tenancy/users";
import { parseReportFilters, parseReportsWindow } from "@/app/(app)/reports/query";
import { apiError, requireSession, requireWithinRateLimit } from "@/lib/api/guards";

// Reports CSV, one table per request (PLAN.md §10 1J, §17.3 P15). Session
// only — unlike the contacts feed, nothing here is meant for an
// unauthenticated spreadsheet pull. Same parser as the page
// (app/(app)/reports/query.ts), so a download always means "what's on
// screen" for that exact URL.

const BOM = "﻿";

export async function GET(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isReportTable(table)) return apiError("not_found", 404);

  const session = await requireSession();
  if (!session.ok) return session.response;
  const { ctx } = session;

  const limited = await requireWithinRateLimit(`export-reports:${ctx.tenantId}`, 20, 60_000);
  if (!limited.ok) return limited.response;

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams);

  const [report, users] = await Promise.all([
    getSalesReport(ctx, parseReportsWindow(searchParams), parseReportFilters(searchParams)),
    listTenantUsers(ctx),
  ]);

  const csv = reportTableToCsv(table, report, {
    users: new Map(users.map((user) => [user.id, user.name])),
  });

  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="reporte-${table}.csv"`,
    },
  });
}
