import { useEffect, useMemo, useState } from "react";
import { addMonths, format, isSameMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import type { DayProps } from "react-day-picker";
import {
  AmountDisplay,
  Button,
  Calendar,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@wealthfolio/ui";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@wealthfolio/ui/components/ui/sheet";
import { EmptyPlaceholder } from "@wealthfolio/ui/components/ui/empty-placeholder";
import type { DividendCalendarEvent } from "@/adapters";
import { useIsMobileViewport } from "@/hooks";
import { cn } from "@/lib/utils";

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

const KIND_LABELS: Record<DividendCalendarEvent["kind"], string> = {
  posted: "Recorded",
  past_unposted: "Past, not synced",
  upcoming_estimated: "Upcoming (est.)",
};

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function amountNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

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

function DayEvents({ events }: { events: DividendCalendarEvent[] }) {
  const byAccount = useMemo(() => {
    const map = new Map<string, DividendCalendarEvent[]>();
    for (const event of events) {
      const list = map.get(event.accountName) ?? [];
      list.push(event);
      map.set(event.accountName, list);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <div className="space-y-3">
      {byAccount.map(([accountName, accountEvents]) => (
        <div key={accountName} className="space-y-1">
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {accountName}
          </div>
          {accountEvents.map((event) => (
            <div key={event.id} className="flex items-start gap-2 text-sm">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_STYLES[event.kind])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{event.symbol}</span>
                  <span className="shrink-0 tabular-nums">
                    <AmountDisplay
                      value={amountNumber(event.displayAmount)}
                      currency={event.currency}
                    />
                  </span>
                </div>
                <div className="text-muted-foreground text-xs">
                  {KIND_LABELS[event.kind]}
                  {event.notes ? ` — ${event.notes}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DividendCalendar({ events, isLoading }: Props) {
  const isMobile = useIsMobileViewport();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [didAutoJump, setDidAutoJump] = useState(false);

  useEffect(() => {
    if (didAutoJump || events.length === 0) return;
    const target = nearestEventMonth(events);
    if (target) {
      setMonth(target);
      setDidAutoJump(true);
    }
  }, [events, didAutoJump]);

  const byDate = useMemo(() => {
    const map = new Map<string, DividendCalendarEvent[]>();
    for (const event of events) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => a.accountName.localeCompare(b.accountName) || a.symbol.localeCompare(b.symbol),
      );
    }
    return map;
  }, [events]);

  const monthEventCount = useMemo(
    () => events.filter((e) => isSameMonth(parseISO(e.date), month)).length,
    [events, month],
  );

  const monthsWithEvents = useMemo(
    () => [...new Set(events.map((e) => e.date.slice(0, 7)))].sort(),
    [events],
  );

  const goToAdjacentEventMonth = (direction: 1 | -1) => {
    const current = format(month, "yyyy-MM");
    const candidates =
      direction === 1
        ? monthsWithEvents.filter((m) => m > current)
        : monthsWithEvents.filter((m) => m < current).reverse();
    const next = candidates[0];
    if (next) setMonth(startOfMonth(parseISO(`${next}-01`)));
  };

  const hasEarlier = monthsWithEvents.some((m) => m < format(month, "yyyy-MM"));
  const hasLater = monthsWithEvents.some((m) => m > format(month, "yyyy-MM"));

  const DayCell = useMemo(() => {
    return function DayCell({ day, modifiers, className, ...tdProps }: DayProps) {
      const key = format(day.date, "yyyy-MM-dd");
      const dayEvents = byDate.get(key) ?? [];

      const dayNumber = (
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums",
            modifiers.today && "bg-primary text-primary-foreground font-semibold",
            modifiers.outside && "text-muted-foreground/50",
          )}
        >
          {day.date.getDate()}
        </span>
      );

      const body = (
        <>
          <div className="flex items-center justify-between gap-1">
            {dayNumber}
            {dayEvents.length > 1 ? (
              <span className="text-muted-foreground text-[10px] tabular-nums">
                {dayEvents.length}
              </span>
            ) : null}
          </div>
          <div className="mt-1 hidden min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto sm:flex">
            {dayEvents.map((event) => (
              <span
                key={event.id}
                className={cn(
                  "flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight",
                  KIND_STYLES[event.kind],
                )}
              >
                <span className="truncate font-medium">{event.symbol}</span>
                <span className="ml-auto shrink-0 tabular-nums">
                  {compactFormatter.format(amountNumber(event.displayAmount))}
                </span>
              </span>
            ))}
          </div>
          <div className="mt-1 flex min-h-0 flex-1 flex-wrap content-start gap-0.5 overflow-y-auto sm:hidden">
            {dayEvents.map((event) => (
              <span
                key={event.id}
                className={cn("size-1.5 rounded-full", DOT_STYLES[event.kind])}
              />
            ))}
          </div>
        </>
      );

      const cellClass = cn(
        "flex h-14 w-full flex-col rounded-md border p-1 text-left sm:h-24 sm:rounded-lg sm:p-1.5",
        modifiers.outside ? "border-transparent" : "border-border/60 bg-card/40",
      );

      const trigger = (
        <button
          type="button"
          className={cn(
            cellClass,
            "hover:border-border hover:bg-accent/40 focus-visible:ring-ring cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2",
          )}
          aria-label={`${dayEvents.length} dividend event(s) on ${format(day.date, "PPP")}`}
        >
          {body}
        </button>
      );

      return (
        <td className={cn("min-w-0 flex-1 p-0 align-top", className)} {...tdProps}>
          {dayEvents.length === 0 ? (
            <div className={cellClass}>{body}</div>
          ) : isMobile ? (
            <Sheet>
              <SheetTrigger asChild>{trigger}</SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl">
                <SheetHeader className="text-left">
                  <SheetTitle>{format(day.date, "EEEE, PPP")}</SheetTitle>
                  <SheetDescription>
                    {dayEvents.length} dividend event{dayEvents.length === 1 ? "" : "s"}
                  </SheetDescription>
                </SheetHeader>
                <div className="pb-safe">
                  <DayEvents events={dayEvents} />
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Popover>
              <PopoverTrigger asChild>{trigger}</PopoverTrigger>
              <PopoverContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
                <div className="mb-2 text-sm font-semibold">{format(day.date, "EEEE, PPP")}</div>
                <DayEvents events={dayEvents} />
              </PopoverContent>
            </Popover>
          )}
        </td>
      );
    };
  }, [byDate, isMobile]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 px-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">Dividend calendar</CardTitle>
            <CardDescription>
              {monthEventCount > 0
                ? `${monthEventCount} dividend event${monthEventCount === 1 ? "" : "s"} in ${format(month, "MMMM yyyy")}`
                : `No dividend events in ${format(month, "MMMM yyyy")}`}
            </CardDescription>
          </div>
          <div className="grid w-full grid-cols-5 gap-1 sm:flex sm:w-auto sm:items-center">
            <Button
              variant="ghost"
              size="icon"
              disabled={!hasEarlier}
              onClick={() => goToAdjacentEventMonth(-1)}
              aria-label="Jump to previous month with dividends"
            >
              <Icons.ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
            >
              <Icons.ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <Icons.ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!hasLater}
              onClick={() => goToAdjacentEventMonth(1)}
              aria-label="Jump to next month with dividends"
            >
              <Icons.ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {(Object.keys(KIND_LABELS) as DividendCalendarEvent["kind"][]).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", DOT_STYLES[kind])} />
              {KIND_LABELS[kind]}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {isLoading ? (
          <Skeleton className="h-[28rem] w-full" />
        ) : events.length === 0 ? (
          <EmptyPlaceholder
            title="No dividend history found"
            description="Enable dividend sync in Settings and make sure your market data providers return dividend events for your holdings."
          />
        ) : (
          <Calendar
            month={month}
            onMonthChange={setMonth}
            hideNavigation
            showOutsideDays
            className="w-full p-0"
            classNames={{
              root: "w-full",
              months: "w-full min-w-0",
              month: "flex w-full flex-col gap-2",
              month_caption: "hidden",
              month_grid: "w-full border-collapse",
              weekdays: "flex w-full gap-0.5 sm:gap-1",
              weekday:
                "text-muted-foreground min-w-0 flex-1 select-none py-1 text-center text-[10px] font-medium uppercase sm:text-xs sm:tracking-wide",
              week: "flex w-full gap-0.5 sm:gap-1 [&:not(:first-child)]:mt-0.5 sm:[&:not(:first-child)]:mt-1",
              day: "",
              today: "",
              outside: "",
            }}
            components={{ Day: DayCell }}
          />
        )}
      </CardContent>
    </Card>
  );
}
