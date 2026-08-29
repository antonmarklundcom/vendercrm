import type { BookingNotification } from "@/modules/booking/notifications";

// "¿Le avisaron o no?" — the question staff ask about a booking, answered on
// the row itself rather than in a log nobody opens.
//
// The chain (modules/booking/notification-chain.ts) tries up to three rungs
// and every attempt is recorded, so the honest answer is sometimes "we tried
// the template, Meta rejected it, and the email went out instead". The
// summary line says how it ended; the disclosure holds the attempts, newest
// first, for when that is the argument.

export type DeliveryLabels = {
  title: string;
  empty: string;
  never: string;
  kind: Record<string, string>;
  channel: Record<string, string>;
  status: Record<string, string>;
  detail: Record<string, string>;
};

/** Green for arrived, red for didn't, muted for in flight. */
const TONE: Record<string, string> = {
  delivered: "text-emerald-700 dark:text-emerald-400",
  read: "text-emerald-700 dark:text-emerald-400",
  sent: "text-foreground",
  queued: "text-muted-foreground",
  failed: "text-destructive",
  skipped: "text-destructive",
};

export function BookingDelivery({
  notifications,
  labels,
  formatWhen,
}: {
  notifications: BookingNotification[];
  labels: DeliveryLabels;
  formatWhen: (value: Date) => string;
}) {
  if (notifications.length === 0) {
    return <span className="text-xs text-muted-foreground">{labels.never}</span>;
  }

  const [latest] = notifications;

  return (
    <details className="text-xs">
      <summary className={`cursor-pointer ${TONE[latest.status] ?? ""}`}>
        {labels.kind[latest.kind] ?? latest.kind} ·{" "}
        {labels.status[latest.status] ?? latest.status}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 border-l pl-3">
        {notifications.map((row) => (
          <li key={row.id} className="flex flex-col">
            <span className={TONE[row.status] ?? ""}>
              {labels.kind[row.kind] ?? row.kind} · {labels.channel[row.channel] ?? row.channel} ·{" "}
              {labels.status[row.status] ?? row.status} · {formatWhen(row.createdAt)}
            </span>
            {row.detail ? (
              // Known reasons get the explanation a business owner can act
              // on ("Meta todavía no aprobó la plantilla"); anything else —
              // a Graph API error body — is shown verbatim, because a
              // sanitized version of an unknown failure helps nobody.
              <span className="text-muted-foreground">
                {labels.detail[row.detail] ?? row.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
