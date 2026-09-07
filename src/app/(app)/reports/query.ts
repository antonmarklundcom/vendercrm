import { reportWindow, type ReportFilters, type ReportWindow } from "@/modules/reports/sales";

// One parser for the reports page's URL state, shared with the CSV export
// route (§10 1J's "export is what's on screen" rule, §17.3 P15) — every
// filter lives in the URL (§10 1R #1), never in client state the export
// route couldn't see.

export type ReportsSearchParams = {
  days?: string;
  from?: string;
  to?: string;
  pipelineId?: string;
  agentUserId?: string;
};

export const DAY_PRESETS = [7, 30, 90] as const;
export type DayPreset = (typeof DAY_PRESETS)[number];

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** A custom `from`/`to` pair wins over `days` — picking a custom range and
 *  having a preset silently override it back would look like a bug. */
export function parseReportsWindow(params: ReportsSearchParams, now: Date = new Date()): ReportWindow {
  const from = parseDate(params.from);
  const to = parseDate(params.to);
  if (from && to) {
    // A date input gives midnight; the user means "through the end of that day".
    const inclusiveTo = new Date(to);
    inclusiveTo.setHours(23, 59, 59, 999);
    const days = Math.max(1, Math.round((inclusiveTo.getTime() - from.getTime()) / 86_400_000));
    return { from, to: inclusiveTo, days };
  }

  const days = DAY_PRESETS.includes(Number(params.days) as DayPreset)
    ? (Number(params.days) as DayPreset)
    : 30;
  return reportWindow(days, now);
}

export function parseReportFilters(params: ReportsSearchParams): ReportFilters {
  return {
    pipelineId: params.pipelineId || undefined,
    agentUserId: params.agentUserId || undefined,
  };
}
