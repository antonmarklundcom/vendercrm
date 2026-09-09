"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { createBatchAction } from "./actions";
import type { OpsBatchRow, OpsRowState } from "@/modules/ops";
import type { OpsRowView } from "./queries";

// The batch bar (§18.4): which batch, and a roll-up of its rows by state.
// The dropdown is the "past batches" the mockup puts in the header — every
// batch a click away, newest first.

export type BatchBarLabels = {
  select: string;
  newBatch: string;
  newBatchPlaceholder: string;
  newBatchSubmit: string;
  cancel: string;
  states: Record<OpsRowState, string>;
  noBatches: string;
};

export function BatchBar({
  batches,
  activeBatchId,
  rows,
  labels,
}: {
  batches: OpsBatchRow[];
  activeBatchId: string | null;
  rows: OpsRowView[];
  labels: BatchBarLabels;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const counts = rows.reduce<Record<string, number>>((acc, { row }) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-3">
        {batches.length === 0 ? (
          <span className="text-sm text-muted-foreground">{labels.noBatches}</span>
        ) : (
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={activeBatchId ?? ""}
            onChange={(event) => router.push(`/claude-ops?batch=${event.target.value}`)}
            aria-label={labels.select}
          >
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.title}
              </option>
            ))}
          </select>
        )}

        {activeBatchId && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(counts).map(([state, count]) => (
              <span key={state} className="rounded-full bg-muted px-2 py-1">
                {count} {labels.states[state as OpsRowState] ?? state}
              </span>
            ))}
          </div>
        )}
      </div>

      {creating ? (
        <form
          action={createBatchAction}
          className="flex items-center gap-2"
          onSubmit={() => setCreating(false)}
        >
          <Input
            name="title"
            required
            placeholder={labels.newBatchPlaceholder}
            className="h-9 w-64"
          />
          <Button type="submit" size="sm">
            {labels.newBatchSubmit}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(false)}>
            {labels.cancel}
          </Button>
        </form>
      ) : (
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          {labels.newBatch}
        </Button>
      )}
    </div>
  );
}
