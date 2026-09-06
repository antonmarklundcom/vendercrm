import { env } from "@/lib/config/env";
import type { TenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listTenantUsers } from "@/modules/tenancy/users";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { getVerifiedDomainForTenant } from "@/modules/tenancy/email-domains";

// Three sending identities resolved to one (PLAN.md §15.1):
//
//   Default (every tenant)  -> "Nombre del negocio" <notificaciones@EMAIL_DEFAULT_DOMAIN>
//   Own domain (verified)   -> "Nombre del negocio" <fromLocalPart@domain>
//   Operator-assisted       -> same as own domain — it's still just a
//                              verified `tenant_email_domains` row, made by
//                              the owner while impersonating.
//
// Reply-To is always the tenant's own contact address, whichever tier sends.

export type ResolvedSender = { from: string | undefined; replyTo: string | undefined };

function quotedName(name: string): string {
  // RFC 5322 display-name quoting for the one character that would otherwise
  // break the header: a business named `Ferretería "El Tornillo"` is real.
  return `"${name.replace(/"/g, '\\"')}"`;
}

export async function senderFor(ctx: TenantContext): Promise<ResolvedSender> {
  const tenant = await getTenant(ctx.tenantId);
  const name = tenant?.name ?? "VenderCRM";
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  let replyTo = settings.contactEmail;
  if (!replyTo) {
    // Falls back to the tenant's first active admin's own login email, so
    // a customer's reply always lands somewhere a human reads it, even
    // before anyone has filled in "correo de contacto" in settings.
    const users = await listTenantUsers(ctx);
    const admin = users.find((user) => user.role === "admin" && !user.banned);
    replyTo = admin?.email;
  }

  const verifiedDomain = await getVerifiedDomainForTenant(ctx);
  if (verifiedDomain) {
    const localPart = verifiedDomain.fromLocalPart || "ventas";
    return { from: `${quotedName(name)} <${localPart}@${verifiedDomain.domain}>`, replyTo };
  }

  if (env.EMAIL_DEFAULT_DOMAIN) {
    return { from: `${quotedName(name)} <notificaciones@${env.EMAIL_DEFAULT_DOMAIN}>`, replyTo };
  }

  // No default domain configured either: current behaviour, unchanged —
  // lib/email/index.ts falls back to RESEND_FROM_EMAIL when `from` is
  // undefined.
  return { from: undefined, replyTo };
}
