import { addDays, format, parseISO } from "date-fns";
import type { DividendCalendarEvent } from "@/adapters";
import type { Holding } from "@/lib/types";
import type { DividendPeriodBounds } from "./dividend-filters";
import {
  amountNumber,
  convertDividendToBase,
  type DividendFxTable,
} from "./dividend-income-summary";

export type DividendEstimateSource = "announced" | "estimated";

const OPEN_PERIOD_START = "0000-01-01";
const UPCOMING_WINDOW_DAYS = 90;
const FORWARD_YEAR_DAYS = 365;
const TRAILING_YEAR_DAYS = 365;
const DOWN_THRESHOLD = -0.2;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The calendar marks cadence projections only through their id prefix
 * (`crates/core/src/dividends/sync.rs`); provider-announced payouts use `upcoming-`.
 */
export function dividendEstimateSource(event: DividendCalendarEvent): DividendEstimateSource {
  return event.id.startsWith("projected-") ? "estimated" : "announced";
}

function ymd(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Same month and day `years` earlier; Feb 29 falls back to Feb 28. */
function shiftYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) - years;
  const monthDay = date.slice(5);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${String(year).padStart(4, "0")}-${monthDay === "02-29" && !leap ? "02-28" : monthDay}`;
}

function change(current: number, previous: number): number | null {
  return previous > 0 ? current / previous - 1 : null;
}

interface Converter {
  convert: (event: DividendCalendarEvent) => number | null;
  unconverted: Set<string>;
}

function converter(fx: DividendFxTable): Converter {
  const unconverted = new Set<string>();
  return {
    unconverted,
    convert: (event) => {
      const amount = amountNumber(event.displayAmount);
      if (amount === 0) return null;
      const converted = convertDividendToBase(amount, event.currency, event.symbol, fx);
      if (converted == null) unconverted.add(event.currency?.trim() || "?");
      return converted;
    },
  };
}

export interface UpcomingDividendRow {
  id: string;
  date: string;
  symbol: string;
  accountName: string;
  amount: number;
  source: DividendEstimateSource;
}

export interface DividendYearOutlook {
  year: number;
  receivedYtd: number;
  expectedAnnounced: number;
  expectedEstimated: number;
  expectedCount: number;
  projected: number;
  lastYear: number;
  lastYearSameDates: number;
  /** Projected full year against last year's total. */
  changeVsLastYear: number | null;
  /** Received so far against the same dates last year. */
  changeSameDates: number | null;
  next90Days: UpcomingDividendRow[];
  unconvertedCurrencies: string[];
}

export function buildDividendYearOutlook(
  events: DividendCalendarEvent[],
  fx: DividendFxTable,
  now = new Date(),
): DividendYearOutlook {
  const { convert, unconverted } = converter(fx);
  const today = ymd(now);
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const lastYearStart = `${year - 1}-01-01`;
  const lastYearEnd = `${year - 1}-12-31`;
  const lastYearToday = shiftYears(today, 1);
  const windowEnd = ymd(addDays(now, UPCOMING_WINDOW_DAYS));

  let receivedYtd = 0;
  let lastYear = 0;
  let lastYearSameDates = 0;
  let expectedAnnounced = 0;
  let expectedEstimated = 0;
  let expectedCount = 0;
  const next90Days: UpcomingDividendRow[] = [];

  for (const event of events) {
    if (event.kind === "posted") {
      const inThisYear = event.date >= yearStart && event.date <= today;
      const inLastYear = event.date >= lastYearStart && event.date <= lastYearEnd;
      if (!inThisYear && !inLastYear) continue;
      const amount = convert(event);
      if (amount == null) continue;
      if (inThisYear) receivedYtd += amount;
      if (inLastYear) {
        lastYear += amount;
        if (event.date <= lastYearToday) lastYearSameDates += amount;
      }
      continue;
    }
    if (event.kind !== "upcoming_estimated" || event.date < today) continue;
    const inYear = event.date <= yearEnd;
    const inWindow = event.date <= windowEnd;
    if (!inYear && !inWindow) continue;
    const amount = convert(event);
    if (amount == null) continue;
    const source = dividendEstimateSource(event);
    if (inYear) {
      expectedCount += 1;
      if (source === "announced") expectedAnnounced += amount;
      else expectedEstimated += amount;
    }
    if (inWindow) {
      next90Days.push({
        id: event.id,
        date: event.date,
        symbol: event.symbol,
        accountName: event.accountName,
        amount,
        source,
      });
    }
  }

  next90Days.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const projected = receivedYtd + expectedAnnounced + expectedEstimated;

  return {
    year,
    receivedYtd,
    expectedAnnounced,
    expectedEstimated,
    expectedCount,
    projected,
    lastYear,
    lastYearSameDates,
    changeVsLastYear: change(projected, lastYear),
    changeSameDates: change(receivedYtd, lastYearSameDates),
    next90Days,
    unconvertedCurrencies: [...unconverted].sort(),
  };
}

export interface AnnualDividendIncome {
  year: string;
  received: number;
  /** Payouts still expected this year; zero for past years. */
  expected: number;
  /** Change from the previous year; the current year compares its projected total. */
  change: number | null;
}

export function buildAnnualDividendIncome(
  events: DividendCalendarEvent[],
  fx: DividendFxTable,
  now = new Date(),
): AnnualDividendIncome[] {
  const { convert } = converter(fx);
  const today = ymd(now);
  const year = now.getFullYear();
  const received = new Map<number, number>();
  let expected = 0;

  for (const event of events) {
    if (event.kind === "posted" && event.date <= today) {
      const amount = convert(event);
      if (amount == null) continue;
      const eventYear = Number(event.date.slice(0, 4));
      received.set(eventYear, (received.get(eventYear) ?? 0) + amount);
    } else if (
      event.kind === "upcoming_estimated" &&
      event.date >= today &&
      event.date <= `${year}-12-31`
    ) {
      expected += convert(event) ?? 0;
    }
  }

  const years = [...received.keys()];
  if (years.length === 0 && expected === 0) return [];
  const first = Math.min(year, ...years);
  const rows: AnnualDividendIncome[] = [];
  for (let y = first; y <= year; y += 1) {
    const total = (received.get(y) ?? 0) + (y === year ? expected : 0);
    rows.push({
      year: String(y),
      received: received.get(y) ?? 0,
      expected: y === year ? expected : 0,
      change: change(total, received.get(y - 1) ?? 0),
    });
  }
  return rows;
}

export type DividendPayerStatus = "new" | "down" | "stopped" | null;

export interface DividendPayerRow {
  symbol: string;
  accounts: string[];
  received: number;
  previous: number;
  /** Last 365 days of converted cash, the base for yield. */
  trailing: number;
  /** Announced and estimated payouts from today through the next 365 days. */
  expectedNextYear: number;
  marketValue: number;
  costBasis: number;
  /** Trailing cash ÷ current market value. */
  yieldOnValue: number | null;
  /** Trailing cash ÷ current cost basis. */
  yieldOnCost: number | null;
  /** Fraction of the period's converted income. */
  share: number;
  change: number | null;
  status: DividendPayerStatus;
  lastPaid: string | null;
  next: { date: string; amount: number; source: DividendEstimateSource } | null;
}

export interface DividendPayersSummary {
  rows: DividendPayerRow[];
  total: number;
  /** Comparison window, or null for an open-ended period. */
  previous: DividendPeriodBounds | null;
  topThreeShare: number;
}

/**
 * Compares with the same dates a year earlier, or the preceding years for longer periods,
 * so seasonal payers are measured against their own season.
 */
export function previousDividendPeriod(bounds: DividendPeriodBounds): DividendPeriodBounds | null {
  if (bounds.from <= OPEN_PERIOD_START) return null;
  const days = (parseISO(bounds.to).getTime() - parseISO(bounds.from).getTime()) / 86_400_000 + 1;
  const years = Math.max(1, Math.ceil(days / 366));
  const from = shiftYears(bounds.from, years);
  const shiftedTo = shiftYears(bounds.to, years);
  const dayBefore = ymd(addDays(parseISO(bounds.from), -1));
  return { from, to: shiftedTo >= bounds.from ? dayBefore : shiftedTo };
}

function symbolValues(
  holdings: Holding[],
): Map<string, { marketValue: number; costBasis: number }> {
  const values = new Map<string, { marketValue: number; costBasis: number }>();
  for (const holding of holdings) {
    if (
      holding.holdingType === "cash" ||
      holding.instrument?.id?.toLowerCase().startsWith("cash:") === true
    ) {
      continue;
    }
    const symbol = holding.instrument?.symbol?.trim().toUpperCase();
    if (!symbol) continue;
    const current = values.get(symbol) ?? { marketValue: 0, costBasis: 0 };
    const marketValue = amountNumber(holding.marketValue?.base ?? 0);
    const costBasis = amountNumber(holding.costBasis?.base ?? 0);
    if (marketValue > 0) current.marketValue += marketValue;
    if (costBasis > 0) current.costBasis += costBasis;
    values.set(symbol, current);
  }
  return values;
}

export function buildDividendPayers(
  events: DividendCalendarEvent[],
  fx: DividendFxTable,
  bounds: DividendPeriodBounds,
  now = new Date(),
  holdings: Holding[] = [],
): DividendPayersSummary {
  const { convert } = converter(fx);
  const today = ymd(now);
  const trailingStart = ymd(addDays(now, -TRAILING_YEAR_DAYS));
  const forwardEnd = ymd(addDays(now, FORWARD_YEAR_DAYS));
  const previous = previousDividendPeriod(bounds);
  const values = symbolValues(holdings);
  const bySymbol = new Map<
    string,
    Omit<
      DividendPayerRow,
      "share" | "change" | "status" | "marketValue" | "costBasis" | "yieldOnValue" | "yieldOnCost"
    >
  >();
  const rowFor = (symbol: string) => {
    let row = bySymbol.get(symbol);
    if (!row) {
      row = {
        symbol,
        accounts: [],
        received: 0,
        previous: 0,
        trailing: 0,
        expectedNextYear: 0,
        lastPaid: null,
        next: null,
      };
      bySymbol.set(symbol, row);
    }
    return row;
  };

  for (const event of events) {
    const symbol = event.symbol.trim();
    if (!symbol) continue;
    if (event.kind === "posted") {
      const inPeriod = event.date >= bounds.from && event.date <= bounds.to;
      const inPrevious = !!previous && event.date >= previous.from && event.date <= previous.to;
      const inTrailing = event.date >= trailingStart && event.date <= today;
      if (!inPeriod && !inPrevious && !inTrailing) continue;
      const amount = convert(event);
      if (amount == null) continue;
      const row = rowFor(symbol);
      if (inTrailing) row.trailing += amount;
      if (inPeriod) {
        row.received += amount;
        if (!row.lastPaid || event.date > row.lastPaid) row.lastPaid = event.date;
        const account = event.accountName || event.accountId;
        if (!row.accounts.includes(account)) row.accounts.push(account);
      } else if (inPrevious) {
        row.previous += amount;
      }
      continue;
    }
    if (event.kind !== "upcoming_estimated" || event.date < today) continue;
    const amount = convert(event);
    if (amount == null) continue;
    const row = rowFor(symbol);
    if (event.date <= forwardEnd) row.expectedNextYear += amount;
    if (!row.next || event.date < row.next.date) {
      row.next = { date: event.date, amount, source: dividendEstimateSource(event) };
    }
  }

  const all = [...bySymbol.values()].filter(
    (row) => row.received > 0 || row.previous > 0 || row.expectedNextYear > 0,
  );
  const total = all.reduce((sum, row) => sum + row.received, 0);
  const rows: DividendPayerRow[] = all
    .map((row) => {
      const rowChange = previous ? change(row.received, row.previous) : null;
      let status: DividendPayerStatus = null;
      if (previous && row.previous > 0 && row.received === 0) status = "stopped";
      else if (previous && row.previous === 0 && row.received > 0) status = "new";
      else if (rowChange != null && rowChange <= DOWN_THRESHOLD) status = "down";
      const value = values.get(row.symbol.toUpperCase());
      const marketValue = value?.marketValue ?? 0;
      const costBasis = value?.costBasis ?? 0;
      return {
        ...row,
        marketValue,
        costBasis,
        yieldOnValue: marketValue > 0 ? row.trailing / marketValue : null,
        yieldOnCost: costBasis > 0 ? row.trailing / costBasis : null,
        share: total > 0 ? row.received / total : 0,
        change: rowChange,
        status,
      };
    })
    .sort(
      (a, b) =>
        b.received - a.received ||
        b.expectedNextYear - a.expectedNextYear ||
        b.previous - a.previous,
    );

  const topThreeShare = rows.slice(0, 3).reduce((sum, row) => sum + row.share, 0);
  return { rows, total, previous, topThreeShare };
}

export interface DividendSectorSlice {
  id: string;
  name: string;
  amount: number;
  /** Share of received income, from 0 to 1. */
  share: number;
  /** Taxonomy color, when the sector itself has one. */
  color: string | null;
}

const UNCLASSIFIED_SECTOR_ID = "unclassified";

/**
 * Splits received dividend income across top-level sectors.
 * A holding assigned to several sectors contributes to each by its weight.
 * Income with no sector, or only a partial assignment, is Unclassified.
 */
export function buildDividendSectorIncome(
  rows: Pick<DividendPayerRow, "symbol" | "received">[],
  holdings: Holding[],
): DividendSectorSlice[] {
  const sectorsBySymbol = sectorWeightsBySymbol(holdings);
  const totals = new Map<string, { name: string; amount: number; color: string | null }>();
  let income = 0;

  for (const row of rows) {
    if (row.received <= 0) continue;
    income += row.received;
    const sectors = sectorsBySymbol.get(row.symbol.trim().toUpperCase()) ?? [];
    const weightSum = sectors.reduce((sum, sector) => sum + sector.weight, 0);
    const scale = weightSum > 100 ? 100 / weightSum : 1;
    let assigned = 0;
    for (const sector of sectors) {
      const portion = row.received * ((sector.weight * scale) / 100);
      if (portion <= 0) continue;
      assigned += portion;
      const current = totals.get(sector.id) ?? {
        name: sector.name,
        amount: 0,
        color: sector.color,
      };
      current.amount += portion;
      if (!current.color && sector.color) current.color = sector.color;
      totals.set(sector.id, current);
    }
    const leftover = row.received - assigned;
    if (leftover > 0.005) {
      const current = totals.get(UNCLASSIFIED_SECTOR_ID) ?? {
        name: "Unclassified",
        amount: 0,
        color: null,
      };
      current.amount += leftover;
      totals.set(UNCLASSIFIED_SECTOR_ID, current);
    }
  }

  if (income <= 0) return [];

  return [...totals.entries()]
    .map(([id, value]) => ({
      id,
      name: value.name,
      amount: value.amount,
      share: value.amount / income,
      color: value.color,
    }))
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

function sectorWeightsBySymbol(
  holdings: Holding[],
): Map<string, { id: string; name: string; weight: number; color: string | null }[]> {
  const map = new Map<
    string,
    { id: string; name: string; weight: number; color: string | null }[]
  >();
  for (const holding of holdings) {
    const symbol = holding.instrument?.symbol?.trim().toUpperCase();
    if (!symbol) continue;
    const sectors = holding.instrument?.classifications?.sectors ?? [];
    const existing = map.get(symbol);
    if (existing && existing.length > 0) continue;
    if (sectors.length === 0) {
      if (!existing) map.set(symbol, []);
      continue;
    }
    const rolled = new Map<
      string,
      { id: string; name: string; weight: number; color: string | null }
    >();
    for (const entry of sectors) {
      const id = entry.topLevelCategory?.id || entry.category.id;
      const name = entry.topLevelCategory?.name || entry.category.name;
      const isTopLevel = entry.category.id === id;
      const color = isTopLevel && entry.category.color ? entry.category.color : null;
      const current = rolled.get(id) ?? { id, name, weight: 0, color };
      current.weight += entry.weight;
      if (color) current.color = color;
      rolled.set(id, current);
    }
    map.set(symbol, [...rolled.values()]);
  }
  return map;
}

export interface DividendMonthRhythm {
  month: number;
  label: string;
  yearsWithIncome: number;
  years: number;
  /** Paid in fewer than half of the completed years. */
  quiet: boolean;
}

export interface DividendRhythm {
  years: number[];
  months: DividendMonthRhythm[];
}

/** Calendar months that stayed empty across completed years. Needs two full years. */
export function buildDividendRhythm(
  events: DividendCalendarEvent[],
  fx: DividendFxTable,
  now = new Date(),
): DividendRhythm | null {
  const { convert } = converter(fx);
  const currentYear = now.getFullYear();
  const paid = new Set<string>();
  const years = new Set<number>();

  for (const event of events) {
    if (event.kind !== "posted") continue;
    const eventYear = Number(event.date.slice(0, 4));
    if (!Number.isInteger(eventYear) || eventYear >= currentYear) continue;
    const amount = convert(event);
    if (amount == null || amount <= 0) continue;
    years.add(eventYear);
    paid.add(event.date.slice(0, 7));
  }

  const completed = [...years].sort((a, b) => a - b);
  if (completed.length < 2) return null;

  return {
    years: completed,
    months: MONTH_LABELS.map((label, index) => {
      const month = String(index + 1).padStart(2, "0");
      const yearsWithIncome = completed.filter((year) => paid.has(`${year}-${month}`)).length;
      return {
        month: index + 1,
        label,
        yearsWithIncome,
        years: completed.length,
        quiet: yearsWithIncome * 2 < completed.length,
      };
    }),
  };
}

export function countMissingDividendPayouts(events: DividendCalendarEvent[]): number {
  return events.filter((event) => event.kind === "past_unposted").length;
}
