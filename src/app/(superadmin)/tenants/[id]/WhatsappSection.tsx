"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import {
  WhatsappEmbeddedSignup,
  type EmbeddedSignupConfig,
} from "@/components/whatsapp-embedded-signup";
import {
  completeTenantEmbeddedSignupAction,
  connectTenantWhatsappAction,
  disconnectTenantWhatsappAction,
  getEmbeddedSignupConfigAction,
  type ConnectWhatsappField,
  type ConnectWhatsappState,
} from "./actions";

// Manage a tenant's WhatsApp connection from the platform side (PLAN.md
// §6.2). Same manual-connect service the tenant admin's own /whatsapp form
// calls, and the same encrypted-at-rest token handling (§3.4) — this
// component is the superadmin door onto that existing capability, not a
// second WhatsApp integration. The Embedded Signup button, when the owner
// has configured it, runs the same service as the tenant's own button, in
// this business's context.

export type WaAccountRow = {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "disconnected" | "error";
  qualityRating: string | null;
  connectedVia: "embedded" | "manual";
};

const connectInitialState: ConnectWhatsappState = { error: null, field: null, values: {} };

export function WhatsappSection({
  tenantId,
  accounts,
}: {
  tenantId: string;
  accounts: WaAccountRow[];
}) {
  const t = useTranslations("superadmin.tenantWhatsapp");
  const [state, formAction, pending] = useActionState(
    connectTenantWhatsappAction,
    connectInitialState,
  );
  // Fetched rather than passed in: null (no button) until the owner
  // configures Embedded Signup, and the manual form below works either way.
  const [embeddedConfig, setEmbeddedConfig] = useState<EmbeddedSignupConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    getEmbeddedSignupConfigAction().then(
      (config) => !cancelled && setEmbeddedConfig(config),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function FieldError({ field }: { field: ConnectWhatsappField }) {
    if (state.field !== field || !state.error) return null;
    return (
      <span role="alert" className="text-xs text-destructive">
        {t(`errors.${state.error}` as "errors.unknown")}
      </span>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{t("title")}</h2>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>

      {accounts.length === 0 ? (
        <p className="mb-6 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="mb-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 font-medium">{t("number")}</th>
                <th className="py-2 font-medium">{t("wabaId")}</th>
                <th className="py-2 font-medium">{t("status")}</th>
                <th className="py-2 font-medium">{t("quality")}</th>
                <th className="py-2 font-medium">{t("connectedVia")}</th>
                <th className="py-2 text-right font-medium">{t("actionsColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b align-top">
                  <td className="py-3 pr-4">
                    <p>{account.displayNumber || account.phoneNumberId}</p>
                    {account.verifiedName && (
                      <p className="text-xs text-muted-foreground">{account.verifiedName}</p>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">{account.wabaId}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={
                        account.status === "connected"
                          ? "text-success"
                          : account.status === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }
                    >
                      {t(`accountStatus.${account.status}` as "accountStatus.connected")}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{account.qualityRating ?? "—"}</td>
                  <td className="py-3 pr-4">
                    {t(`connectedViaValues.${account.connectedVia}` as "connectedViaValues.manual")}
                  </td>
                  <td className="py-3 text-right">
                    {account.status !== "disconnected" && (
                      <form action={disconnectTenantWhatsappAction}>
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="accountId" value={account.id} />
                        <Button type="submit" size="sm" variant="outline">
                          {t("disconnect")}
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mb-3 text-base font-medium">{t("connectTitle")}</h3>
      {embeddedConfig && (
        <div className="mb-6">
          <WhatsappEmbeddedSignup
            config={embeddedConfig}
            namespace="superadmin.tenantWhatsapp"
            complete={(payload) => completeTenantEmbeddedSignupAction({ ...payload, tenantId })}
          />
          <h4 className="mt-6 text-sm font-medium">{t("embedded.manualTitle")}</h4>
        </div>
      )}
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t("connectHelp")}</p>
      <form action={formAction} className="flex max-w-sm flex-col gap-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="flex flex-col gap-1 text-sm">
          {t("wabaIdLabel")}
          <Input name="wabaId" defaultValue={state.values.wabaId ?? ""} />
          <FieldError field="wabaId" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("phoneNumberId")}
          <Input name="phoneNumberId" defaultValue={state.values.phoneNumberId ?? ""} />
          <FieldError field="phoneNumberId" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("displayNumber")}
          <Input name="displayNumber" defaultValue={state.values.displayNumber ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("accessToken")}
          {/* Not echoed back on a rejected submit — a secret is worth
              retyping, unlike the rest of the form (§3.4). */}
          <Input name="accessToken" type="password" />
          <FieldError field="accessToken" />
        </label>
        {state.error && state.field === null && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${state.error}` as "errors.unknown")}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {t("connect")}
        </Button>
      </form>
    </section>
  );
}
