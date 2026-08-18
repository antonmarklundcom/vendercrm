import { GRACE_PERIOD_DAYS } from "@/modules/tenancy/subscriptions";
import { APP_NAME } from "@/lib/site-config";

// Minimal inline-styled HTML — no build step, no MJML, and email clients
// strip most CSS anyway. Kept deliberately plain (one accent color, system
// font stack) rather than matching per-tenant branding: these are platform
// and account-security emails (invite, reset, expiry), not customer-facing
// documents like the quote PDF, which already carries tenant branding.

function layout(bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      ${bodyHtml}
      <p style="margin-top:32px;font-size:12px;color:#71717a;">${APP_NAME}</p>
    </div>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a>`;
}

export function invitationEmail(input: {
  tenantName: string;
  inviterName: string;
  acceptUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `${input.inviterName} te invitó a ${input.tenantName} en ${APP_NAME}`,
    html: layout(`
      <h1 style="font-size:18px;margin:0 0 8px;">Te invitaron a ${input.tenantName}</h1>
      <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
        ${input.inviterName} te invitó a sumarte al equipo en ${APP_NAME}. El enlace vence en 7 días.
      </p>
      ${button(input.acceptUrl, "Aceptar invitación")}
    `),
  };
}

export function passwordResetEmail(input: { resetUrl: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: `Restablecer tu contraseña — ${APP_NAME}`,
    html: layout(`
      <h1 style="font-size:18px;margin:0 0 8px;">Restablecé tu contraseña</h1>
      <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
        Pediste restablecer tu contraseña. Si no fuiste vos, ignorá este correo — el enlace vence en una hora.
      </p>
      ${button(input.resetUrl, "Elegir nueva contraseña")}
    `),
  };
}

export function subscriptionExpiryWarningEmail(input: {
  tenantName: string;
  expiresAt: Date;
  daysRemaining: number;
}): { subject: string; html: string } {
  const date = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "long", year: "numeric" }).format(
    input.expiresAt,
  );
  return {
    subject: `Tu suscripción a ${APP_NAME} vence en ${input.daysRemaining} días`,
    html: layout(`
      <h1 style="font-size:18px;margin:0 0 8px;">Tu suscripción vence pronto</h1>
      <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
        La suscripción de <strong>${input.tenantName}</strong> vence el <strong>${date}</strong>.
        Después de esa fecha tenés ${GRACE_PERIOD_DAYS} días de acceso de solo lectura antes de que la cuenta
        se suspenda. Contactá a tu proveedor para renovar y evitar interrupciones.
      </p>
    `),
  };
}

/**
 * Per-site ingest alert (PLAN.md §5.2.5). Deliberately says what broke, when,
 * and where to look — and nothing else: no submitted data, no API key, no
 * webhook token. The reason arrives as a short code from
 * modules/sites/health.ts and is translated here, the same way this file
 * already owns the Spanish for every other transactional email.
 */
const INGEST_REASONS: Record<string, string> = {
  "invalid-key": "la clave que está usando el sitio no es válida",
  "site-inactive": "el sitio está desactivado",
  "tenant-unavailable": "la cuenta no está disponible",
  "tenant-read-only": "la cuenta está en modo solo lectura",
  "rate-limited": "llegaron demasiados envíos seguidos",
  "turnstile-failed": "no pasó la verificación anti-bots",
  "invalid-body": "los datos llegaron incompletos o con formato inválido",
  "phone-missing": "llegó sin teléfono, o cambió el nombre del campo en el formulario",
  unknown: "error desconocido",
};

export function siteIngestAlertEmail(input: {
  siteName: string;
  kind: "failing" | "stale";
  reason?: string | null;
  status?: number | null;
  lastSuccessAt?: Date | null;
  daysSilent?: number;
  sitesUrl: string;
}): { subject: string; html: string } {
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat("es-PY", {
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const lastLead = input.lastSuccessAt
    ? `El último lead entró el <strong>${formatDate(input.lastSuccessAt)}</strong>.`
    : "Todavía no recibimos ningún lead de este sitio.";

  if (input.kind === "stale") {
    return {
      subject: `${input.siteName}: hace ${input.daysSilent} días que no entra ningún lead`,
      html: layout(`
        <h1 style="font-size:18px;margin:0 0 8px;">${input.siteName} está en silencio</h1>
        <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
          Hace <strong>${input.daysSilent} días</strong> que no entra un lead de este sitio, y antes entraban.
          ${lastLead} Puede ser una racha tranquila, o que el formulario del sitio se haya roto sin avisar.
          Vale la pena mandar un envío de prueba.
        </p>
        <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
          <a href="${input.sitesUrl}">Ver el estado de tus sitios</a>
        </p>
      `),
    };
  }

  const reason = INGEST_REASONS[input.reason ?? "unknown"] ?? INGEST_REASONS.unknown;
  return {
    subject: `${input.siteName}: los leads no están entrando`,
    html: layout(`
      <h1 style="font-size:18px;margin:0 0 8px;">${input.siteName} no está pudiendo cargar leads</h1>
      <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
        El último intento falló${input.status ? ` (error ${input.status})` : ""}: ${reason}.
        Mientras siga así, los envíos de ese formulario no llegan al pipeline.
      </p>
      <p style="font-size:14px;line-height:1.5;color:#3f3f46;">${lastLead}</p>
      <p style="font-size:14px;line-height:1.5;color:#3f3f46;">
        <a href="${input.sitesUrl}">Revisar el sitio</a>
      </p>
    `),
  };
}
