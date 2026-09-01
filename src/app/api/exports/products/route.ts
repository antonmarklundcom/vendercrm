import { exportProductsCsv } from "@/modules/quotes/products-csv";
import { requireSession, requireWithinRateLimit } from "@/lib/api/guards";

// Product catalog CSV, session-only — unlike /api/exports/contacts there is
// no tokened feed lane here, since nothing external consumes this yet.
// Read-only by construction.

const FILENAME = "productos.csv";

/** Excel needs a BOM to read UTF-8 accents (§ same as contacts export). */
const BOM = "﻿";

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { ctx } = session;

  const limited = await requireWithinRateLimit(`export-products:${ctx.tenantId}`, 20, 60_000);
  if (!limited.ok) return limited.response;

  const csv = await exportProductsCsv(ctx);

  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${FILENAME}"`,
    },
  });
}
