import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/i18n/format";
import type { CoachBriefingRow } from "@/modules/coach/briefing";

// The weekly AI briefing card (PLAN.md §15.3 L2, §17.2 P14) — the latest
// Monday narrative plus its three recommendations, with a link to the full
// list. Absent entirely for a tenant with no briefing yet (its first Monday
// hasn't happened).
export function BriefingCard({
  briefing,
  locale,
  labels,
}: {
  briefing: CoachBriefingRow;
  locale: string;
  labels: { title: string; viewAll: string; recommendationsTitle: string };
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <Link href="/dashboard/briefings" className="text-sm underline underline-offset-4">
          {labels.viewAll}
        </Link>
      </div>
      <Card className="flex flex-col gap-3">
        <Link
          href={`/dashboard/briefings/${briefing.id}`}
          className="flex items-start justify-between gap-3"
        >
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">
              {formatDate(briefing.weekStart, locale, { dateStyle: "medium" })}
            </span>
            <p className="text-sm">{briefing.narrative}</p>
          </div>
          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
        <div className="flex flex-col gap-1 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            {labels.recommendationsTitle}
          </span>
          <ul className="flex flex-col gap-1 text-sm">
            {briefing.recommendations.map((line, index) => (
              <li key={index}>• {line}</li>
            ))}
          </ul>
        </div>
      </Card>
    </section>
  );
}
