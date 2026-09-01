"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  issueHookTokenAction,
  revokeHookTokenAction,
  saveHookMappingAction,
  clearHookCapturesAction,
  type HookTokenState,
  type HookMappingState,
} from "./actions";
import { Input, Select } from "@/components/ui/form-fields";

// The webhook lane's per-site panel (PLAN.md §5.2). This is the surface a
// non-developer uses: issue a URL, paste it into Elementor/Wix/Zapier, send
// one test submission, then pick each CRM field out of the payload that
// actually arrived. Nothing here asks anyone to type a JSON path from memory.

const tokenInitial: HookTokenState = { token: null, error: null };
const mappingInitial: HookMappingState = { error: null, saved: false };

export type CaptureLeaf = { path: string; value: string };

export type HookPanelProps = {
  siteId: string;
  hookUrl: string | null;
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  mapping: { phone?: string; name?: string; email?: string; message?: string } | null;
  captureCount: number;
  /** Paths offered by the newest captured payload. */
  leaves: CaptureLeaf[];
};

const FIELDS = ["phone", "name", "email", "message"] as const;
type MappingField = (typeof FIELDS)[number];

export function SiteHookForm(props: HookPanelProps) {
  const t = useTranslations("app.sites.hook");
  const [tokenState, tokenAction, tokenPending] = useActionState(
    issueHookTokenAction,
    tokenInitial,
  );
  const [mappingState, mappingAction, mappingPending] = useActionState(
    saveHookMappingAction,
    mappingInitial,
  );

  const url = tokenState.token
    ? props.hookUrl?.replace("__TOKEN__", tokenState.token)
    : props.tokenPrefix
      ? props.hookUrl?.replace("__TOKEN__", `${props.tokenPrefix}…`)
      : null;

  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none">
        {t("title")}{" "}
        <span className="text-muted-foreground">
          {props.tokenPrefix ? (props.mapping ? t("statusMapped") : t("statusCapturing")) : t("statusOff")}
        </span>
      </summary>

      <p className="mt-2 text-muted-foreground">{t("intro")}</p>

      {/* The full URL, with its token, is shown exactly once — same rule as
          an API key (§5.1). Afterwards only the prefix is left. */}
      {tokenState.token && url && (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning-surface p-3 text-warning">
          <p className="font-medium">{t("copyNow")}</p>
          <code className="mt-2 block break-all rounded bg-background px-2 py-1 font-mono text-xs">
            {url}
          </code>
        </div>
      )}

      {!tokenState.token && props.tokenPrefix && url && (
        <p className="mt-3 text-muted-foreground">
          <code className="font-mono text-xs">{url}</code>
          {" · "}
          {props.lastUsedAt ? t("lastUsed", { when: props.lastUsedAt }) : t("neverUsed")}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <form action={tokenAction}>
          <input type="hidden" name="siteId" value={props.siteId} />
          <Button type="submit" size="sm" variant="outline" disabled={tokenPending}>
            {props.tokenPrefix ? t("reissue") : t("issue")}
          </Button>
        </form>
        {props.tokenPrefix && (
          <form action={revokeHookTokenAction}>
            <input type="hidden" name="siteId" value={props.siteId} />
            <Button type="submit" size="sm" variant="ghost">
              {t("revoke")}
            </Button>
          </form>
        )}
      </div>

      {props.tokenPrefix && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="font-medium">{t("mappingTitle")}</p>
          {props.leaves.length === 0 ? (
            <p className="text-muted-foreground">{t("noCaptures")}</p>
          ) : (
            <p className="text-muted-foreground">
              {t("captureHelp", { count: props.captureCount })}
            </p>
          )}

          <form action={mappingAction} className="flex flex-col gap-2">
            <input type="hidden" name="siteId" value={props.siteId} />
            {FIELDS.map((field) => (
              <MappingRow
                key={field}
                field={field}
                label={t(`fields.${field}` as "fields.phone")}
                current={props.mapping?.[field] ?? ""}
                leaves={props.leaves}
                manualLabel={t("manualPath")}
              />
            ))}
            {mappingState.error && (
              <p role="alert" className="text-destructive">
                {t(`errors.${mappingState.error}` as "errors.phoneRequired")}
              </p>
            )}
            {mappingState.saved && <p className="text-muted-foreground">{t("saved")}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="outline" disabled={mappingPending}>
                {t("saveMapping")}
              </Button>
            </div>
          </form>

          {props.captureCount > 0 && (
            <form action={clearHookCapturesAction}>
              <input type="hidden" name="siteId" value={props.siteId} />
              <Button type="submit" size="sm" variant="ghost">
                {t("clearCaptures")}
              </Button>
            </form>
          )}
        </div>
      )}
    </details>
  );
}

/**
 * One CRM field. The picker lists the paths found in the captured payload
 * with a preview of the value, so the choice is "Ana Giménez" rather than
 * `fields.nombre.value`. The free-text box stays for a path capture didn't
 * offer — an optional field the test submission left blank, for instance.
 */
function MappingRow({
  field,
  label,
  current,
  leaves,
  manualLabel,
}: {
  field: MappingField;
  label: string;
  current: string;
  leaves: CaptureLeaf[];
  manualLabel: string;
}) {
  const known = leaves.some((leaf) => leaf.path === current);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        {label}
        <Select
          name={`${field}Choice`}
          defaultValue={known ? current : ""}
          className="px-2 py-1"
        >
          <option value="">—</option>
          {leaves.map((leaf) => (
            <option key={leaf.path} value={leaf.path}>
              {leaf.path} · {leaf.value}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        {manualLabel}
        <Input
          name={`${field}Path`}
          defaultValue={known ? "" : current}
          placeholder="fields.telefono.value"
          className="px-2 py-1 font-mono text-xs"
        />
      </label>
    </div>
  );
}
