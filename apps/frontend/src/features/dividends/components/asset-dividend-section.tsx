import { useMemo } from "react";
import { getAssetDividendView, getAssetHoldings, type DividendCalendarEvent } from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";
import { useSettingsContext } from "@/lib/settings-provider";
import {
  AmountDisplay,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@wealthfolio/ui";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@wealthfolio/ui/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { amountNumber } from "@/features/dividends/lib/dividend-income-summary";

interface Props {
  assetId: string;
  /** When set, income totals / yield MV are limited to this account. */
  accountId?: string | null;
}

interface IncomeTotals {
  ytd: number;
  ttm: number;
  projectedYearEnd: number;
  upcomingRemaining: number;
  nextUpcoming: DividendCalendarEvent | null;
}

function formatYieldPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}

function parseEventDate(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildIncomeTotals(events: DividendCalendarEvent[]): IncomeTotals {
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const ttmStart = new Date(now);
  ttmStart.setDate(ttmStart.getDate() - 365);

  let ytd = 0;
  let ttm = 0;
  let upcomingRemaining = 0;
  let nextUpcoming: DividendCalendarEvent | null = null;

  for (const event of events) {
    const amount = amountNumber(event.displayAmount);
    if (amount === 0) continue;
    const date = parseEventDate(event.date);
    if (!date) continue;

    if (event.kind === "posted") {
      if (date >= yearStart) ytd += amount;
      if (date >= ttmStart) ttm += amount;
      continue;
    }

    if (event.kind !== "upcoming_estimated") continue;
    if (date.getFullYear() !== year || date < now) continue;

    upcomingRemaining += amount;
    if (
      !nextUpcoming ||
      (parseEventDate(nextUpcoming.date)?.getTime() ?? Infinity) > date.getTime()
    ) {
      nextUpcoming = event;
    }
  }

  return {
    ytd,
    ttm,
    projectedYearEnd: ytd + upcomingRemaining,
    upcomingRemaining,
    nextUpcoming,
  };
}

function LabelWithInfo({ label, tip }: { label: string; tip: string }) {
  return (
    <div className="text-muted-foreground flex items-center gap-1 text-xs">
      <span>{label}</span>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex"
              aria-label={tip}
            >
              <Icons.Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-left">
            <p>{tip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function AssetDividendSection({ assetId, accountId = null }: Props) {
  const { settings } = useSettingsContext();
  const viewQuery = useQuery({
    queryKey: [QueryKeys.ASSET_DIVIDENDS, assetId],
    queryFn: () => getAssetDividendView(assetId),
    staleTime: 5 * 60 * 1000,
  });

  const holdingsQuery = useQuery({
    queryKey: [QueryKeys.ASSET_HOLDINGS, assetId],
    queryFn: () => getAssetHoldings(assetId),
  });

  const view = viewQuery.data;
  const incomeCurrency = view?.currency ?? settings?.baseCurrency ?? "";

  const metrics = useMemo(() => {
    const holdings = (holdingsQuery.data ?? []).filter(
      (h) => !accountId || h.accountId === accountId,
    );
    const events = (view?.events ?? []).filter((e) => !accountId || e.accountId === accountId);
    const totals = buildIncomeTotals(events);

    // Prefer view totals when unscoped so we stay consistent with the server rollup.
    const ytd = accountId ? totals.ytd : amountNumber(view?.ytdIncome ?? totals.ytd);
    const ttm = accountId ? totals.ttm : amountNumber(view?.ttmIncome ?? totals.ttm);

    const mv = holdings.reduce((sum, h) => sum + amountNumber(h.marketValue?.local ?? 0), 0);
    const cost = holdings.reduce((sum, h) => sum + amountNumber(h.costBasis?.local ?? 0), 0);
    const quantity = holdings.reduce((sum, h) => sum + amountNumber(h.quantity), 0);
    const price = holdings.find((h) => amountNumber(h.price ?? 0) > 0)?.price ?? null;
    const priceNum = price != null ? amountNumber(price) : 0;

    // Trailing cash ÷ current MV (holding yield). Same as (TTM DPS ÷ price) only if
    // share count was constant over the trailing year.
    const ttmYieldOnMv = mv > 0 ? ttm / mv : null;
    const ytdYieldOnMv = mv > 0 ? ytd / mv : null;
    const ttmYieldOnCost = cost > 0 ? ttm / cost : null;

    // Classic quote yield proxy: annualized DPS / last price, using TTM cash / shares as DPS.
    const trailingDps = quantity > 0 ? ttm / quantity : null;
    const quoteYield = trailingDps != null && priceNum > 0 ? trailingDps / priceNum : null;

    const projected = totals.projectedYearEnd;
    const projectedYieldOnMv = mv > 0 ? projected / mv : null;

    return {
      marketValue: mv,
      quantity,
      price: priceNum,
      ytd,
      ttm,
      trailingDps,
      ytdYieldOnMv,
      ttmYieldOnMv,
      ttmYieldOnCost,
      quoteYield,
      projectedYearEnd: projected,
      upcomingRemaining: totals.upcomingRemaining,
      projectedYieldOnMv,
      nextUpcoming: totals.nextUpcoming,
    };
  }, [holdingsQuery.data, accountId, view?.events, view?.ttmIncome, view?.ytdIncome]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-lg">Dividends</CardTitle>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8 px-2 text-xs"
        >
          <Link to="/dividends">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {viewQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <LabelWithInfo
                  label="YTD received"
                  tip="Cash dividends posted this calendar year (after your recorded tax if any)."
                />
                <div className="text-lg font-semibold">
                  <AmountDisplay value={metrics.ytd} currency={incomeCurrency} />
                </div>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {formatYieldPct(metrics.ytdYieldOnMv)} of market value
                </p>
              </div>
              <div>
                <LabelWithInfo
                  label="52-week received"
                  tip="Cash dividends posted in the last 365 days ÷ current market value of this holding. This is your realized cash yield, not the stock’s quoted yield."
                />
                <div className="text-lg font-semibold">
                  <AmountDisplay value={metrics.ttm} currency={incomeCurrency} />
                </div>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {formatYieldPct(metrics.ttmYieldOnMv)} of market value
                </p>
              </div>
              <div>
                <LabelWithInfo
                  label="Projected year-end"
                  tip="YTD received plus upcoming estimated dividends still due this calendar year (provider schedule × shares). Estimate only."
                />
                <div className="text-lg font-semibold">
                  <AmountDisplay value={metrics.projectedYearEnd} currency={incomeCurrency} />
                </div>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {metrics.upcomingRemaining > 0 ? (
                    <>
                      +
                      <AmountDisplay
                        value={metrics.upcomingRemaining}
                        currency={incomeCurrency}
                      />{" "}
                      upcoming
                    </>
                  ) : (
                    "No upcoming estimates"
                  )}
                </p>
              </div>
              <div>
                <LabelWithInfo
                  label="Trailing yield"
                  tip="Quoted-style yield ≈ (52-week cash ÷ shares) ÷ last price. Equals cash ÷ market value when your share count was stable. Brokers often show annual DPS ÷ current price."
                />
                <div className="text-lg font-semibold tabular-nums">
                  {formatYieldPct(metrics.quoteYield ?? metrics.ttmYieldOnMv)}
                </div>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {metrics.ttmYieldOnCost != null
                    ? `${formatYieldPct(metrics.ttmYieldOnCost)} on cost`
                    : metrics.trailingDps != null && metrics.price > 0
                      ? `≈ DPS ${metrics.trailingDps.toFixed(4)} / price`
                      : "≈ annual DPS ÷ price"}
                </p>
              </div>
            </div>

            {metrics.nextUpcoming ? (
              <div className="border-border/60 text-muted-foreground flex items-center justify-between gap-2 border-t pt-3 text-xs">
                <span>
                  Next est.{" "}
                  <span className="text-foreground font-medium">{metrics.nextUpcoming.date}</span>
                </span>
                <span className="text-foreground font-medium tabular-nums">
                  <AmountDisplay
                    value={amountNumber(metrics.nextUpcoming.displayAmount)}
                    currency={metrics.nextUpcoming.currency || incomeCurrency}
                  />
                </span>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
