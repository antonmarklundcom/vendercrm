import Link from "next/link";
import { Button } from "@/components/ui/button";
import { approveAllRowsAction } from "./actions";
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
  approveAll: string;
  approveAllHint: string;
};

export function NeedsYou({ rows, labels }: { rows: OpsRowView[]; labels: NeedsYouLabels }) {
  const approvable = rows.filter(({ row }) => row.state === "awaiting_approval").length;

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

      {/* Only ever offers what it says: rows still waiting on approval. A
          failed row or one asking a question is not approvable, and counting
          it here would promise something the action cannot do. */}
      {approvable > 0 && (
        <form action={approveAllRowsAction} className="mt-2 flex flex-col gap-1 border-t pt-3">
          <Button type="submit" variant="secondary" className="w-full">
            {labels.approveAll.replace("{count}", String(approvable))}
          </Button>
          <p className="text-xs text-muted-foreground">{labels.approveAllHint}</p>
        </form>
      )}
    </section>
  );
}
