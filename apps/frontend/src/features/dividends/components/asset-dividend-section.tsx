import { useMemo } from "react";
import {
  getAssetDividendView,
  getAssetHoldings,
  type DividendCalendarEvent,
} from "@/adapters";
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
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { amountNumber } from "@/features/dividends/lib/dividend-income-summary";

interface Props {
  assetId: string;
  /** When set, income totals / yield MV are limited to this account. */
  accountId?: string | null;
}

function postedIncomeTotals(events: DividendCalendarEvent[]): { ytd: number; ttm: number } {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const ttmStart = new Date(now);
  ttmStart.setDate(ttmStart.getDate() - 365);
  let ytd = 0;
  let ttm = 0;
  for (const event of events) {
    if (event.kind !== "posted") continue;
    const amount = amountNumber(event.displayAmount);
    if (amount === 0) continue;
    const date = new Date(`${event.date}T00:00:00`);
    if (Number.isNaN(date.getTime())) continue;
    if (date >= yearStart) ytd += amount;
    if (date >= ttmStart) ttm += amount;
  }
  return { ytd, ttm };
}

function formatYieldPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
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

  const { marketValue, ytdIncome, ttmIncome, ttmYield, ytdYield } = useMemo(() => {
    const holdings = (holdingsQuery.data ?? []).filter(
      (h) => !accountId || h.accountId === accountId,
    );
    const mv = holdings.reduce((sum, h) => sum + amountNumber(h.marketValue?.local ?? 0), 0);
    const scopedEvents = accountId
      ? (view?.events ?? []).filter((e) => e.accountId === accountId)
      : null;
    const totals = scopedEvents
      ? postedIncomeTotals(scopedEvents)
      : {
          ytd: amountNumber(view?.ytdIncome ?? 0),
          ttm: amountNumber(view?.ttmIncome ?? 0),
        };
    return {
      marketValue: mv,
      ytdIncome: totals.ytd,
      ttmIncome: totals.ttm,
      ttmYield: mv > 0 ? totals.ttm / mv : null,
      ytdYield: mv > 0 ? totals.ytd / mv : null,
    };
  }, [holdingsQuery.data, accountId, view?.events, view?.ttmIncome, view?.ytdIncome]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Dividends</CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground h-8 px-2 text-xs">
          <Link to="/dividends">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {viewQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-muted-foreground text-xs">YTD · year to date</div>
              <div className="text-lg font-semibold">
                <AmountDisplay value={ytdIncome} currency={incomeCurrency} />
              </div>
              <p className="text-muted-foreground text-xs tabular-nums">
                {formatYieldPct(ytdYield)} yield
              </p>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">52-week</div>
              <div className="text-lg font-semibold">
                <AmountDisplay value={ttmIncome} currency={incomeCurrency} />
              </div>
              <p className="text-muted-foreground text-xs tabular-nums">
                {formatYieldPct(ttmYield)}
                {marketValue > 0 ? (
                  <>
                    {" "}
                    vs <AmountDisplay value={marketValue} currency={incomeCurrency} />
                  </>
                ) : null}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
