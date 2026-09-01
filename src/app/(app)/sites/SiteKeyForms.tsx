"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  createSiteAction,
  issueApiKeyAction,
  revokeApiKeyAction,
  type CreateSiteFormState,
  type IssueKeyState,
  type SiteField,
} from "./actions";
import { Input, Select } from "@/components/ui/form-fields";

// Lives here, not in actions.ts: a "use server" module may only export
// async functions.
const createInitialState: CreateSiteFormState = {
  error: null,
  field: null,
  values: {},
  apiKey: null,
};

// The API key is returned by the action and rendered here once. It is never
// stored in plaintext (§5.1) — reloading the page loses it, which is the
// intended behaviour, so the copy prompt is deliberately loud.

function KeyReveal({ apiKey, labels }: { apiKey: string; labels: KeyLabels }) {
  return (
    <div className="rounded-md border border-warning/30 bg-warning-surface p-3 text-sm text-warning">
      <p className="font-medium">{labels.copyNow}</p>
      <code className="mt-2 block break-all rounded bg-background px-2 py-1 font-mono text-xs">
        {apiKey}
      </code>
    </div>
  );
}

export type KeyLabels = {
  copyNow: string;
  name: string;
  slug: string;
  domain: string;
  pipeline: string;
  stage: string;
  waAccount: string;
  none: string;
  create: string;
};

type Option = { id: string; label: string };

export function NewSiteForm({
  labels,
  pipelines,
  stages,
  waAccounts,
}: {
  labels: KeyLabels;
  pipelines: Option[];
  stages: Option[];
  waAccounts: Option[];
}) {
  const t = useTranslations("app.sites");
  const [state, formAction, pending] = useActionState(createSiteAction, createInitialState);

  function FieldError({ field }: { field: SiteField }) {
    if (state.field !== field || !state.error) return null;
    return (
      <span role="alert" className="text-xs text-destructive">
        {t(`errors.${state.error}` as "errors.unknown")}
      </span>
    );
  }

  return (
    <div className="flex max-w-sm flex-col gap-4">
      {state.apiKey && <KeyReveal apiKey={state.apiKey} labels={labels} />}
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {labels.name}
          <Input
            name="name"
            defaultValue={state.values.name ?? ""}
          />
          <FieldError field="name" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.slug}
          <Input
            name="slug"
            defaultValue={state.values.slug ?? ""}
          />
          <FieldError field="slug" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.domain}
          <Input
            name="domain"
            defaultValue={state.values.domain ?? ""}
            placeholder="dentista.com.py"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.pipeline}
          <Select name="defaultPipelineId">
            <option value="">{labels.none}</option>
            {pipelines.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.stage}
          <Select name="defaultStageId">
            <option value="">{labels.none}</option>
            {stages.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.waAccount}
          <Select name="waAccountId">
            <option value="">{labels.none}</option>
            {waAccounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        {state.error && state.field === null && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${state.error}` as "errors.unknown")}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {labels.create}
        </Button>
      </form>
    </div>
  );
}

// Two-active-key rotation (PLAN.md §5.2). The panel exists to make the
// rotation *provable*: it shows each live key's prefix and when it was last
// used, so the admin can see the new key taking over before revoking the old
// one. Revoking blind is what the old single-key rotation forced.
const issueInitialState: IssueKeyState = { apiKey: null, error: null };

export type ApiKeyRow = {
  id: string;
  prefix: string;
  label: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
};

export function SiteKeysPanel({
  siteId,
  keys,
  labels,
  maxActive,
}: {
  siteId: string;
  keys: ApiKeyRow[];
  labels: KeyLabels;
  maxActive: number;
}) {
  const t = useTranslations("app.sites.keys");
  const [state, formAction, pending] = useActionState(issueApiKeyAction, issueInitialState);

  const active = keys.filter((key) => !key.revoked);

  return (
    <div className="flex flex-col gap-2 text-sm">
      {state.apiKey && <KeyReveal apiKey={state.apiKey} labels={labels} />}

      <ul className="flex flex-col gap-1">
        {active.map((key) => (
          <li
            key={key.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
          >
            <span>
              <code className="font-mono text-xs">{key.prefix}…</code>
              {key.label && <span className="text-muted-foreground"> · {key.label}</span>}
              <span className="text-muted-foreground">
                {" "}
                · {key.lastUsedAt ? t("lastUsed", { when: key.lastUsedAt }) : t("neverUsed")}
              </span>
            </span>
            {/* The last live key has no revoke button: revoking it would
                leave the site unable to post at all, which is the outage
                two-key rotation exists to prevent. */}
            {active.length > 1 && (
              <form action={revokeApiKeyAction}>
                <input type="hidden" name="siteId" value={siteId} />
                <input type="hidden" name="keyId" value={key.id} />
                <Button type="submit" size="sm" variant="ghost">
                  {t("revoke")}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {active.length < maxActive ? (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="siteId" value={siteId} />
          <label className="flex flex-col gap-1">
            {t("label")}
            <Input
              name="label"
              placeholder={t("labelPlaceholder")}
              className="px-2 py-1"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t("issue")}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground">{t("maxReached")}</p>
      )}

      {state.error && (
        <p role="alert" className="text-destructive">
          {t(`errors.${state.error}` as "errors.tooManyKeys")}
        </p>
      )}
    </div>
  );
}
