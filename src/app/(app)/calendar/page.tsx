import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listTenantUsers } from "@/modules/tenancy/users";
import { listCalendarEntries } from "@/modules/calendar/agenda";
import {
  bucketByDay,
  buildRange,
  isCalendarView,
  weekGridHours,
  weekGridPosition,
  type CalendarView,
} from "@/modules/calendar/grid";
import { isDayKey, startOfDay, todayIn, weekdayOf } from "@/modules/calendar/zoned-time";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/form-fields";
import { PageHeader } from "@/components/page-header";
import { CreateDialog } from "@/components/create-dialog";
import { cn } from "@/lib/utils";
import { DEFAULT_TIMEZONE, formatDate, formatTime } from "@/lib/i18n/format";
import { EventForm } from "./EventForm";
import { createCalendarEventAction } from "./actions";

// The agenda (PLAN.md §10 — calendar module). Server-rendered: the whole view
// is "which window am I looking at", which the URL already answers, so
// navigating a week is a link rather than a client-side date library.

/** Saturday or Sunday, for the columns that should recede. */
function isWeekend(day: string): boolean {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
}

/** Pixel height of one hour row in the week grid's rail — tall enough for a
 * 30-minute block to still show its title. */
const WEEK_GRID_HOUR_PX = 48;

/** The week grid's own column template: a fixed rail, then seven equal day
 * columns. Shared by every row (header, all-day, hourly body) so they stay
 * aligned. */
const WEEK_GRID_COLUMNS = "3.5rem repeat(7, minmax(0, 1fr))";

export type CalendarSearchParams = {
  view?: string;
  date?: string;
  assignedUserId?: string;
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<CalendarSearchParams>;
}) {
  const params = await searchParams;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.calendar");
  const tc = await getTranslations("common");
  const locale = await getLocale();

  const tenant = await getTenant(ctx.tenantId);
  const timeZone = tenant?.timezone || DEFAULT_TIMEZONE;

  const view: CalendarView = isCalendarView(params.view) ? params.view : "week";
  const anchor = isDayKey(params.date) ? params.date : todayIn(timeZone);
  const range = buildRange(view, anchor, timeZone);

  const assignedUserId = params.assignedUserId || undefined;

  const [entries, users] = await Promise.all([
    listCalendarEntries(ctx, range.from, range.to, { assignedUserId }),
    listTenantUsers(ctx),
  ]);

  const buckets = bucketByDay(entries, range.days, timeZone);
  const weekHours = weekGridHours();
  const userNames = new Map(users.map((user) => [user.id, user.name]));

  function href(overrides: Partial<CalendarSearchParams>): string {
    const next = new URLSearchParams();
    const merged = { view, date: anchor, assignedUserId, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, String(value));
    }
    return `/calendar?${next.toString()}`;
  }

  const monthLabel = formatDate(
    startOfDay(range.view === "week" ? range.days[0] : `${anchor.slice(0, 7)}-01`, timeZone),
    locale,
    { month: "long", year: "numeric" },
    timeZone,
  );

  const isMonth = view === "month";

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader
          title={t("title")}
          description={t("intro")}
          action={
            <CreateDialog
              id="nueva-cita"
              triggerLabel={t("createTitle")}
              title={t("createTitle")}
              closeLabel={tc("close")}
              wide
            >
              <EventForm
                action={createCalendarEventAction}
                defaults={{ startDate: anchor, endDate: anchor }}
                users={users.map((user) => ({ id: user.id, name: user.name }))}
                submitLabel={t("createAction")}
              />
            </CreateDialog>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href({ view: "week" })}
              className={cn(
                buttonVariants({ variant: view === "week" ? "default" : "outline", size: "sm" }),
              )}
            >
              {t("week")}
            </Link>
            <Link
              href={href({ view: "month" })}
              className={cn(
                buttonVariants({ variant: isMonth ? "default" : "outline", size: "sm" }),
              )}
            >
              {t("month")}
            </Link>
          </div>
        </PageHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href={href({ date: range.previous })}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("previous")}
            </Link>
            <Link
              href={href({ date: range.today })}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("today")}
            </Link>
            <Link
              href={href({ date: range.next })}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("next")}
            </Link>
            <span className="ml-2 text-sm font-medium first-letter:uppercase">{monthLabel}</span>
          </div>

          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={anchor} />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("assignee")}
              <Select name="assignedUserId" defaultValue={assignedUserId ?? ""}>
                <option value="">{t("allAssignees")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="outline" size="sm">
              {t("filter")}
            </Button>
          </form>
        </div>

        {isMonth ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[46rem] grid-cols-7 gap-px rounded-md border bg-border">
              {range.days.slice(0, 7).map((day) => (
                <div
                  key={`head-${day}`}
                  className={cn(
                    "bg-card px-2 py-1 text-xs font-medium first-letter:uppercase",
                    isWeekend(day) && "text-muted-foreground",
                  )}
                >
                  {formatDate(startOfDay(day, timeZone), locale, { weekday: "short" }, timeZone)}
                </div>
              ))}

              {range.days.map((day) => {
                const dayEntries = buckets.get(day) ?? [];
                const isToday = day === range.today;
                const outsideMonth = day.slice(0, 7) !== anchor.slice(0, 7);

                return (
                  <div
                    key={day}
                    className={cn(
                      "flex min-h-24 flex-col gap-1 bg-card p-2",
                      // Weekends and days from the neighbouring month recede,
                      // so the month you asked for is the one you read first.
                      isWeekend(day) && "bg-muted/40",
                      outsideMonth && "bg-muted/60 text-muted-foreground",
                      isToday && "bg-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        isToday ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {formatDate(startOfDay(day, timeZone), locale, { day: "numeric" }, timeZone)}
                    </span>

                    {dayEntries.map((entry) => (
                      <Link
                        key={`${entry.kind}-${entry.id}-${day}`}
                        href={entry.href}
                        className={cn(
                          "rounded border px-1.5 py-1 text-xs leading-tight hover:bg-accent",
                          entry.kind === "task" && "border-dashed",
                          entry.done && "line-through opacity-60",
                        )}
                      >
                        <span className="block truncate font-medium">{entry.title}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {entry.allDay
                            ? t("allDay")
                            : formatTime(entry.startsAt, locale, timeZone)}
                          {entry.assignedUserId &&
                            ` · ${userNames.get(entry.assignedUserId) ?? ""}`}
                        </span>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // Week view: an hour rail on the left, like the day-planner shape
          // a rep already reads a calendar as — the small weekday
          // abbreviation the month grid gets away with isn't enough on its
          // own to say "this column is Tuesday" when every column is also
          // tall enough to hold a whole day's visits.
          <div className="overflow-x-auto">
            <div className="min-w-[50rem] rounded-md border bg-border">
              <div
                className="grid gap-px"
                style={{ gridTemplateColumns: WEEK_GRID_COLUMNS }}
              >
                <div className="bg-card" />
                {range.days.map((day) => {
                  const isToday = day === range.today;
                  return (
                    <div
                      key={`head-${day}`}
                      className={cn(
                        "flex flex-col items-center gap-0.5 bg-card px-2 py-2 text-xs",
                        isWeekend(day) && "text-muted-foreground",
                        isToday && "bg-accent/60",
                      )}
                    >
                      <span className="font-medium first-letter:uppercase">
                        {formatDate(
                          startOfDay(day, timeZone),
                          locale,
                          { weekday: "short" },
                          timeZone,
                        )}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          isToday
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatDate(
                          startOfDay(day, timeZone),
                          locale,
                          { day: "numeric" },
                          timeZone,
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              {range.days.some((day) => (buckets.get(day) ?? []).some((e) => e.allDay)) && (
                <div
                  className="grid gap-px border-t"
                  style={{ gridTemplateColumns: WEEK_GRID_COLUMNS }}
                >
                  <div className="bg-card px-1 py-1 text-right text-[10px] text-muted-foreground">
                    {t("allDay")}
                  </div>
                  {range.days.map((day) => {
                    const allDayEntries = (buckets.get(day) ?? []).filter((e) => e.allDay);
                    return (
                      <div
                        key={`allday-${day}`}
                        className={cn(
                          "flex flex-col gap-1 bg-card p-1",
                          isWeekend(day) && "bg-muted/40",
                          day === range.today && "bg-accent/30",
                        )}
                      >
                        {allDayEntries.map((entry) => (
                          <Link
                            key={`${entry.kind}-${entry.id}-${day}`}
                            href={entry.href}
                            className={cn(
                              "truncate rounded border px-1.5 py-0.5 text-[10px] leading-tight hover:bg-accent",
                              entry.kind === "task" && "border-dashed",
                              entry.done && "line-through opacity-60",
                            )}
                          >
                            {entry.title}
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                className="grid gap-px border-t"
                style={{ gridTemplateColumns: WEEK_GRID_COLUMNS }}
              >
                <div
                  className="relative bg-card"
                  style={{ height: `${weekHours.length * WEEK_GRID_HOUR_PX}px` }}
                >
                  {weekHours.map((hour, index) => (
                    <span
                      key={hour}
                      className="absolute inset-x-0 -translate-y-1/2 px-1 text-right text-[10px] whitespace-nowrap text-muted-foreground"
                      style={{ top: `${(index / weekHours.length) * 100}%` }}
                    >
                      {formatTime(
                        startOfDay(range.days[0], timeZone).getTime() + hour * 60 * 60 * 1000,
                        locale,
                        timeZone,
                      )}
                    </span>
                  ))}
                </div>

                {range.days.map((day) => {
                  const timedEntries = (buckets.get(day) ?? []).filter((e) => !e.allDay);
                  const isToday = day === range.today;

                  return (
                    <div
                      key={`col-${day}`}
                      className={cn(
                        "relative bg-card",
                        isWeekend(day) && "bg-muted/40",
                        isToday && "bg-accent/30",
                      )}
                      style={{ height: `${weekHours.length * WEEK_GRID_HOUR_PX}px` }}
                    >
                      {weekHours.map((hour, index) => (
                        <div
                          key={hour}
                          className="absolute inset-x-0 border-t border-border/60"
                          style={{ top: `${(index / weekHours.length) * 100}%` }}
                        />
                      ))}

                      {timedEntries.map((entry) => {
                        const { topPercent, heightPercent } = weekGridPosition(
                          entry,
                          day,
                          timeZone,
                        );
                        return (
                          <Link
                            key={`${entry.kind}-${entry.id}-${day}`}
                            href={entry.href}
                            className={cn(
                              "absolute inset-x-0.5 overflow-hidden rounded border bg-card px-1 py-0.5 text-[10px] leading-tight hover:bg-accent",
                              entry.kind === "task" && "border-dashed",
                              entry.done && "line-through opacity-60",
                            )}
                            style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}
                          >
                            <span className="block truncate font-medium">{entry.title}</span>
                            <span className="block truncate text-muted-foreground">
                              {formatTime(entry.startsAt, locale, timeZone)}
                              {entry.assignedUserId &&
                                ` · ${userNames.get(entry.assignedUserId) ?? ""}`}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            {t("emptyRange")}
          </p>
        )}
      </section>
    </div>
  );
}
