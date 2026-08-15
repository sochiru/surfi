import { useMemo } from "react";
import {
  eachMonthOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  AmountDisplay,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@wealthfolio/ui/components/ui/chart";
import { EmptyPlaceholder } from "@wealthfolio/ui/components/ui/empty-placeholder";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { DividendCalendarEvent } from "@/adapters";
import type { Holding } from "@/lib/types";

interface Props {
  events: DividendCalendarEvent[];
  holdings?: Holding[];
  isLoading?: boolean;
  /** Fallback / base currency for yield denominator. */
  fallbackCurrency?: string;
}

function amountNumber(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
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

function formatYieldPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}

export function DividendIncomeChart({
  events,
  holdings = [],
  isLoading,
  fallbackCurrency = "",
}: Props) {
  const posted = useMemo(
    () => events.filter((e) => e.kind === "posted"),
    [events],
  );

  const {
    ytd,
    ttm,
    ytdYield,
    ttmYield,
    marketValue,
    chartData,
    symbols,
    chartConfig,
    currency,
    mixedCurrencies,
  } = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const ttmStart = subMonths(now, 12);
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
    let ttmSum = 0;
    let ytdBase = 0;
    let ttmBase = 0;
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
      if (date >= ttmStart) {
        ttmSum += amount;
        ttmBase += baseAmount;
      }

      const mk = monthKey(event.date);
      if (!byMonthSymbol.has(mk)) byMonthSymbol.set(mk, new Map());
      const row = byMonthSymbol.get(mk)!;
      row.set(event.symbol, (row.get(event.symbol) ?? 0) + amount);
      symbolTotals.set(event.symbol, (symbolTotals.get(event.symbol) ?? 0) + amount);
    }

    const rangeStart = startOfMonth(ttmStart);
    const rangeEnd = endOfMonth(now);
    const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

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

    const config: ChartConfig = Object.fromEntries(
      seriesKeys.map((symbol, i) => [
        symbol,
        { label: symbol, color: `var(--chart-${(i % 9) + 1})` },
      ]),
    );

    const currencyList = [...currencies].filter(Boolean);
    const yieldDenom = investmentMv > 0 ? investmentMv : null;

    return {
      ytd: ytdSum,
      ttm: ttmSum,
      ytdYield: yieldDenom != null ? ytdBase / yieldDenom : null,
      ttmYield: yieldDenom != null ? ttmBase / yieldDenom : null,
      marketValue: investmentMv,
      chartData: trimmed,
      symbols: seriesKeys,
      chartConfig: config,
      currency: currencyList[0] ?? fallbackCurrency,
      mixedCurrencies: currencyList.length > 1,
    };
  }, [posted, holdings, fallbackCurrency]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dividend income</CardTitle>
          <CardDescription>Loading recorded dividends…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/40 h-64 animate-pulse rounded-md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Dividend income</CardTitle>
        <CardDescription>
          Cash dividends already recorded — monthly totals by ticker. Yield is 52-week/YTD cash ÷
          current investment market value
          {fallbackCurrency ? ` (${fallbackCurrency})` : ""}.
          {mixedCurrencies
            ? " Mixed dividend currencies are converted with holding FX when available."
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-muted-foreground text-xs">YTD · year to date</div>
            <div className="text-2xl font-semibold tabular-nums">
              <AmountDisplay value={ytd} currency={currency} />
            </div>
            <p className="text-muted-foreground text-xs">Jan 1 → today</p>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">52-week</div>
            <div className="text-2xl font-semibold tabular-nums">
              <AmountDisplay value={ttm} currency={currency} />
            </div>
            <p className="text-muted-foreground text-xs">Last 52 weeks</p>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">52-week yield</div>
            <div className="text-2xl font-semibold tabular-nums">{formatYieldPct(ttmYield)}</div>
            <p className="text-muted-foreground text-xs">
              vs{" "}
              {marketValue > 0 ? (
                <AmountDisplay value={marketValue} currency={fallbackCurrency || currency} />
              ) : (
                "—"
              )}{" "}
              invested
            </p>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">YTD yield</div>
            <div className="text-2xl font-semibold tabular-nums">{formatYieldPct(ytdYield)}</div>
            <p className="text-muted-foreground text-xs">Not annualized</p>
          </div>
        </div>

        {chartData.length === 0 || symbols.length === 0 ? (
          <EmptyPlaceholder
            title="No recorded dividends yet"
            description="Sync missing dividends or record DIVIDEND activities to populate this chart."
          />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
            <BarChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: string) => format(parseISO(`${value}-01`), "MMM yy")}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={48}
                tickFormatter={(value: number) =>
                  Math.abs(value) >= 1000
                    ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
                    : String(value)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      format(parseISO(`${String(value)}-01`), "MMMM yyyy")
                    }
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {symbols.map((symbol, i) => (
                <Bar
                  key={symbol}
                  dataKey={symbol}
                  stackId="dividends"
                  fill={`var(--chart-${(i % 9) + 1})`}
                  radius={i === symbols.length - 1 ? [3, 3, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
