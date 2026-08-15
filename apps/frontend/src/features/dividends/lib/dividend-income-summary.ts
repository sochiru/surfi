import {
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

export interface DividendIncomeSummary {
  ytd: number;
  week52: number;
  ytdYield: number | null;
  week52Yield: number | null;
  marketValue: number;
  chartData: Record<string, string | number>[];
  symbols: string[];
  chartConfig: ChartConfig;
  currency: string;
  mixedCurrencies: boolean;
}

export function amountNumber(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatYieldPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}

function monthKey(date: string): string {
  return format(startOfMonth(parseISO(date)), "yyyy-MM");
}

function isCashHolding(holding: Holding): boolean {
  return (
    holding.holdingType === "cash" ||
    holding.instrument?.id?.toLowerCase().startsWith("cash:") === true
  );
}

/** Build YTD / 52-week cash + yield and monthly stacked chart series from posted events. */
export function buildDividendIncomeSummary(
  events: DividendCalendarEvent[],
  holdings: Holding[],
  fallbackCurrency = "",
): DividendIncomeSummary {
  const posted = events.filter((e) => e.kind === "posted");
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const week52Start = subMonths(now, 12);
  const baseCurrency = (fallbackCurrency || "").toUpperCase();

  const fxBySymbol = new Map<string, number>();
  let investmentMv = 0;
  for (const holding of holdings) {
    if (isCashHolding(holding)) continue;
    const mv = amountNumber(holding.marketValue?.base ?? 0);
    if (mv > 0) investmentMv += mv;
    const symbol = holding.instrument?.symbol;
    const fx = amountNumber(holding.fxRate ?? 0);
    if (symbol && fx > 0 && !fxBySymbol.has(symbol)) {
      fxBySymbol.set(symbol, fx);
    }
  }

  const toBase = (amount: number, eventCurrency: string, symbol: string): number => {
    const ccy = (eventCurrency || baseCurrency).toUpperCase();
    if (!baseCurrency || ccy === baseCurrency) return amount;
    const fx = fxBySymbol.get(symbol);
    if (fx && fx > 0) return amount * fx;
    return amount;
  };

  let ytdSum = 0;
  let week52Sum = 0;
  let ytdBase = 0;
  let week52Base = 0;
  const currencies = new Set<string>();
  const byMonthSymbol = new Map<string, Map<string, number>>();
  const symbolTotals = new Map<string, number>();

  for (const event of posted) {
    const amount = amountNumber(event.displayAmount);
    if (amount === 0) continue;
    const date = parseISO(event.date);
    if (Number.isNaN(date.getTime())) continue;
    currencies.add(event.currency || fallbackCurrency || "?");
    const baseAmount = toBase(amount, event.currency, event.symbol);

    if (date >= yearStart) {
      ytdSum += amount;
      ytdBase += baseAmount;
    }
    if (date >= week52Start) {
      week52Sum += amount;
      week52Base += baseAmount;
    }

    const mk = monthKey(event.date);
    if (!byMonthSymbol.has(mk)) byMonthSymbol.set(mk, new Map());
    const row = byMonthSymbol.get(mk)!;
    row.set(event.symbol, (row.get(event.symbol) ?? 0) + amount);
    symbolTotals.set(event.symbol, (symbolTotals.get(event.symbol) ?? 0) + amount);
  }

  const months = eachMonthOfInterval({
    start: startOfMonth(week52Start),
    end: endOfMonth(now),
  });

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

  const firstActive = rows.findIndex((row) =>
    seriesKeys.some((symbol) => Number(row[symbol]) > 0),
  );
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
    ytdYield: yieldDenom != null ? ytdBase / yieldDenom : null,
    week52Yield: yieldDenom != null ? week52Base / yieldDenom : null,
    marketValue: investmentMv,
    chartData: trimmed,
    symbols: seriesKeys,
    chartConfig,
    currency: currencyList[0] ?? fallbackCurrency,
    mixedCurrencies: currencyList.length > 1,
  };
}
