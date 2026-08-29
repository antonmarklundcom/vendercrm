import type { BookingNotificationKind } from "./notification-chain";

// The customer-facing copy for every booking notification, in one place and
// in one language.
//
// Why not the messages/*.json files the rest of the app uses: a WhatsApp
// template is a *string Meta approved*. It cannot be swapped per viewer, and
// the free-form and email rungs have to say the same thing as the template
// or the fallback becomes a different message depending on which rung
// happened to fire. So the wording lives here, next to the template
// definition it must match, and it is Paraguayan voseo Spanish — the
// customer of a Paraguayan business, not the CRM's user, is the reader
// (plan-booking.md §1). Internal/admin strings stay in the messages files.

export type BookingNotificationVars = {
  contactName: string;
  businessName: string;
  serviceName: string;
  /** Already formatted in the tenant's locale and timezone. */
  when: string;
  /** The /b/g/<token> manage link. */
  manageUrl: string;
  location?: string | null;
  /** Formatted money, e.g. "₲ 150.000". Deposit requests only. */
  depositAmount?: string | null;
  /** Where to transfer it. One line — see `oneLine` below. */
  depositInstructions?: string | null;
  /** The tenant's Google review link. Review requests only. */
  reviewUrl?: string | null;
};

export const BOOKING_TEMPLATE_LANGUAGE = "es";

/**
 * Meta rejects a variable value containing a newline, a tab, or four
 * consecutive spaces, and the rejection arrives at *send* time as a 132000
 * error — long after the template was approved. Tenant-authored text (the
 * transfer instructions) is exactly where a newline comes from, so every
 * variable is flattened on the way in rather than trusted.
 */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

type TemplateDefinition = {
  /** Namespaced so it cannot collide with a template the tenant wrote. */
  name: string;
  category: "UTILITY" | "MARKETING";
  /** The approved body, `{{n}}` placeholders in order. */
  body: string;
  /** Example values Meta requires when submitting the template for review. */
  example: string[];
  /** Fills `{{n}}` from the vars, same order as `body`. */
  variables: (vars: BookingNotificationVars) => string[];
};

export const BOOKING_TEMPLATES: Record<BookingNotificationKind, TemplateDefinition> = {
  confirmation: {
    name: "vc_booking_confirmation",
    category: "UTILITY",
    body:
      "Hola {{1}}, tu reserva de {{2}} en {{3}} quedó confirmada para el {{4}}. " +
      "Si necesitás cambiarla o cancelarla, entrá acá: {{5}}",
    example: ["María", "Corte de pelo", "Barbería Central", "12/03/2026 15:30", "https://crm.clientes.com.py/b/g/abc123"],
    variables: (v) => [v.contactName, v.serviceName, v.businessName, v.when, v.manageUrl],
  },
  reminder: {
    name: "vc_booking_reminder",
    category: "UTILITY",
    body:
      "Hola {{1}}, te recordamos tu {{2}} en {{3}}: {{4}}. " +
      "Si no podés venir, avisanos acá: {{5}}",
    example: ["María", "Corte de pelo", "Barbería Central", "12/03/2026 15:30", "https://crm.clientes.com.py/b/g/abc123"],
    variables: (v) => [v.contactName, v.serviceName, v.businessName, v.when, v.manageUrl],
  },
  cancellation: {
    name: "vc_booking_cancelled",
    category: "UTILITY",
    body:
      "Hola {{1}}, tu reserva de {{2}} en {{3}} del {{4}} fue cancelada. " +
      "Si querés agendar otro horario, escribinos por acá.",
    example: ["María", "Corte de pelo", "Barbería Central", "12/03/2026 15:30"],
    variables: (v) => [v.contactName, v.serviceName, v.businessName, v.when],
  },
  reschedule: {
    name: "vc_booking_rescheduled",
    category: "UTILITY",
    body:
      "Hola {{1}}, tu reserva de {{2}} en {{3}} quedó reprogramada para el {{4}}. " +
      "Podés verla o cambiarla acá: {{5}}",
    example: ["María", "Corte de pelo", "Barbería Central", "14/03/2026 09:00", "https://crm.clientes.com.py/b/g/abc123"],
    variables: (v) => [v.contactName, v.serviceName, v.businessName, v.when, v.manageUrl],
  },
  deposit_request: {
    name: "vc_booking_deposit_request",
    category: "UTILITY",
    body:
      "Hola {{1}}, para dejar confirmada tu reserva de {{2}} en {{3}} del {{4}} " +
      "necesitamos una seña de {{5}}. Datos para la transferencia: {{6}}. " +
      "Mandanos el comprobante por este chat.",
    example: [
      "María",
      "Corte de pelo",
      "Barbería Central",
      "12/03/2026 15:30",
      "₲ 50.000",
      "Banco Itaú, cta. 12345678, CI 1234567",
    ],
    variables: (v) => [
      v.contactName,
      v.serviceName,
      v.businessName,
      v.when,
      v.depositAmount ?? "",
      oneLine(v.depositInstructions ?? ""),
    ],
  },
  review_request: {
    name: "vc_booking_review_request",
    category: "UTILITY",
    body:
      "Hola {{1}}, gracias por elegir {{2}}. Si te quedaste conforme, " +
      "¿nos dejás una reseña? Te lleva un minuto: {{3}}",
    example: ["María", "Barbería Central", "https://g.page/r/example/review"],
    variables: (v) => [v.contactName, v.businessName, v.reviewUrl ?? ""],
  },
};

/** The Graph API `components` payload for one template submission. */
export function templateSubmissionPayload(kind: BookingNotificationKind) {
  const definition = BOOKING_TEMPLATES[kind];
  return {
    name: definition.name,
    language: BOOKING_TEMPLATE_LANGUAGE,
    category: definition.category,
    components: [
      {
        type: "BODY",
        text: definition.body,
        example: { body_text: [definition.example] },
      },
    ],
  };
}

/** The `components` payload for one template *send*, filled from the booking. */
export function templateSendComponents(
  kind: BookingNotificationKind,
  vars: BookingNotificationVars,
) {
  const values = BOOKING_TEMPLATES[kind].variables(vars).map(oneLine);
  return [
    {
      type: "body",
      parameters: values.map((text) => ({ type: "text", text })),
    },
  ];
}

/**
 * The same message as a free-form WhatsApp text. Not the template string with
 * its variables substituted: free-form has no approval constraints, so it can
 * carry the line breaks and the address that make the message readable.
 */
export function buildFreeFormText(
  kind: BookingNotificationKind,
  vars: BookingNotificationVars,
): string {
  const lines: string[] = [];
  switch (kind) {
    case "confirmation":
      lines.push(`Hola ${vars.contactName}, tu reserva quedó confirmada ✅`);
      lines.push(`${vars.serviceName} en ${vars.businessName}`);
      lines.push(`📅 ${vars.when}`);
      break;
    case "reminder":
      lines.push(`Hola ${vars.contactName}, te recordamos tu ${vars.serviceName} en ${vars.businessName}.`);
      lines.push(`📅 ${vars.when}`);
      break;
    case "cancellation":
      lines.push(`Hola ${vars.contactName}, tu reserva de ${vars.serviceName} en ${vars.businessName} del ${vars.when} fue cancelada.`);
      lines.push("Si querés agendar otro horario, escribinos por acá.");
      break;
    case "reschedule":
      lines.push(`Hola ${vars.contactName}, tu reserva de ${vars.serviceName} en ${vars.businessName} quedó reprogramada.`);
      lines.push(`📅 ${vars.when}`);
      break;
    case "deposit_request":
      lines.push(`Hola ${vars.contactName}, para confirmar tu reserva de ${vars.serviceName} en ${vars.businessName} necesitamos una seña.`);
      lines.push(`📅 ${vars.when}`);
      if (vars.depositAmount) lines.push(`💵 Seña: ${vars.depositAmount}`);
      if (vars.depositInstructions) lines.push(vars.depositInstructions);
      lines.push("Mandanos el comprobante por este chat y la dejamos confirmada.");
      break;
    case "review_request":
      lines.push(`Hola ${vars.contactName}, gracias por elegir ${vars.businessName}.`);
      lines.push("Si te quedaste conforme, ¿nos dejás una reseña? Te lleva un minuto:");
      if (vars.reviewUrl) lines.push(vars.reviewUrl);
      return lines.join("\n");
  }

  if (vars.location && kind !== "cancellation") lines.push(`📍 ${vars.location}`);
  if (kind !== "cancellation") lines.push(`Ver o cambiar tu reserva: ${vars.manageUrl}`);
  return lines.join("\n");
}

const SUBJECTS: Record<BookingNotificationKind, (v: BookingNotificationVars) => string> = {
  confirmation: (v) => `Reserva confirmada — ${v.businessName}`,
  reminder: (v) => `Recordatorio de tu reserva — ${v.businessName}`,
  cancellation: (v) => `Reserva cancelada — ${v.businessName}`,
  reschedule: (v) => `Tu reserva cambió de horario — ${v.businessName}`,
  deposit_request: (v) => `Seña pendiente para tu reserva — ${v.businessName}`,
  review_request: (v) => `¿Cómo te fue en ${v.businessName}?`,
};

/**
 * The email rung. Same words as the WhatsApp text, wrapped in the same plain
 * inline-styled markup lib/email/templates.ts uses — deliberately not a
 * second, prettier version of the message, so which rung fired is invisible
 * to the customer.
 */
export function buildEmail(
  kind: BookingNotificationKind,
  vars: BookingNotificationVars,
): { subject: string; html: string } {
  const text = buildFreeFormText(kind, vars);
  const paragraphs = text
    .split("\n")
    .map(
      (line) =>
        `<p style="font-size:14px;line-height:1.5;color:#3f3f46;margin:0 0 8px;">${escapeHtml(line)}</p>`,
    )
    .join("\n");

  return {
    subject: SUBJECTS[kind](vars),
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(vars.businessName)}</h1>
      ${paragraphs}
      <p style="margin-top:32px;font-size:12px;color:#71717a;">${escapeHtml(vars.businessName)}</p>
    </div>
  </body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
