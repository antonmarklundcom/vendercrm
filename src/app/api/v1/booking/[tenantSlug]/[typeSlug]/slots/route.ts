import { NextResponse } from "next/server";
import { clientIp } from "@/lib/http/client-ip";
import { publicSlots } from "@/modules/booking/public";

// Available slots for the public booking page (docs/SPEC-BOOKING.md §5).
//
// Same-origin only: this is fetched by our own page at /b/[tenantSlug]/[typeSlug]
// so the visitor can page months without a reload. No CORS headers are set,
// which is what keeps §5.1's lock intact — a browser on someone else's origin
// has no business reading a tenant's calendar.
//
// The response carries start times, and for a type with capacity how many
// places are left — never resource ids and never who is free. "Quedan 3
// lugares" is about the class the visitor is buying into; the shape of
// someone's team is not the public's business.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string; typeSlug: string }> },
) {
  const { tenantSlug, typeSlug } = await params;
  const url = new URL(request.url);

  const outcome = await publicSlots(
    tenantSlug,
    typeSlug,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
    clientIp(request.headers),
    new Date(),
    // Ticked add-ons lengthen the appointment and so change which starts
    // still fit. Repeated `services` params, the shape a form serialises to.
    url.searchParams.getAll("services").filter(Boolean),
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({ slots: outcome.data });
}
