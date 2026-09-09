import Link from "next/link";
import type { OpsRowView } from "./queries";

// "Needs you" (§18.4): every row waiting on the owner, across every batch —
// the one list that answers "what do I have to look at today" without
// picking a batch first.

export type NeedsYouLabels = {
  title: string;
  empty: string;
  awaitingApproval: string;
  needsInput: string;
  failed: string;
};

export function NeedsYou({ rows, labels }: { rows: OpsRowView[]; labels: NeedsYouLabels }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border p-4" aria-label={labels.title}>
      <h2 className="text-sm font-semibold">
        {labels.title}
        {rows.length > 0 && <span className="ml-2 text-muted-foreground">{rows.length}</span>}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map(({ row }) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <Link href={`/claude-ops?batch=${row.batchId}`} className="underline">
                {row.domain}
              </Link>
              <span className="text-xs text-muted-foreground">
                {row.state === "failed"
                  ? labels.failed
                  : row.state === "needs_input"
                    ? labels.needsInput
                    : labels.awaitingApproval}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
