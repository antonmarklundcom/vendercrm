import type { OpsRow, OpsStep, OpsStepStatus, OpsSteps } from "@/modules/ops/batches";
import { cn } from "@/lib/utils";

// The worksheet's five-cell strip (PLAN.md §18.4): company · site · pipeline
// · key · test lead, one colour per state. A scan of the column tells the
// owner where a row is without reading a word — the mockup's whole point for
// this control (docs/design/claude-ops-mockup.html §03).
//
// Types only from modules/ops/batches — this renders inside a client
// component (Worksheet), and the barrel (`@/modules/ops`) also re-exports
// provision.ts, which pulls in next/headers through the tenancy context.
// `OPS_STEPS` itself is one of the five step ids, restated here rather than
// imported as a value for the same reason.

const OPS_STEPS: readonly OpsStep[] = ["tenant", "site", "pipeline", "key", "test_lead"];

const STEP_LABELS: Record<OpsStep, string> = {
  tenant: "company",
  site: "site",
  pipeline: "pipeline",
  key: "API key",
  test_lead: "test lead",
};

const STATE_CLASS: Record<OpsStepStatus, string> = {
  done: "bg-success border-success",
  failed: "bg-destructive border-destructive",
  pending: "bg-muted border-border",
  skipped: "bg-muted border-border",
};

export function StepStrip({ row }: { row: OpsRow }) {
  const steps = (row.steps ?? {}) as OpsSteps;

  return (
    <span
      className="inline-grid grid-cols-5 gap-1"
      title="tenant · site · pipeline · key · test lead"
    >
      {OPS_STEPS.map((step) => {
        const status = steps[step]?.status ?? "pending";
        return (
          <span
            key={step}
            className={cn("h-4 w-4 rounded-sm border", STATE_CLASS[status])}
            role="img"
            aria-label={`${STEP_LABELS[step]}: ${status}`}
          />
        );
      })}
    </span>
  );
}
