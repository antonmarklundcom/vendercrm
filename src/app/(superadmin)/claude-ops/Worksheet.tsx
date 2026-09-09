"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StepStrip } from "@/components/ops/StepStrip";
import type { OpsRowView } from "./queries";
import { approveRowAction, rejectRowAction, saveBatchTextAction } from "./actions";
import type { OpsRowState } from "@/modules/ops";
import { cn } from "@/lib/utils";

// The worksheet (PLAN.md §18.4): one row per domain, a tab to see the raw
// text instead. The table is the session's interpretation of that text —
// see IntakeForm's copy — so this stays a thin client shell over server
// actions, no local mutation of row data.

export type WorksheetLabels = {
  tabSites: string;
  tabPaste: string;
  colDomain: string;
  colCompany: string;
  colPipeline: string;
  colSteps: string;
  colState: string;
  states: Record<OpsRowState, string>;
  openSite: string;
  review: string;
  emptyRows: string;
  provisioned: string;
  credentials: string;
  rawDetails: string;
  gateNote: string;
  approve: string;
  reject: string;
  rejectPlaceholder: string;
  rejectSubmit: string;
  cancel: string;
  newTenant: string;
  intakeHint: string;
  intakeSave: string;
  intakePlaceholder: string;
};

const STATE_DOT: Record<OpsRowState, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  needs_input: "text-warning",
  failed: "text-destructive",
  awaiting_approval: "text-warning",
  live: "text-success",
};

function StatePill({ state, labels }: { state: OpsRowState; labels: WorksheetLabels }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", STATE_DOT[state])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {labels.states[state]}
    </span>
  );
}

export function Worksheet({
  batch,
  rows,
  labels,
}: {
  batch: { id: string; rawText: string | null };
  rows: OpsRowView[];
  labels: WorksheetLabels;
}) {
  const [tab, setTab] = useState<"rows" | "intake">("rows");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [rejectingRowId, setRejectingRowId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 rounded-md border">
      <div className="flex items-center gap-1 border-b p-2">
        <Button
          type="button"
          size="sm"
          variant={tab === "rows" ? "secondary" : "ghost"}
          onClick={() => setTab("rows")}
        >
          {labels.tabSites}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === "intake" ? "secondary" : "ghost"}
          onClick={() => setTab("intake")}
        >
          {labels.tabPaste}
        </Button>
      </div>

      {tab === "rows" ? (
        rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{labels.emptyRows}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                  <th className="px-3 py-2 font-medium">{labels.colDomain}</th>
                  <th className="px-3 py-2 font-medium">{labels.colCompany}</th>
                  <th className="px-3 py-2 font-medium">{labels.colPipeline}</th>
                  <th className="px-3 py-2 font-medium">{labels.colSteps}</th>
                  <th className="px-3 py-2 font-medium">{labels.colState}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row, tenantName, siteSlug, pipelineName, stageCount, keyPrefix, keyLabel }) => {
                  const isOpen = openRowId === row.id;
                  // The go-live gate only makes sense once a test lead has
                  // landed. A failed row has no site to activate yet — it
                  // needs the session to re-run the step, not an owner click.
                  const canReview = row.state === "awaiting_approval";
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn("cursor-pointer border-b", isOpen && "bg-muted/40")}
                        onClick={() => {
                          setOpenRowId(isOpen ? null : row.id);
                          setRejectingRowId(null);
                        }}
                      >
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium">{row.domain}</div>
                          <div className="text-xs text-muted-foreground">{row.displayName}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          {tenantName ?? (
                            <span className="text-primary">{labels.newTenant}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          {pipelineName ? `${pipelineName} (${stageCount})` : "—"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <StepStrip row={row} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <StatePill state={row.state as OpsRowState} labels={labels} />
                          {row.lastError ? (
                            <div className="mt-1 max-w-[26ch] text-xs text-muted-foreground">
                              {(row.lastError as { reason?: string }).reason}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          {canReview && (
                            <span className="text-xs font-medium text-primary">{labels.review}</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${row.id}-drawer`} className="border-b bg-muted/20">
                          <td colSpan={6} className="p-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <h3 className="mb-2 text-xs font-semibold uppercase">
                                  {labels.provisioned}
                                </h3>
                                <ul className="flex flex-col gap-1 text-sm">
                                  <li>
                                    {labels.colCompany}: {tenantName ?? "—"}
                                  </li>
                                  <li>
                                    site: {siteSlug ?? "—"}
                                  </li>
                                  <li>
                                    {labels.colPipeline}:{" "}
                                    {pipelineName ? `${pipelineName} (${stageCount})` : "—"}
                                  </li>
                                </ul>
                              </div>
                              <div>
                                <h3 className="mb-2 text-xs font-semibold uppercase">
                                  {labels.credentials}
                                </h3>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {keyPrefix ? `${keyPrefix}•••• ${keyLabel ?? ""}` : "—"}
                                </p>
                                {siteSlug && (
                                  <Link
                                    href={`/tenants/${row.tenantId}`}
                                    className="mt-2 inline-block text-xs underline"
                                  >
                                    {labels.openSite}
                                  </Link>
                                )}
                              </div>
                            </div>

                            {row.needsInput && (
                              <p className="mt-3 rounded-md border bg-background px-3 py-2 text-sm">
                                {row.needsInput}
                              </p>
                            )}

                            {canReview && (
                              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                                <p className="max-w-[60ch] text-xs text-muted-foreground">
                                  {labels.gateNote}
                                </p>
                                <div className="flex gap-2">
                                  {rejectingRowId === row.id ? (
                                    <form
                                      action={rejectRowAction}
                                      className="flex items-center gap-2"
                                      onSubmit={() => setRejectingRowId(null)}
                                    >
                                      <input type="hidden" name="rowId" value={row.id} />
                                      <input
                                        name="note"
                                        required
                                        placeholder={labels.rejectPlaceholder}
                                        className="h-9 rounded-md border bg-background px-2 text-sm"
                                      />
                                      <Button type="submit" size="sm" variant="destructive">
                                        {labels.rejectSubmit}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setRejectingRowId(null)}
                                      >
                                        {labels.cancel}
                                      </Button>
                                    </form>
                                  ) : (
                                    <>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setRejectingRowId(row.id)}
                                      >
                                        {labels.reject}
                                      </Button>
                                      <form action={approveRowAction}>
                                        <input type="hidden" name="rowId" value={row.id} />
                                        <Button type="submit" size="sm">
                                          {labels.approve}
                                        </Button>
                                      </form>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <form action={saveBatchTextAction} className="flex flex-col gap-3 p-4">
          <input type="hidden" name="batchId" value={batch.id} />
          <p className="text-xs text-muted-foreground">{labels.intakeHint}</p>
          <Textarea
            name="rawText"
            defaultValue={batch.rawText ?? ""}
            placeholder={labels.intakePlaceholder}
            className="min-h-[220px] font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              {labels.intakeSave}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
