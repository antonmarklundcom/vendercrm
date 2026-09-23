"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ConsoleRowResult } from "@/modules/ops";
import { downloadText, keysCsv, keysEnv } from "@/components/ops/key-export";
import {
  approveAllRowsAction,
  provisionRowAction,
  startProvisionAction,
  type StartProvisionState,
} from "./actions";

// Paste domains, get businesses with API keys (PLAN.md §18.3 without the
// terminal). The rows run one request each, in order, so the page shows
// progress and a slow host never times a whole run out. The keys exist only
// in this page's memory — the CRM keeps hashes — so the download buttons are
// the point of the panel, and leaving before using one asks first.

const initial: StartProvisionState = {
  error: null,
  batchId: null,
  rows: [],
  existing: [],
  invalid: [],
  duplicates: [],
};

type RowStatus =
  | { state: "pending" }
  | { state: "running" }
  | { state: "done"; result: ConsoleRowResult };

export function ProvisionPanel({ appUrl }: { appUrl: string }) {
  const t = useTranslations("superadmin.ops.provision");
  const [state, formAction, preparing] = useActionState(startProvisionAction, initial);
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [running, setRunning] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const startedFor = useRef<string | null>(null);
  const router = useRouter();

  const rows = state.rows;
  const results = rows.map((row) => ({ row, status: status[row.id] }));
  const done = results.filter((r) => r.status?.state === "done");
  const keys = done.flatMap((r) =>
    r.status?.state === "done" && r.status.result.ok && r.status.result.apiKey
      ? [{ ...r.row, apiKey: r.status.result.apiKey }]
      : [],
  );
  const failed = done.filter((r) => r.status?.state === "done" && !r.status.result.ok).length;

  async function run(ids: string[]) {
    setRunning(true);
    for (const id of ids) {
      setStatus((s) => ({ ...s, [id]: { state: "running" } }));
      let result: ConsoleRowResult;
      try {
        result = await provisionRowAction(id);
      } catch {
        result = { ok: false, step: "?", reason: t("networkError") };
      }
      setStatus((s) => ({ ...s, [id]: { state: "done", result } }));
    }
    setRunning(false);
    // The worksheet and "needs you" list below are server-rendered; show them
    // the rows this run just moved to awaiting approval.
    router.refresh();
  }

  // A prepared batch starts right away: preparing it was the decision.
  useEffect(() => {
    if (state.batchId && startedFor.current !== state.batchId && rows.length > 0) {
      startedFor.current = state.batchId;
      setDownloaded(false);
      void run(rows.map((row) => row.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.batchId]);

  // Keys that were never downloaded are gone once the page is.
  useEffect(() => {
    if (keys.length === 0 || downloaded) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [keys.length, downloaded]);

  const stamp = new Date().toISOString().slice(0, 10);

  function rowLabel(s: RowStatus | undefined): string {
    if (!s || s.state === "pending") return t("rowPending");
    if (s.state === "running") return t("rowRunning");
    const { result } = s;
    if (!result.ok) return t("rowFailed", { step: result.step, reason: result.reason });
    return result.apiKey ? t("rowDone") : t("rowDoneNoKey");
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        <Textarea
          name="domains"
          rows={6}
          placeholder={"dentista.com.py, Dentista Paraguay\ngruas.com.py"}
          className="font-mono text-xs"
          disabled={running}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={preparing || running}>
            <Play className="size-4" aria-hidden="true" />
            {t("submit")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("help")}</p>
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${state.error}`)}
          </p>
        )}
        {state.invalid.length > 0 && (
          <p className="text-xs text-destructive">
            {t("invalid", { lines: state.invalid.join(" · ") })}
          </p>
        )}
        {state.existing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("existing", { domains: state.existing.join(", ") })}
          </p>
        )}
      </form>

      {rows.length > 0 && (
        <>
          <p className="text-sm">
            {t("progress", { done: done.length, total: rows.length, failed })}
          </p>
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {results.map(({ row, status: s }) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{row.domain}</span>{" "}
                  <span className="text-muted-foreground">{row.name}</span>
                </span>
                <span
                  className={cn(
                    "text-xs",
                    s?.state === "done" && s.result.ok && "text-success",
                    s?.state === "done" && !s.result.ok && "text-destructive",
                    (!s || s.state !== "done") && "text-muted-foreground",
                  )}
                >
                  {rowLabel(s)}
                </span>
              </li>
            ))}
          </ul>

          {failed > 0 && !running && (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() =>
                run(
                  results
                    .filter((r) => r.status?.state === "done" && !r.status.result.ok)
                    .map((r) => r.row.id),
                )
              }
            >
              {t("retryFailed")}
            </Button>
          )}

          {keys.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-surface p-3 text-sm text-warning">
              <p className="font-medium">{t("keysWarning", { count: keys.length })}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    downloadText(`vendercrm-keys-${stamp}.csv`, keysCsv(keys, appUrl), "text/csv");
                    setDownloaded(true);
                  }}
                >
                  <Download className="size-4" aria-hidden="true" />
                  CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    downloadText(`vendercrm-keys-${stamp}.env.txt`, keysEnv(keys, appUrl), "text/plain");
                    setDownloaded(true);
                  }}
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t("downloadEnv")}
                </Button>
              </div>
            </div>
          )}

          {!running && done.length === rows.length && done.length > failed && (
            <form action={approveAllRowsAction} className="flex flex-wrap items-center gap-3">
              <Button type="submit">{t("approveAll")}</Button>
              <p className="text-xs text-muted-foreground">{t("approveHelp")}</p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
