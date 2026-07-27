// Next.js route handler for a site that posts leads to VenderCRM.
// Drop at app/api/lead/route.ts on the SITE (not the CRM).
//
// Env on the site: VENDERCRM_URL, VENDERCRM_API_KEY

export async function POST(request: Request) {
  const form = await request.formData();

  // Honeypot: bots fill hidden fields, humans never see them. Answer 200 so
  // the bot can't tell it was rejected and retry with the field removed.
  if (form.get("_hp")) return Response.json({ ok: true });

  // First-touch attribution written by vc-attribution.js.
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie.match(/(?:^|;\s*)vc_attr=([^;]*)/)?.[1];
  const attr = raw ? JSON.parse(decodeURIComponent(raw)) : {};

  const res = await fetch(`${process.env.VENDERCRM_URL}/api/v1/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.VENDERCRM_API_KEY!,
    },
    body: JSON.stringify({
      phone: form.get("phone"),        // required
      name: form.get("name"),
      email: form.get("email"),
      message: form.get("message"),
      page_url: attr.landing_page,
      referrer: attr.referrer,
      utm_source: attr.utm_source,
      utm_medium: attr.utm_medium,
      utm_campaign: attr.utm_campaign,
      gclid: attr.gclid,
      fbclid: attr.fbclid,
      // Retry-safe: the same key always returns the original lead.
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!res.ok) {
    // Log for yourself, but don't leak CRM errors to the visitor — from
    // their side the enquiry either went through or it didn't.
    console.error("VenderCRM ingest failed", res.status, await res.text());
    return Response.json({ ok: false }, { status: 502 });
  }

  return Response.json({ ok: true });
}
