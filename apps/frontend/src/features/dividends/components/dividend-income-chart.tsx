import { useMemo, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import {
  AmountDisplay,
  AnimatedToggleGroup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui";
import { Alert, AlertDescription } from "@wealthfolio/ui/components/ui/alert";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
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
import { useIsMobileViewport } from "@/hooks";
import type { Holding } from "@/lib/types";
import type { DividendGroupBy, DividendPeriodBounds } from "../lib/dividend-filters";
import { buildDividendIncomeSummary, formatYieldPct } from "../lib/dividend-income-summary";

export function UnconvertedDividendNotice({
  currencies,
  baseCurrency,
}: {
  currencies: string[];
  baseCurrency: string;
}) {
  const { t, i18n } = useTranslation();
  if (currencies.length === 0 || !baseCurrency) return null;
  return (
    <Alert variant="warning">
      <Icons.AlertTriangle />
      <AlertDescription>
        {t("income:unconverted_currencies", {
          count: currencies.length,
          currencies: new Intl.ListFormat(i18n.language).format(currencies),
          baseCurrency,
        })}
      </AlertDescription>
    </Alert>
  );
}

const GROUP_BY_ITEMS: { value: DividendGroupBy; label: string }[] = [
  { value: "ticker", label: "Ticker" },
  { value: "account", label: "Account" },
  { value: "total", label: "Total" },
];

interface Props {
  events: DividendCalendarEvent[];
  holdings?: Holding[];
  isLoading?: boolean;
  /** Fallback / base currency for yield denominator. */
  fallbackCurrency?: string;
  /** Denser layout for Insights Overview. */
  compact?: boolean;
  /** Optional header action (e.g. link to dividend insights). */
  headerAction?: ReactNode;
  /** Selected period; the full layout shows totals for it. Defaults to the last 12 months. */
  bounds?: DividendPeriodBounds;
  groupBy?: DividendGroupBy;
  onGroupByChange?: (groupBy: DividendGroupBy) => void;
}

export function DividendIncomeChart({
  events,
  holdings = [],
  isLoading,
  fallbackCurrency = "",
  compact = false,
  headerAction,
  bounds,
  groupBy = "ticker",
  onGroupByChange,
}: Props) {
  const isMobile = useIsMobileViewport();
  const summary = useMemo(
    () => buildDividendIncomeSummary(events, holdings, fallbackCurrency, { bounds, groupBy }),
    [events, holdings, fallbackCurrency, bounds, groupBy],
  );

  const {
    ytd,
    week52,
    received,
    monthlyAverage,
    payoutCount,
    payerCount,
    ytdYield,
    week52Yield,
    marketValue,
    chartData,
    symbols,
    chartConfig,
    currency,
    mixedCurrencies,
    unconvertedCurrencies,
  } = summary;
  const groupLabel = groupBy === "account" ? "account" : groupBy === "total" ? null : "ticker";

  if (isLoading) {
    return (
      <Card>
        <CardHeader className={compact ? "px-4 pb-2 sm:px-6" : "px-4 sm:px-6"}>
          <CardTitle className={compact ? "text-base" : "text-lg"}>Dividend income</CardTitle>
          <CardDescription>Loading recorded dividends…</CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
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
            ? "flex flex-row items-start justify-between space-y-0 px-4 pb-2 sm:px-6"
            : "flex min-w-0 flex-col gap-3 space-y-0 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
        }
      >
        <div className="min-w-0 space-y-1">
          <CardTitle className={compact ? "text-base" : "text-lg"}>Dividend income</CardTitle>
          <CardDescription className={compact ? "text-xs" : undefined}>
            {compact
              ? "Cash received from holdings — 52-week and year to date."
              : "Recorded cash dividends and yield from your current holdings."}
            {!compact ? (
              <span className="hidden sm:inline">
                {`${groupLabel ? ` Monthly totals are grouped by ${groupLabel}.` : ""} Yield is 52-week cash ÷ current investment market value${
                  fallbackCurrency ? ` (${fallbackCurrency})` : ""
                }.${
                  mixedCurrencies
                    ? " Mixed dividend currencies are converted with holding FX when available."
                    : ""
                }`}
              </span>
            ) : null}
          </CardDescription>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        {!compact && onGroupByChange ? (
          <div className="max-w-full shrink-0" data-no-swipe-drag>
            <AnimatedToggleGroup
              variant="secondary"
              size={isMobile ? "xs" : "sm"}
              items={GROUP_BY_ITEMS}
              value={groupBy}
              onValueChange={onGroupByChange}
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent
        className={compact ? "space-y-4 px-4 sm:px-6" : "space-y-5 px-4 sm:space-y-6 sm:px-6"}
      >
        <UnconvertedDividendNotice currencies={unconvertedCurrencies} baseCurrency={currency} />
        {compact ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground text-xs">YTD · year to date</div>
              <div className="text-lg font-semibold tabular-nums">
                <AmountDisplay value={ytd} currency={currency} />
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">52-week</div>
              <div className="text-lg font-semibold tabular-nums">
                <AmountDisplay value={week52} currency={currency} />
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">52-week yield</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatYieldPct(week52Yield)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">YTD yield</div>
              <div className="text-lg font-semibold tabular-nums">{formatYieldPct(ytdYield)}</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-4">
            <div>
              <div className="text-muted-foreground text-xs">Received</div>
              <div className="text-2xl font-semibold tabular-nums">
                <AmountDisplay value={received} currency={currency} />
              </div>
              <p className="text-muted-foreground text-xs">In selected period</p>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Monthly average</div>
              <div className="text-2xl font-semibold tabular-nums">
                <AmountDisplay value={monthlyAverage} currency={currency} />
              </div>
              <p className="text-muted-foreground text-xs">Received ÷ months in period</p>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Payouts</div>
              <div className="text-2xl font-semibold tabular-nums">{payoutCount}</div>
              <p className="text-muted-foreground text-xs">
                From {payerCount} holding{payerCount === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">52-week yield</div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatYieldPct(week52Yield)}
              </div>
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
          </div>
        )}

        {chartData.length === 0 || symbols.length === 0 ? (
          <EmptyPlaceholder
            title={bounds ? "No dividends in this period" : "No recorded dividends yet"}
            description={
              bounds
                ? "Choose a longer period, or sync missing dividends."
                : "Sync missing dividends or record DIVIDEND activities to populate this chart."
            }
          />
        ) : (
          <ChartContainer
            config={chartConfig}
            className={`aspect-auto w-full ${compact ? "h-44" : "h-60 sm:h-72"}`}
          >
            <BarChart
              data={chartData}
              margin={{ left: isMobile ? 0 : 8, right: isMobile ? 0 : 8, top: 8, bottom: 0 }}
            >
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
                width={compact || isMobile ? 36 : 48}
                tickFormatter={(value: number) =>
                  Math.abs(value) >= 1000
                    ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
                    : String(value)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label: unknown) =>
                      typeof label === "string" ? format(parseISO(`${label}-01`), "MMMM yyyy") : ""
                    }
                  />
                }
              />
              {!compact && !isMobile ? <ChartLegend content={<ChartLegendContent />} /> : null}
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
