import { useMemo, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
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
} from "@wealthfolio/ui/components/ui/chart";
import { EmptyPlaceholder } from "@wealthfolio/ui/components/ui/empty-placeholder";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { DividendCalendarEvent } from "@/adapters";
import type { Holding } from "@/lib/types";
import {
  buildDividendIncomeSummary,
  formatYieldPct,
} from "../lib/dividend-income-summary";

interface Props {
  events: DividendCalendarEvent[];
  holdings?: Holding[];
  isLoading?: boolean;
  /** Fallback / base currency for yield denominator. */
  fallbackCurrency?: string;
  /** Denser layout for Insights Overview. */
  compact?: boolean;
  /** Optional header action (e.g. link to /dividends). */
  headerAction?: ReactNode;
}

export function DividendIncomeChart({
  events,
  holdings = [],
  isLoading,
  fallbackCurrency = "",
  compact = false,
  headerAction,
}: Props) {
  const summary = useMemo(
    () => buildDividendIncomeSummary(events, holdings, fallbackCurrency),
    [events, holdings, fallbackCurrency],
  );

  const {
    ytd,
    week52,
    ytdYield,
    week52Yield,
    marketValue,
    chartData,
    symbols,
    chartConfig,
    currency,
    mixedCurrencies,
  } = summary;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className={compact ? "pb-2" : undefined}>
          <CardTitle className={compact ? "text-base" : "text-lg"}>Dividend income</CardTitle>
          <CardDescription>Loading recorded dividends…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={`bg-muted/40 animate-pulse rounded-md ${compact ? "h-40" : "h-64"}`} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        className={
          compact
            ? "flex flex-row items-start justify-between space-y-0 pb-2"
            : undefined
        }
      >
        <div className="min-w-0 space-y-1">
          <CardTitle className={compact ? "text-base" : "text-lg"}>Dividend income</CardTitle>
          <CardDescription className={compact ? "text-xs" : undefined}>
            {compact
              ? "Cash received from holdings — 52-week and year to date."
              : `Cash dividends already recorded — monthly totals by ticker. Yield is 52-week/YTD cash ÷ current investment market value${
                  fallbackCurrency ? ` (${fallbackCurrency})` : ""
                }.${
                  mixedCurrencies
                    ? " Mixed dividend currencies are converted with holding FX when available."
                    : ""
                }`}
          </CardDescription>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </CardHeader>
      <CardContent className={compact ? "space-y-4" : "space-y-6"}>
        <div
          className={
            compact
              ? "grid grid-cols-2 gap-3 sm:grid-cols-4"
              : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          }
        >
          <div>
            <div className="text-muted-foreground text-xs">YTD · year to date</div>
            <div
              className={`font-semibold tabular-nums ${compact ? "text-lg" : "text-2xl"}`}
            >
              <AmountDisplay value={ytd} currency={currency} />
            </div>
            {!compact ? <p className="text-muted-foreground text-xs">Jan 1 → today</p> : null}
          </div>
          <div>
            <div className="text-muted-foreground text-xs">52-week</div>
            <div
              className={`font-semibold tabular-nums ${compact ? "text-lg" : "text-2xl"}`}
            >
              <AmountDisplay value={week52} currency={currency} />
            </div>
            {!compact ? <p className="text-muted-foreground text-xs">Last 52 weeks</p> : null}
          </div>
          <div>
            <div className="text-muted-foreground text-xs">52-week yield</div>
            <div
              className={`font-semibold tabular-nums ${compact ? "text-lg" : "text-2xl"}`}
            >
              {formatYieldPct(week52Yield)}
            </div>
            {!compact ? (
              <p className="text-muted-foreground text-xs">
                vs{" "}
                {marketValue > 0 ? (
                  <AmountDisplay value={marketValue} currency={fallbackCurrency || currency} />
                ) : (
                  "—"
                )}{" "}
                invested
              </p>
            ) : null}
          </div>
          <div>
            <div className="text-muted-foreground text-xs">YTD yield</div>
            <div
              className={`font-semibold tabular-nums ${compact ? "text-lg" : "text-2xl"}`}
            >
              {formatYieldPct(ytdYield)}
            </div>
            {!compact ? <p className="text-muted-foreground text-xs">Not annualized</p> : null}
          </div>
        </div>

        {chartData.length === 0 || symbols.length === 0 ? (
          <EmptyPlaceholder
            title="No recorded dividends yet"
            description="Sync missing dividends or record DIVIDEND activities to populate this chart."
          />
        ) : (
          <ChartContainer
            config={chartConfig}
            className={`aspect-auto w-full ${compact ? "h-44" : "h-72"}`}
          >
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
                width={compact ? 36 : 48}
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
              {!compact ? <ChartLegend content={<ChartLegendContent />} /> : null}
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
