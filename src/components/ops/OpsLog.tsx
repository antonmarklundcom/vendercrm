import Link from "next/link";
import { formatDateTime } from "@/lib/i18n/format";
import type { listAuditLog } from "@/modules/tenancy/audit";

export type OpsLogEntry = Awaited<ReturnType<typeof listAuditLog>>[number];

// The provisioning log (PLAN.md §18.4): the existing audit log, filtered on
// the `via` marker every Claude Ops write carries, with the three chips the
// mockup calls for. No second trail — see queries.ts's listOpsAuditEntries.

export type OpsLogLabels = {
  title: string;
  when: string;
  action: string;
  object: string;
  via: string;
  empty: string;
  filterBatch: string;
  filterFailures: string;
  filterAll: string;
  openFull: string;
};

export function OpsLog({
  entries,
  batchId,
  filter,
  labels,
  locale,
}: {
  entries: OpsLogEntry[];
  batchId: string | null;
  filter: "batch" | "failures" | "all";
  labels: OpsLogLabels;
  locale: string;
}) {
  const scoped = entries.filter((entry) => {
    if (filter === "batch" && batchId) {
      const payload = entry.payload as Record<string, unknown> | null;
      return payload?.batch_id === batchId;
    }
    if (filter === "failures") {
      return /fail|reject/i.test(entry.action);
    }
    return true;
  });

  function chipHref(next: "batch" | "failures" | "all") {
    const params = new URLSearchParams();
    if (batchId) params.set("batch", batchId);
    params.set("log", next);
    return `/claude-ops?${params.toString()}`;
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={labels.title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{labels.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(
            [
              ["batch", labels.filterBatch],
              ["failures", labels.filterFailures],
              ["all", labels.filterAll],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={chipHref(key)}
              className={`rounded-full px-2.5 py-1 ${
                filter === key ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {label}
            </Link>
          ))}
          <Link href="/audit" className="underline">
            {labels.openFull}
          </Link>
        </div>
      </div>

      {scoped.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                <th className="py-2 pr-3 font-medium">{labels.when}</th>
                <th className="py-2 pr-3 font-medium">{labels.action}</th>
                <th className="py-2 pr-3 font-medium">{labels.object}</th>
                <th className="py-2 font-medium">{labels.via}</th>
              </tr>
            </thead>
            <tbody>
              {scoped.map((entry) => {
                const via = (entry.payload as Record<string, unknown> | null)?.via;
                return (
                  <tr key={entry.id} className="border-b">
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt, locale)}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{entry.action}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {entry.entity}/{entry.entityId}
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {typeof via === "string" ? via : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
