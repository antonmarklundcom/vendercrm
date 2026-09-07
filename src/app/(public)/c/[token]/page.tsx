import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getContractByPublicToken } from "@/modules/contracts/contracts";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslator } from "@/lib/i18n/translator";
import { documentDate } from "@/modules/renderable-document/format";
import { ContractDecisionForm } from "./ContractDecisionForm";

// Public read-only contract view + click-to-accept (PLAN.md §17.3 P13) —
// the token is the secret, same model as the quote and nota de venta links.
export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const ip = clientIp(await headers());
  if ((await checkRateLimit(`contract-view:${ip}`, 60, 60_000)).limited) {
    const tLimit = await getTranslator(null, "public.shared");
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        {tLimit("rateLimited")}
      </main>
    );
  }

  const resolved = await getContractByPublicToken(token);
  if (!resolved) notFound();

  const { contract, acceptance } = resolved;
  const tenant = await getTenant(contract.tenantId);
  const branding = ((tenant?.settings ?? {}) as TenantSettings).branding ?? {};
  const accent = branding.primaryColor || undefined;

  const locale = tenant?.locale ?? "es";
  const t = await getTranslator(locale, "public.contract");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied external URL, no loader configured
            <img src={branding.logoUrl} alt={tenant?.name ?? ""} className="max-h-12" />
          ) : (
            <h1 className="text-lg font-semibold" style={{ color: accent }}>
              {tenant?.name}
            </h1>
          )}
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold" style={{ color: accent }}>
            {t("title")}
          </p>
          <p className="text-sm text-muted-foreground">{contract.number}</p>
          <p className="text-sm text-muted-foreground">
            {documentDate(contract.createdAt, locale)}
          </p>
        </div>
      </header>

      <section className="whitespace-pre-wrap text-sm">{contract.renderedBody}</section>

      {contract.status === "sent" && (
        <a href={`/c/${token}/pdf`} className="text-sm underline">
          {t("downloadPdf")}
        </a>
      )}

      <p className="rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning">
        {t("legalNotice")}
      </p>

      {acceptance ? (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm">
          {t(acceptance.decision === "accepted" ? "decisionAccepted" : "decisionDeclined", {
            name: acceptance.nameTyped,
          })}
        </p>
      ) : contract.status === "sent" ? (
        <ContractDecisionForm
          token={token}
          labels={{
            prompt: t("decisionPrompt"),
            nameLabel: t("decisionNameLabel"),
            namePlaceholder: t("decisionNamePlaceholder"),
            accept: t("decisionAccept"),
            decline: t("decisionDecline"),
            acceptedGeneric: t("decisionAcceptedGeneric"),
            declinedGeneric: t("decisionDeclinedGeneric"),
            errors: {
              nameRequired: t("decisionErrors.nameRequired"),
              rateLimited: t("decisionErrors.rateLimited"),
              alreadyDecided: t("decisionErrors.alreadyDecided"),
              notSent: t("decisionErrors.notSent"),
              invalid: t("decisionErrors.invalid"),
            },
          }}
        />
      ) : null}

      <footer className="mt-8 text-center text-xs text-muted-foreground">{tenant?.name}</footer>
    </main>
  );
}
