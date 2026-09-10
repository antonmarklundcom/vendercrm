"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form-fields";
import { formatDateTime } from "@/lib/i18n/format";
import {
  createTokenAction,
  revokeTokenAction,
  setAllowlistAction,
  type AllowlistState,
  type CreateTokenState,
} from "./actions";
import {
  canCloseReveal,
  isRevealAcknowledged,
  isRevealOpen,
  shouldWarnBeforeUnload,
  warnBeforeUnload,
  type TokenRevealState,
} from "./tokenReveal";
import type { OpsTokenSummary } from "@/modules/ops";

// The session's credential (PLAN.md §18.1.1, §18.4). Shown in plaintext
// exactly once, right after creation — nothing is stored that could show it
// again, so the reveal is a modal that cannot be dismissed by Escape, by a
// click outside, or by a refresh without the browser asking first. It used to
// be an inline panel, and a token was lost to exactly that: created, rendered
// somewhere off the owner's eyeline, gone on the next navigation.

export type TokenPanelLabels = {
  title: string;
  createLabel: string;
  createPlaceholder: string;
  createSubmit: string;
  revealTitle: string;
  revealHint: string;
  revealWarning: string;
  revealAck: string;
  revealDone: string;
  copy: string;
  copied: string;
  prefix: string;
  lastUsed: string;
  calls: string;
  never: string;
  allowlist: string;
  allowlistNone: string;
  allowlistPlaceholder: string;
  allowlistHint: string;
  allowlistUnknown: string;
  revoke: string;
  revoked: string;
  errorInvalid: string;
  noneYet: string;
};

const initialState: CreateTokenState = { error: null, token: null };

function CreateTokenForm({ labels }: { labels: TokenPanelLabels }) {
  const [state, formAction, pending] = useActionState(createTokenAction, initialState);
  const [copied, setCopied] = useState(false);
  // Keyed on the plaintext, not booleans: creating a second token in the same
  // session has to start from unacknowledged again (see tokenReveal.ts).
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(null);
  const [closedFor, setClosedFor] = useState<string | null>(null);

  const plaintext = state.token?.plaintext ?? null;
  const reveal: TokenRevealState = { plaintext, acknowledgedFor, closedFor };
  const open = isRevealOpen(reveal);
  const acknowledged = isRevealAcknowledged(reveal);
  const atRisk = shouldWarnBeforeUnload(reveal);

  // The failure that cost a token: refresh or navigate while the plaintext is
  // on screen and it is gone with no way back. This is the browser's own
  // "leave site?" prompt — the only interruption that survives a reload.
  useEffect(() => {
    if (!atRisk) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      warnBeforeUnload(event, { plaintext, acknowledgedFor, closedFor }, labels.revealWarning);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [atRisk, plaintext, acknowledgedFor, closedFor, labels.revealWarning]);

  async function copyToken(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the token is still selectable on screen.
    }
  }

  return (
    <>
      <form action={formAction} className="flex flex-col gap-2">
        <Input name="label" placeholder={labels.createPlaceholder} required maxLength={100} />
        {state.error && <p className="text-sm text-destructive">{labels.errorInvalid}</p>}
        <Button type="submit" size="sm" disabled={pending}>
          {labels.createSubmit}
        </Button>
      </form>

      <Dialog
        open={open}
        onClose={() => setClosedFor(plaintext)}
        label={labels.revealTitle}
        dismissible={false}
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold">{labels.revealTitle}</h2>
          <p className="text-sm text-muted-foreground">{labels.revealHint}</p>
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{labels.revealWarning}</span>
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded border bg-muted/40 px-2 py-1 font-mono text-xs">
              {plaintext}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => plaintext && copyToken(plaintext)}
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copied ? labels.copied : labels.copy}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={acknowledged}
              onChange={(event) => setAcknowledgedFor(event.target.checked ? plaintext : null)}
            />
            {labels.revealAck}
          </label>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!canCloseReveal(reveal)}
              onClick={() => setClosedFor(plaintext)}
            >
              {labels.revealDone}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function TokenPanel({
  tokens,
  tenantNames,
  labels,
  locale,
}: {
  tokens: OpsTokenSummary[];
  /** id → name for every business, so allowlists render as names. */
  tenantNames: Record<string, string>;
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
              <AllowlistForm token={token} tenantNames={tenantNames} labels={labels} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const initialAllowlistState: AllowlistState = { unknown: [], saved: false };

function AllowlistForm({
  token,
  tenantNames,
  labels,
}: {
  token: OpsTokenSummary;
  tenantNames: Record<string, string>;
  labels: TokenPanelLabels;
}) {
  const allowed = Array.isArray(token.allowedTenantIds)
    ? (token.allowedTenantIds as string[])
    : [];
  // Stored values are ids; show the business name when it resolves. A raw
  // id showing through means the business no longer exists (or a value was
  // saved before the console validated entries) — visible on purpose.
  const shown = allowed.map((id) => tenantNames[id] ?? id);
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(setAllowlistAction, initialAllowlistState);

  // Close the editor only once the server accepted the list; an unknown
  // entry keeps the form open with the offending names underneath it.
  useEffect(() => {
    if (state.saved) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {labels.allowlist}: {shown.length > 0 ? shown.join(", ") : labels.allowlistNone}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {labels.allowlist}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tokenId" value={token.id} />
        <Input
          name="tenantIds"
          defaultValue={shown.join(", ")}
          placeholder={labels.allowlistPlaceholder}
          className="h-8 flex-1 text-xs"
          aria-label={labels.allowlist}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {labels.allowlist}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{labels.allowlistHint}</p>
      {state.unknown.length > 0 && (
        <p className="text-xs text-destructive">
          {labels.allowlistUnknown}: {state.unknown.join(", ")}
        </p>
      )}
    </form>
  );
}
