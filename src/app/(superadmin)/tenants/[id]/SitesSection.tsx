"use client";

import { useActionState, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";
import {
  createTenantSiteAction,
  issueTenantSiteKeyAction,
  revokeTenantSiteKeyAction,
  setTenantSiteActiveAction,
  type SiteKeyState,
} from "./sites-actions";

// A business's sites and their API keys, managed from the console. The goal
// is that getting a live site's key is one click from the business page:
// no impersonation, no hunting through the tenant app.

export type ConsoleSite = {
  id: string;
  slug: string;
  domain: string | null;
  isActive: boolean;
  health: "ok" | "failing" | "idle";
  lastSuccessAt: string | null;
  keys: Array<{
    id: string;
    prefix: string;
    label: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
};

const initial: SiteKeyState = { error: null, apiKey: null, siteId: null };

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (http, permissions): the text is on screen.
        }
      }}
    >
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}

/** The plaintext, once. Offered as the two env lines a site needs, since
 * that is where it is going (skills/vendercrm-lead-capture). */
function KeyReveal({ apiKey, appUrl }: { apiKey: string; appUrl: string }) {
  const t = useTranslations("superadmin.tenantSites");
  const envBlock = `VENDERCRM_URL=${appUrl}\nVENDERCRM_API_KEY=${apiKey}`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-surface p-3 text-sm text-warning">
      <p className="font-medium">{t("copyNow")}</p>
      <code className="block rounded bg-background px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
        {envBlock}
      </code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={apiKey} label={t("copyKey")} copiedLabel={t("copied")} />
        <CopyButton text={envBlock} label={t("copyEnv")} copiedLabel={t("copied")} />
      </div>
    </div>
  );
}

function SiteRow({
  tenantId,
  site,
  appUrl,
  now,
}: {
  tenantId: string;
  site: ConsoleSite;
  appUrl: string;
  now: Date;
}) {
  const t = useTranslations("superadmin.tenantSites");
  const format = useFormatter();
  const [state, formAction, pending] = useActionState(issueTenantSiteKeyAction, initial);

  const healthTone = {
    ok: "bg-success-surface text-success",
    failing: "bg-destructive-surface text-destructive",
    idle: "bg-muted text-muted-foreground",
  }[site.health];

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-all">{site.domain ?? site.slug}</p>
          <p className="text-xs text-muted-foreground">
            {site.slug} ·{" "}
            {site.lastSuccessAt
              ? t("lastLead", { when: format.relativeTime(new Date(site.lastSuccessAt), now) })
              : t("noLeadsYet")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-xs", healthTone)}>
            {t(`health.${site.health}`)}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs",
              site.isActive ? "bg-success-surface text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {site.isActive ? t("active") : t("inactive")}
          </span>
          <form action={setTenantSiteActiveAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="active" value={site.isActive ? "false" : "true"} />
            <Button type="submit" size="sm" variant={site.isActive ? "outline" : "default"}>
              {site.isActive ? t("deactivate") : t("activate")}
            </Button>
          </form>
        </div>
      </div>

      {state.apiKey && state.siteId === site.id && <KeyReveal apiKey={state.apiKey} appUrl={appUrl} />}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("keysTitle")}</p>
        {site.keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noKeys")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {site.keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2">
                  <KeyRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <code className="font-mono">{key.prefix}…</code>
                  {key.label && <span className="text-muted-foreground">{key.label}</span>}
                  <span className="text-muted-foreground">
                    ·{" "}
                    {key.lastUsedAt
                      ? t("keyUsed", { when: format.relativeTime(new Date(key.lastUsedAt), now) })
                      : t("keyNeverUsed")}
                  </span>
                </span>
                <form
                  action={revokeTenantSiteKeyAction}
                  onSubmit={(event) => {
                    if (!window.confirm(t("revokeConfirm"))) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="keyId" value={key.id} />
                  <Button type="submit" size="sm" variant="ghost" className="h-7 text-destructive">
                    {t("revoke")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="siteId" value={site.id} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            <KeyRound className="size-4" aria-hidden="true" />
            {t("newKey")}
          </Button>
          {state.error && state.siteId === site.id && (
            <span role="alert" className="text-xs text-destructive">
              {t(`errors.${state.error}` as "errors.unknown")}
            </span>
          )}
        </form>
      </div>
    </li>
  );
}

export function SitesSection({
  tenantId,
  sites,
  appUrl,
  now,
}: {
  tenantId: string;
  sites: ConsoleSite[];
  appUrl: string;
  /** Server render time, so relative times match on both sides. */
  now: string;
}) {
  const t = useTranslations("superadmin.tenantSites");
  const [state, formAction, pending] = useActionState(createTenantSiteAction, initial);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("intro")} <code className="font-mono text-xs">{`${appUrl}/api/v1/leads`}</code>
        </p>
      </div>

      {sites.length > 0 && (
        <ul className="flex flex-col gap-3">
          {sites.map((site) => (
            <SiteRow
              key={site.id}
              tenantId={tenantId}
              site={site}
              appUrl={appUrl}
              now={new Date(now)}
            />
          ))}
        </ul>
      )}

      {/* A brand-new site's key comes back from the create action itself. */}
      {state.apiKey && <KeyReveal apiKey={state.apiKey} appUrl={appUrl} />}

      <form action={formAction} className="flex max-w-md flex-col gap-1">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label htmlFor="new-site-domain" className="text-sm">
          {t("addSite")}
        </label>
        <div className="flex gap-2">
          <Input id="new-site-domain" name="domain" placeholder="ejemplo.com.py" required />
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" aria-hidden="true" />
            {t("addSiteSubmit")}
          </Button>
        </div>
        {state.error && (
          <span role="alert" className="text-xs text-destructive">
            {t(`errors.${state.error}` as "errors.unknown")}
          </span>
        )}
        <p className="text-xs text-muted-foreground">{t("addSiteHelp")}</p>
      </form>
    </section>
  );
}
