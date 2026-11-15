import { useEffect, useMemo, useState } from "react";
import { addMonths, format, isSameMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import type { DayProps } from "react-day-picker";
import {
  AmountDisplay,
  Badge,
  Button,
  Calendar,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PrivacyAmount,
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
import { TickerAvatar } from "@/components/ticker-avatar";
import { useIsMobileViewport } from "@/hooks";
import { cn } from "@/lib/utils";
import { nextMonthOccurrence } from "../lib/dividend-calendar";
import type { DividendRhythm, UpcomingDividendRow } from "../lib/dividend-outlook";
import { DividendSourceBadge } from "./dividend-year-outlook";

interface Props {
  events: DividendCalendarEvent[];
  upcoming: UpcomingDividendRow[];
  rhythm: DividendRhythm | null;
  currency: string;
  isLoading?: boolean;
}

const AGENDA_ROWS_SHOWN = 6;

const KIND_STYLES: Record<DividendCalendarEvent["kind"], string> = {
  posted: "bg-success-subtle text-success-subtle-foreground",
  past_unposted: "bg-info-subtle text-info-subtle-foreground",
  upcoming_estimated: "bg-warning-subtle text-warning-subtle-foreground",
};

const DOT_STYLES: Record<DividendCalendarEvent["kind"], string> = {
  posted: "bg-success",
  past_unposted: "bg-info",
  upcoming_estimated: "bg-warning",
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
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
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

function SeasonalityStrip({
  rhythm,
  selectedMonth,
  onSelect,
}: {
  rhythm: DividendRhythm;
  selectedMonth: number;
  onSelect: (monthIndex: number) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-12">
      {rhythm.months.map((entry, index) => {
        const selected = index === selectedMonth;
        return (
          <button
            key={entry.month}
            type="button"
            aria-pressed={selected}
            aria-label={`${entry.label}, paid in ${entry.yearsWithIncome} of ${entry.years} years`}
            onClick={() => onSelect(index)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-md px-0.5 py-1.5 text-xs transition-colors",
              selected ? "ring-ring ring-2 ring-inset" : "hover:bg-accent/40",
              entry.quiet ? "bg-muted/50" : "bg-chart-1/10",
            )}
          >
            <span className="font-medium">{entry.label}</span>
            <span aria-hidden className="flex flex-wrap justify-center gap-0.5">
              {Array.from({ length: entry.years }, (_, dot) => (
                <span
                  key={dot}
                  className={cn(
                    "size-1.5 rounded-full",
                    dot < entry.yearsWithIncome ? "bg-chart-1" : "bg-muted",
                  )}
                />
              ))}
            </span>
            {entry.quiet ? (
              <Badge
                variant="warning-subtle"
                className="h-auto w-full max-w-full shrink px-1 py-0 text-center text-[10px] leading-tight font-normal whitespace-normal"
              >
                <span className="lg:hidden">
                  {entry.yearsWithIncome}/{entry.years}
                </span>
                <span className="hidden lg:inline">
                  Quiet · {entry.yearsWithIncome}/{entry.years} yrs
                </span>
              </Badge>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function UpcomingAgenda({
  rows,
  title,
  currency,
  moreLabel,
}: {
  rows: UpcomingDividendRow[];
  title: string;
  currency: string;
  moreLabel: string | null;
}) {
  return (
    <div className="mt-4 min-w-0 border-t pt-4 lg:mt-0 lg:border-0 lg:pt-0">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No payouts expected in the next 90 days.</p>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <TickerAvatar symbol={row.symbol} className="size-7 shrink-0" />
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-semibold">
                    <bdi>{row.symbol}</bdi>
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {format(parseISO(row.date), "EEE, MMM d")} · <bdi>{row.accountName}</bdi>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-medium tabular-nums">
                  <PrivacyAmount value={row.amount} currency={currency} />
                </span>
                <DividendSourceBadge source={row.source} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {moreLabel ? <p className="text-muted-foreground pt-2 text-xs">{moreLabel}</p> : null}
    </div>
  );
}

export function DividendCalendar({ events, upcoming, rhythm, currency, isLoading }: Props) {
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
  const visibleQuiet = rhythm?.months[month.getMonth()]?.quiet === true && monthEventCount === 0;
  const monthKey = format(month, "yyyy-MM");
  const monthUpcoming = upcoming.filter((row) => row.date.startsWith(monthKey));
  const agendaShowsMonth = monthUpcoming.length > 0;
  const agendaSource = agendaShowsMonth ? monthUpcoming : upcoming;
  const agendaRows = agendaSource.slice(0, AGENDA_ROWS_SHOWN);
  const agendaMore = agendaSource.length - agendaRows.length;

  const DayCell = useMemo(() => {
    return function DayCell({ day, modifiers, className, ...tdProps }: DayProps) {
      const key = format(day.date, "yyyy-MM-dd");
      const dayEvents = byDate.get(key) ?? [];

      const dayNumber = (
        <span
          className={cn(
            "text-2xs flex size-5 shrink-0 items-center justify-center rounded-full tabular-nums",
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
              <span className="text-muted-foreground text-2xs tabular-nums">
                {dayEvents.length}
              </span>
            ) : null}
          </div>
          <div className="mt-1 hidden min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto sm:flex">
            {dayEvents.map((event) => (
              <span
                key={event.id}
                className={cn(
                  "text-2xs flex items-center gap-1 rounded px-1 py-0.5 leading-tight",
                  KIND_STYLES[event.kind],
                )}
              >
                <span className="truncate font-medium">{event.symbol}</span>
                <span className="ms-auto shrink-0 tabular-nums">
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
        "flex h-14 w-full flex-col rounded-md border p-1 text-start sm:h-24 sm:rounded-lg sm:p-1.5",
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
              <SheetTrigger render={trigger} />
              <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl">
                <SheetHeader className="text-start">
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
              <PopoverTrigger render={trigger} />
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
            {visibleQuiet ? (
              <p className="text-muted-foreground text-xs">
                Usually quiet. A monthly or quarterly payer would fill this gap.
              </p>
            ) : null}
          </div>
          <div className="grid w-full min-w-0 grid-cols-5 gap-1 sm:flex sm:w-auto sm:items-center">
            <Button
              variant="ghost"
              size="icon"
              className="w-full sm:w-9"
              disabled={!hasEarlier}
              onClick={() => goToAdjacentEventMonth(-1)}
              aria-label="Jump to previous month with dividends"
            >
              <Icons.ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-full sm:w-9"
              onClick={() => setMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
            >
              <Icons.ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full min-w-0 px-1 sm:w-auto sm:px-3"
              onClick={() => setMonth(startOfMonth(new Date()))}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-full sm:w-9"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <Icons.ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-full sm:w-9"
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
        {rhythm ? (
          <SeasonalityStrip
            rhythm={rhythm}
            selectedMonth={month.getMonth()}
            onSelect={(monthIndex) => setMonth(nextMonthOccurrence(monthIndex, new Date()))}
          />
        ) : null}
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
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6">
            <Calendar
              month={month}
              onMonthChange={setMonth}
              hideNavigation
              showOutsideDays
              className="w-full min-w-0 p-0"
              classNames={{
                root: "w-full",
                months: "w-full min-w-0",
                month: "flex w-full flex-col gap-2",
                month_caption: "hidden",
                month_grid: "w-full border-collapse",
                weekdays: "flex w-full gap-0.5 sm:gap-1",
                weekday:
                  "text-muted-foreground text-2xs min-w-0 flex-1 select-none py-1 text-center font-medium uppercase sm:text-xs sm:tracking-wide",
                week: "flex w-full gap-0.5 sm:gap-1 [&:not(:first-child)]:mt-0.5 sm:[&:not(:first-child)]:mt-1",
                day: "",
                today: "",
                outside: "",
              }}
              components={{ Day: DayCell }}
            />
            <UpcomingAgenda
              rows={agendaRows}
              title={agendaShowsMonth ? format(month, "MMMM yyyy") : "Next 90 days"}
              currency={currency}
              moreLabel={
                agendaMore > 0
                  ? `+${agendaMore} more${agendaShowsMonth ? "" : " in the next 90 days"}`
                  : null
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
