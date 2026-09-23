"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form-fields";
import {
  retireTestLeadAction,
  sendTestLeadAction,
  updateTenantSiteAction,
  type SiteSettingsState,
  type TestLeadState,
} from "./sites-actions";

// Two per-site tools for the console's business page: a test lead that shows
// whether the CRM side of a site works, and the routing settings (pipeline
// stage, owner, WhatsApp number) that decide where its leads land.

export type SiteOption = { id: string; label: string };
export type SiteOptions = { stages: SiteOption[]; owners: SiteOption[]; waAccounts: SiteOption[] };

const testInitial: TestLeadState = { siteId: null, error: null, lead: null };

export function SiteTestLead({ tenantId, siteId }: { tenantId: string; siteId: string }) {
  const t = useTranslations("superadmin.tenantSites.test");
  const [state, send, sending] = useActionState(sendTestLeadAction, testInitial);
  const [retiredFor, setRetiredFor] = useState<string | null>(null);
  const [retiring, startRetire] = useTransition();
  const lead = state.lead;
  const retired = lead !== null && retiredFor === lead.contactId;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={send}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="siteId" value={siteId} />
        <Button type="submit" size="sm" variant="outline" disabled={sending} title={t("help")}>
          <FlaskConical className="size-4" aria-hidden="true" />
          {t("send")}
        </Button>
      </form>
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {t(`errors.${state.error}` as "errors.unknown")}
        </span>
      )}
      {lead && !retired && (
        <>
          <span className="text-xs text-success">{t(lead.dealId ? "okWithDeal" : "ok")}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={retiring}
            onClick={() =>
              startRetire(async () => {
                const formData = new FormData();
                formData.set("tenantId", tenantId);
                formData.set("contactId", lead.contactId);
                formData.set("dealId", lead.dealId ?? "");
                if (await retireTestLeadAction(formData)) setRetiredFor(lead.contactId);
              })
            }
          >
            {t("retire")}
          </Button>
        </>
      )}
      {retired && <span className="text-xs text-muted-foreground">{t("retired")}</span>}
    </div>
  );
}

const settingsInitial: SiteSettingsState = { error: null, saved: false };

export function SiteSettingsDialog({
  tenantId,
  site,
  options,
}: {
  tenantId: string;
  site: {
    id: string;
    name: string;
    domain: string | null;
    defaultStageId: string | null;
    defaultOwnerUserId: string | null;
    waAccountId: string | null;
  };
  options: SiteOptions;
}) {
  const t = useTranslations("superadmin.tenantSites.settings");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, save, saving] = useActionState(updateTenantSiteAction, settingsInitial);

  useEffect(() => {
    if (state.saved) setOpen(false);
  }, [state]);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" aria-hidden="true" />
        {t("open")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} label={t("title")} className="max-w-md">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={tc("close")}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <form action={save} className="flex flex-col gap-4 px-5 py-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="siteId" value={site.id} />
          <label className="flex flex-col gap-1 text-sm">
            {t("name")}
            <Input name="name" defaultValue={site.name} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("domain")}
            <Input name="domain" defaultValue={site.domain ?? ""} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("stage")}
            <Select name="stageId" defaultValue={site.defaultStageId ?? ""}>
              <option value="">{t("keep")}</option>
              {options.stages.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("owner")}
            <Select name="ownerUserId" defaultValue={site.defaultOwnerUserId ?? ""}>
              <option value="">{t("keep")}</option>
              {options.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("whatsapp")}
            <Select name="waAccountId" defaultValue={site.waAccountId ?? ""}>
              <option value="">{t("keep")}</option>
              {options.waAccounts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          {state.error && (
            <p role="alert" className="text-xs text-destructive">
              {t(`errors.${state.error}` as "errors.unknown")}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {tc("save")}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
