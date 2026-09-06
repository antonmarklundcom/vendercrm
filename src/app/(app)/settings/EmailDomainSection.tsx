import { Input } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import {
  updateContactEmailAction,
  addEmailDomainAction,
  retryEmailDomainAction,
  removeEmailDomainAction,
  setEmailFromLocalPartAction,
} from "./actions";
import { listTenantEmailDomains, isResendDomainsConfigured } from "@/modules/tenancy/email-domains";
import type { TenantContext } from "@/modules/tenancy/context";
import type { TenantSettings } from "@/modules/tenancy/settings";

type DnsRecord = { record?: string; name?: string; type?: string; value?: string; status?: string };

/** Own-domain email identity (PLAN.md §15.1, §15.8 P4). Server component,
 *  plain bound forms — the same shape the chat page's toggle buttons use —
 *  since every field here is admin-only and errors have nowhere better to
 *  land than "nothing changed". */
export async function EmailDomainSection({
  ctx,
  settings,
  t,
}: {
  ctx: TenantContext;
  settings: TenantSettings;
  t: Awaited<ReturnType<typeof import("next-intl/server").getTranslations<"app.settings">>>;
}) {
  const domains = await listTenantEmailDomains(ctx);
  const resendConfigured = isResendDomainsConfigured();

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{t("email.emailTitle")}</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("email.emailIntro")}</p>

      <form action={updateContactEmailAction} className="mb-6 flex max-w-sm flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("email.contactEmailLabel")}
          <Input
            name="contactEmail"
            type="email"
            defaultValue={settings.contactEmail ?? ""}
            required
          />
        </label>
        <Button type="submit" size="sm" className="w-fit">
          {t("email.contactEmailSave")}
        </Button>
      </form>

      <h3 className="mb-2 text-sm font-semibold">{t("email.domainsTitle")}</h3>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t("email.domainsIntro")}</p>

      {!resendConfigured && (
        <p className="mb-3 text-sm text-warning">{t("email.resendNotConfigured")}</p>
      )}

      <form action={addEmailDomainAction} className="mb-4 flex max-w-sm gap-2">
        <Input name="domain" placeholder={t("email.addDomainLabel")} className="flex-1" />
        <Button type="submit" size="sm" variant="outline">
          {t("email.addDomainAction")}
        </Button>
      </form>

      <ul className="flex flex-col gap-3">
        {domains.map((domain) => (
          <li key={domain.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{domain.domain}</span>
              <span
                className={
                  domain.status === "verified"
                    ? "text-success"
                    : domain.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {t(`email.domainStatusValues.${domain.status}` as "email.domainStatusValues.pending")}
              </span>
            </div>

            {domain.status === "verified" && (
              <form action={setEmailFromLocalPartAction.bind(null, domain.id)} className="flex gap-2">
                <Input
                  name="fromLocalPart"
                  defaultValue={domain.fromLocalPart ?? "ventas"}
                  placeholder={t("email.fromLocalPartLabel")}
                  className="flex-1"
                />
                <Button type="submit" size="sm" variant="outline">
                  {t("email.fromLocalPartSave")}
                </Button>
              </form>
            )}

            {domain.status === "pending" &&
              Array.isArray(domain.dnsRecords) &&
              domain.dnsRecords.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="mb-1 text-xs text-muted-foreground">{t("email.dnsRecordsIntro")}</p>
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {(domain.dnsRecords as DnsRecord[]).map((record, index) => (
                        <tr key={index} className="border-b">
                          <td className="py-1 pr-2 font-mono">{record.type ?? record.record}</td>
                          <td className="py-1 pr-2 font-mono">{record.name}</td>
                          <td className="max-w-xs truncate py-1 font-mono" title={record.value}>
                            {record.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            <div className="flex gap-3 text-xs">
              {domain.status !== "verified" && (
                <form action={retryEmailDomainAction.bind(null, domain.id)}>
                  <button type="submit" className="underline">
                    {t("email.retryVerification")}
                  </button>
                </form>
              )}
              <form action={removeEmailDomainAction.bind(null, domain.id)}>
                <button type="submit" className="text-destructive underline">
                  {t("email.removeDomain")}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
