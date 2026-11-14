import {
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import type { ChartConfig } from "@wealthfolio/ui/components/ui/chart";
import type { DividendCalendarEvent } from "@/adapters";
import type { Holding } from "@/lib/types";
import type { DividendGroupBy, DividendPeriodBounds } from "./dividend-filters";

export interface DividendIncomeSummary {
  ytd: number;
  week52: number;
  /** Posted cash inside the selected period. */
  received: number;
  monthlyAverage: number;
  payoutCount: number;
  payerCount: number;
  ytdYield: number | null;
  week52Yield: number | null;
  marketValue: number;
  chartData: Record<string, string | number>[];
  symbols: string[];
  chartConfig: ChartConfig;
  currency: string;
  mixedCurrencies: boolean;
  /** Event currencies omitted from the totals because no holding rate converts them. */
  unconvertedCurrencies: string[];
}

export function amountNumber(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatYieldPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}

export interface DividendFxTable {
  baseCurrency: string;
  /** Uppercase symbol → the holding's local currency and its rate into base. */
  bySymbol: Map<string, { currency: string; rate: number }>;
  /** Uppercase local currency → a rate into base from any holding in that currency. */
  byCurrency: Map<string, number>;
}

/**
 * Quote providers price some markets in minor units. Those codes are
 * case-sensitive (`GBp` is pence, `GBP` is pounds) and must not be folded
 * together, or a pence rate would shrink a pound payout by 100.
 */
const MINOR_UNIT_CURRENCIES: { key: string; matches: (code: string) => boolean }[] = [
  { key: "GBp", matches: (code) => code === "GBp" },
  { key: "GBX", matches: (code) => code.toUpperCase() === "GBX" },
  { key: "KWF", matches: (code) => code.toUpperCase() === "KWF" },
  { key: "ZAc", matches: (code) => code === "ZAc" || code.toUpperCase() === "ZAC" },
  { key: "ILA", matches: (code) => code.toUpperCase() === "ILA" },
  { key: "USX", matches: (code) => code.toUpperCase() === "USX" },
];

function canonicalCurrency(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return MINOR_UNIT_CURRENCIES.find((rule) => rule.matches(trimmed))?.key ?? trimmed.toUpperCase();
}

function isCashHolding(holding: Holding): boolean {
  return (
    holding.holdingType === "cash" ||
    holding.instrument?.id?.toLowerCase().startsWith("cash:") === true
  );
}

/** Rates that turn a dividend's own currency into the portfolio base currency. */
export function buildDividendFxTable(holdings: Holding[], baseCurrency: string): DividendFxTable {
  const bySymbol = new Map<string, { currency: string; rate: number }>();
  const byCurrency = new Map<string, number>();
  for (const holding of holdings) {
    const rate = amountNumber(holding.fxRate ?? 0);
    const local = canonicalCurrency(holding.localCurrency);
    if (rate <= 0 || !local) continue;
    if (!byCurrency.has(local)) byCurrency.set(local, rate);
    if (isCashHolding(holding)) continue;
    const symbol = holding.instrument?.symbol?.trim().toUpperCase();
    if (symbol && !bySymbol.has(symbol)) bySymbol.set(symbol, { currency: local, rate });
  }
  return { baseCurrency: canonicalCurrency(baseCurrency), bySymbol, byCurrency };
}

/**
 * Converts one payout into base currency.
 * A symbol rate applies only when the payout currency is that holding's currency,
 * so a pence quote (GBp) is not used for a pound (GBP) payout. Otherwise any
 * holding in the payout currency supplies the rate. Returns null when no rate exists.
 */
export function convertDividendToBase(
  amount: number,
  eventCurrency: string,
  symbol: string,
  fx: DividendFxTable,
): number | null {
  const currency = canonicalCurrency(eventCurrency) || fx.baseCurrency;
  if (!fx.baseCurrency || currency === fx.baseCurrency) return amount;
  const symbolRate = fx.bySymbol.get(symbol.trim().toUpperCase());
  if (symbolRate?.currency === currency) return amount * symbolRate.rate;
  const rate = fx.byCurrency.get(currency);
  return rate ? amount * rate : null;
}

function monthKey(date: string): string {
  return format(startOfMonth(parseISO(date)), "yyyy-MM");
}

const DAYS_PER_MONTH = 365.25 / 12;

function seriesKeyFor(event: DividendCalendarEvent, groupBy: DividendGroupBy): string {
  if (groupBy === "account") return event.accountName || event.accountId;
  if (groupBy === "total") return "Dividends";
  return event.symbol;
}

export interface DividendIncomeSummaryOptions {
  /** Limits the chart and period totals; defaults to the last 12 months. */
  bounds?: DividendPeriodBounds;
  groupBy?: DividendGroupBy;
  now?: Date;
}

/** Build YTD / 52-week cash + yield and monthly stacked chart series from posted events. */
export function buildDividendIncomeSummary(
  events: DividendCalendarEvent[],
  holdings: Holding[],
  fallbackCurrency = "",
  { bounds, groupBy = "ticker", now = new Date() }: DividendIncomeSummaryOptions = {},
): DividendIncomeSummary {
  const posted = events.filter((e) => e.kind === "posted");
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const week52Start = subMonths(now, 12);
  const period = bounds ?? {
    from: format(week52Start, "yyyy-MM-dd"),
    to: format(now, "yyyy-MM-dd"),
  };
  const fx = buildDividendFxTable(holdings, fallbackCurrency);
  const baseCurrency = fx.baseCurrency;

  let investmentMv = 0;
  for (const holding of holdings) {
    if (isCashHolding(holding)) continue;
    const mv = amountNumber(holding.marketValue?.base ?? 0);
    if (mv > 0) investmentMv += mv;
  }

  let ytdSum = 0;
  let week52Sum = 0;
  let received = 0;
  let payoutCount = 0;
  let firstDate: string | null = null;
  const payers = new Set<string>();
  const currencies = new Set<string>();
  const unconverted = new Set<string>();
  const byMonthSymbol = new Map<string, Map<string, number>>();
  const symbolTotals = new Map<string, number>();

  for (const event of posted) {
    const amount = amountNumber(event.displayAmount);
    if (amount === 0) continue;
    const date = parseISO(event.date);
    if (Number.isNaN(date.getTime())) continue;
    const inYtd = date >= yearStart;
    const inWeek52 = date >= week52Start;
    const inPeriod = event.date >= period.from && event.date <= period.to;
    if (!inYtd && !inWeek52 && !inPeriod) continue;

    currencies.add(canonicalCurrency(event.currency) || fallbackCurrency || "?");
    const baseAmount = convertDividendToBase(amount, event.currency, event.symbol, fx);
    if (baseAmount == null) {
      unconverted.add(canonicalCurrency(event.currency) || "?");
      continue;
    }

    if (inYtd) ytdSum += baseAmount;
    if (inWeek52) week52Sum += baseAmount;
    if (!inPeriod) continue;

    received += baseAmount;
    payoutCount += 1;
    payers.add(event.symbol);
    if (!firstDate || event.date < firstDate) firstDate = event.date;

    const key = seriesKeyFor(event, groupBy);
    const mk = monthKey(event.date);
    if (!byMonthSymbol.has(mk)) byMonthSymbol.set(mk, new Map());
    const row = byMonthSymbol.get(mk)!;
    row.set(key, (row.get(key) ?? 0) + baseAmount);
    symbolTotals.set(key, (symbolTotals.get(key) ?? 0) + baseAmount);
  }

  // An open-ended period starts at the first payout rather than the 1970 sentinel.
  const effectiveFrom = firstDate && firstDate > period.from ? firstDate : period.from;
  const months =
    firstDate === null
      ? []
      : eachMonthOfInterval({
          start: startOfMonth(parseISO(effectiveFrom)),
          end: endOfMonth(parseISO(period.to)),
        });
  const periodDays =
    firstDate === null
      ? 0
      : differenceInCalendarDays(parseISO(period.to), parseISO(effectiveFrom)) + 1;
  const periodMonths = Math.max(periodDays / DAYS_PER_MONTH, 1);

  const rankedSymbols = [...symbolTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([symbol]) => symbol);

  const top = rankedSymbols.slice(0, 8);
  const rest = new Set(rankedSymbols.slice(8));
  const seriesKeys = rest.size > 0 ? [...top, "Other"] : top;

  const rows = months.map((month) => {
    const key = format(month, "yyyy-MM");
    const point: Record<string, string | number> = { month: key };
    for (const symbol of seriesKeys) point[symbol] = 0;
    const monthMap = byMonthSymbol.get(key);
    if (monthMap) {
      for (const [symbol, amount] of monthMap) {
        const bucket = rest.has(symbol) ? "Other" : symbol;
        point[bucket] = (Number(point[bucket]) || 0) + amount;
      }
    }
    return point;
  });

  const firstActive = rows.findIndex((row) => seriesKeys.some((symbol) => Number(row[symbol]) > 0));
  const trimmed = firstActive === -1 ? [] : rows.slice(firstActive);

  const chartConfig: ChartConfig = Object.fromEntries(
    seriesKeys.map((symbol, i) => [
      symbol,
      { label: symbol, color: `var(--chart-${(i % 9) + 1})` },
    ]),
  );

  const currencyList = [...currencies].filter(Boolean);
  const yieldDenom = investmentMv > 0 ? investmentMv : null;

  return {
    ytd: ytdSum,
    week52: week52Sum,
    received,
    monthlyAverage: firstDate === null ? 0 : received / periodMonths,
    payoutCount,
    payerCount: payers.size,
    ytdYield: yieldDenom != null ? ytdSum / yieldDenom : null,
    week52Yield: yieldDenom != null ? week52Sum / yieldDenom : null,
    marketValue: investmentMv,
    chartData: trimmed,
    symbols: seriesKeys,
    chartConfig,
    currency: baseCurrency || currencyList[0] || fallbackCurrency,
    mixedCurrencies: currencyList.length > 1,
    unconvertedCurrencies: [...unconverted].sort(),
  };
}
