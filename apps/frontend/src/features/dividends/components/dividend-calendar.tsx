import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui";
import type { DividendCalendarEvent } from "@/adapters";

interface Props {
  events: DividendCalendarEvent[];
  isLoading?: boolean;
}

const KIND_STYLES: Record<DividendCalendarEvent["kind"], string> = {
  posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  past_unposted: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  upcoming_estimated: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const DOT_STYLES: Record<DividendCalendarEvent["kind"], string> = {
  posted: "bg-emerald-500",
  past_unposted: "bg-sky-500",
  upcoming_estimated: "bg-amber-500",
};

function nearestEventMonth(events: DividendCalendarEvent[]): Date | null {
  if (events.length === 0) return null;
  const today = Date.now();
  let best = events[0]!;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const delta = Math.abs(parseISO(event.date).getTime() - today);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = event;
    }
  }
  return startOfMonth(parseISO(best.date));
}

function amountNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function DividendCalendar({ events, isLoading }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [didAutoJump, setDidAutoJump] = useState(false);

  useEffect(() => {
    if (didAutoJump || events.length === 0) return;
    const target = nearestEventMonth(events);
    if (target) {
      setCursor(target);
      setDidAutoJump(true);
    }
  }, [events, didAutoJump]);

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) }),
    [cursor],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, DividendCalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const monthEvents = useMemo(
    () => events.filter((e) => isSameMonth(parseISO(e.date), cursor)),
    [events, cursor],
  );

  const monthsWithEvents = useMemo(
    () => [...new Set(events.map((e) => e.date.slice(0, 7)))].sort(),
    [events],
  );

  const goToAdjacentEventMonth = (direction: 1 | -1) => {
    const current = format(cursor, "yyyy-MM");
    const candidates =
      direction === 1
        ? monthsWithEvents.filter((m) => m > current)
        : monthsWithEvents.filter((m) => m < current).reverse();
    const next = candidates[0];
    if (next) setCursor(startOfMonth(parseISO(`${next}-01`)));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-lg">{format(cursor, "MMMM yyyy")}</CardTitle>
          <p className="text-muted-foreground text-xs">
            {monthEvents.length > 0
              ? `${monthEvents.length} dividend event(s) this month`
              : "No dividend events this month"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCursor((d) => subMonths(d, 1))}>
            Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor((d) => addMonths(d, 1))}>
            Next
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${DOT_STYLES.posted}`} /> Recorded
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${DOT_STYLES.past_unposted}`} /> Past, not synced
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${DOT_STYLES.upcoming_estimated}`} /> Upcoming
            (est.)
          </span>
          {monthsWithEvents.length > 0 ? (
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => goToAdjacentEventMonth(-1)}>
                ← Previous with data
              </Button>
              <Button variant="ghost" size="sm" onClick={() => goToAdjacentEventMonth(1)}>
                Next with data →
              </Button>
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Loading dividend history…
          </p>
        ) : events.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No dividend history found. Enable dividend sync and ensure market data providers can
            return dividend events for your holdings.
          </p>
        ) : null}

        <div className="text-muted-foreground grid grid-cols-7 gap-1 text-center text-xs font-medium">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: days[0]?.getDay() ?? 0 }).map((_, i) => (
            <div key={`pad-${i}`} className="min-h-20 rounded-md border border-transparent" />
          ))}
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = byDate.get(key) ?? [];
            return (
              <div
                key={key}
                className="border-border/60 bg-card/40 min-h-20 rounded-md border p-1 text-left"
              >
                <div className="text-muted-foreground mb-1 text-[10px]">{format(day, "d")}</div>
                <div className="flex flex-col gap-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <Badge
                      key={ev.id}
                      variant="secondary"
                      className={`truncate text-[10px] ${KIND_STYLES[ev.kind]}`}
                      title={`${ev.accountName}: ${ev.symbol} ${amountNumber(ev.displayAmount).toFixed(2)} ${ev.currency}${ev.notes ? ` — ${ev.notes}` : ""}`}
                    >
                      {ev.symbol} · {ev.accountName.split(" ")[0]}{" "}
                      {amountNumber(ev.displayAmount).toFixed(0)}
                    </Badge>
                  ))}
                  {dayEvents.length > 3 ? (
                    <span className="text-muted-foreground text-[10px]">
                      +{dayEvents.length - 3}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
