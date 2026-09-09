"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { formatDateTime } from "@/lib/i18n/format";
import {
  createTokenAction,
  revokeTokenAction,
  setAllowlistAction,
  type CreateTokenState,
} from "./actions";
import type { OpsTokenSummary } from "@/modules/ops";

// The session's credential (PLAN.md §18.1.1, §18.4). Shown in plaintext
// exactly once, right after creation — the same "here's a link, copy it now"
// idiom ResetPasswordButton already uses for a reset URL, since there is
// nothing to fetch back afterwards either way.

export type TokenPanelLabels = {
  title: string;
  createLabel: string;
  createPlaceholder: string;
  createSubmit: string;
  revealTitle: string;
  revealHint: string;
  copy: string;
  copied: string;
  prefix: string;
  lastUsed: string;
  calls: string;
  never: string;
  allowlist: string;
  allowlistNone: string;
  revoke: string;
  revoked: string;
  errorInvalid: string;
  noneYet: string;
};

const initialState: CreateTokenState = { error: null, token: null };

function CreateTokenForm({ labels }: { labels: TokenPanelLabels }) {
  const [state, formAction, pending] = useActionState(createTokenAction, initialState);
  const [copied, setCopied] = useState(false);

  async function copyToken(plaintext: string) {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the token is still selectable on screen.
    }
  }

  if (state.token) {
    return (
      <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
        <span className="text-sm font-medium">{labels.revealTitle}</span>
        <p className="text-xs text-muted-foreground">{labels.revealHint}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded border bg-background px-2 py-1 font-mono text-xs">
            {state.token.plaintext}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => copyToken(state.token!.plaintext)}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? labels.copied : labels.copy}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Input name="label" placeholder={labels.createPlaceholder} required maxLength={100} />
      {state.error && <p className="text-sm text-destructive">{labels.errorInvalid}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {labels.createSubmit}
      </Button>
    </form>
  );
}

export function TokenPanel({
  tokens,
  labels,
  locale,
}: {
  tokens: OpsTokenSummary[];
  labels: TokenPanelLabels;
  locale: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={labels.title}>
      <h2 className="text-sm font-semibold">{labels.title}</h2>

      <CreateTokenForm labels={labels} />

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noneYet}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{token.label}</span>
                {token.revokedAt ? (
                  <span className="text-xs text-muted-foreground">{labels.revoked}</span>
                ) : (
                  <form action={revokeTokenAction}>
                    <input type="hidden" name="tokenId" value={token.id} />
                    <Button type="submit" size="sm" variant="outline">
                      {labels.revoke}
                    </Button>
                  </form>
                )}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {labels.prefix}: {token.tokenPrefix}••••••••
              </div>
              <div className="text-xs text-muted-foreground">
                {labels.lastUsed}:{" "}
                {token.lastUsedAt ? formatDateTime(token.lastUsedAt, locale) : labels.never} ·{" "}
                {labels.calls}: {token.callCount}
              </div>
              <AllowlistForm token={token} labels={labels} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AllowlistForm({
  token,
  labels,
}: {
  token: OpsTokenSummary;
  labels: TokenPanelLabels;
}) {
  const allowed = Array.isArray(token.allowedTenantIds)
    ? (token.allowedTenantIds as string[])
    : [];
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {labels.allowlist}: {allowed.length > 0 ? allowed.join(", ") : labels.allowlistNone}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {labels.allowlist}
        </Button>
      </div>
    );
  }

  return (
    <form
      action={setAllowlistAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={() => setEditing(false)}
    >
      <input type="hidden" name="tokenId" value={token.id} />
      <Input
        name="tenantIds"
        defaultValue={allowed.join(",")}
        placeholder="tenant-id-1,tenant-id-2"
        className="h-8 flex-1 text-xs"
      />
      <Button type="submit" size="sm" variant="outline">
        {labels.allowlist}
      </Button>
    </form>
  );
}
