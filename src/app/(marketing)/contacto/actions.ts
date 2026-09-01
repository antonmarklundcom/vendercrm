"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/config/hosts";
import { idempotencyKey, readAttribution, sendLead } from "@/lib/vendercrm-lead";

/**
 * The marketing site's qualifying form (plan: THE conversion page). A Server
 * Action rather than a client fetch for two reasons: the site API key must
 * never reach the browser, and the form then works with JavaScript disabled
 * or still loading — which is most of the first seconds of an ad click on a
 * Paraguayan mobile connection.
 */
// Same shape as every other action in the app: the payload is parsed, not
// trusted (PLAN.md §3.3). Oversized fields are cut rather than rejected —
// this is a public form and a long "mensaje" is a real visitor, not an
// attack — but the phone, the one field the CRM keys on, must be present.
const contactSchema = z.object({
  telefono: z.string().trim().min(6).max(40),
  nombre: z.string().trim().max(200).optional(),
  empresa: z.string().trim().max(200).optional(),
  email: z.string().trim().max(320).optional(),
  rubro: z.string().trim().max(200).optional(),
  mensaje: z.string().trim().max(4000).optional(),
});

// Public and unauthenticated, so it gets the same treatment as the lead
// ingest endpoint (PLAN.md §13 H3 #4): a fixed per-IP window, ahead of any
// work — including the outbound call to the CRM.
const SUBMIT_LIMIT = 5;
const SUBMIT_WINDOW_MS = 10 * 60 * 1000;

export async function submitContactAction(formData: FormData) {
  // Honeypot: accept silently and post nothing. A bot that fills every field
  // must not be able to tell it was rejected.
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect("/contacto?enviado=1");
  }

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);

  if ((await checkRateLimit(`marketing:contacto:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS)).limited) {
    // Same answer as the honeypot: a flood gets a thank-you page and no
    // lead, rather than a signal about what tripped.
    redirect("/contacto?enviado=1");
  }

  const parsed = contactSchema.safeParse({
    telefono: formData.get("telefono") ?? "",
    nombre: formData.get("nombre") ?? undefined,
    empresa: formData.get("empresa") ?? undefined,
    email: formData.get("email") ?? undefined,
    rubro: formData.get("rubro") ?? undefined,
    mensaje: formData.get("mensaje") ?? undefined,
  });

  if (!parsed.success) {
    redirect("/contacto?error=telefono");
  }

  const phone = parsed.data.telefono;
  const name = parsed.data.nombre ?? "";
  const company = parsed.data.empresa ?? "";
  const email = parsed.data.email ?? "";
  const sector = parsed.data.rubro ?? "";
  const message = parsed.data.mensaje ?? "";

  const attribution = readAttribution((await cookies()).get("vc_attr")?.value);
  const referer = requestHeaders.get("referer") ?? undefined;

  // Never send pipeline, stage, owner or tag: routing lives on the site record
  // in the CRM so it can be changed without a deploy.
  await sendLead({
    phone,
    name: name || undefined,
    email: email || undefined,
    message: message || undefined,
    source: "clientes.com.py:contacto",
    page_url: attribution.landing_page ?? `${SITE_URL}/contacto`,
    referrer: attribution.referrer ?? referer,
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    utm_term: attribution.utm_term,
    utm_content: attribution.utm_content,
    gclid: attribution.gclid,
    fbclid: attribution.fbclid,
    idempotency_key: idempotencyKey(phone),
    // Everything the endpoint has no column for, kept on the timeline so the
    // person taking the call has the context.
    fields: {
      ...(company ? { empresa: company } : {}),
      ...(sector ? { rubro: sector } : {}),
    },
  });

  // Deliberately outside any try/catch: redirect() unwinds by throwing, and
  // sendLead never throws — so a CRM outage still thanks the visitor and
  // leaves the failure in the server log rather than on their screen.
  redirect("/contacto?enviado=1");
}
