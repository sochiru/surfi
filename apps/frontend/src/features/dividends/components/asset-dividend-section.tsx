import { useMemo } from "react";
import {
  getAssetDividendView,
  getAssetHoldings,
  syncDividends,
  type DividendCalendarEvent,
} from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";
import { useSettingsContext } from "@/lib/settings-provider";
import {
  AmountDisplay,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@wealthfolio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Props {
  assetId: string;
}

const KIND_LABEL: Record<DividendCalendarEvent["kind"], string> = {
  posted: "Recorded",
  past_unposted: "Missing",
  upcoming_estimated: "Upcoming",
};

const KIND_CLASS: Record<DividendCalendarEvent["kind"], string> = {
  posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  past_unposted: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  upcoming_estimated: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function formatYieldPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}

export function AssetDividendSection({ assetId }: Props) {
  const queryClient = useQueryClient();
  const { settings } = useSettingsContext();
  const viewQuery = useQuery({
    queryKey: [QueryKeys.ASSET_DIVIDENDS, assetId],
    queryFn: () => getAssetDividendView(assetId),
    staleTime: 5 * 60 * 1000,
  });

  const holdingsQuery = useQuery({
    queryKey: [QueryKeys.HOLDINGS, "asset", assetId],
    queryFn: () => getAssetHoldings(assetId),
  });

  const syncMutation = useMutation({
    mutationFn: syncDividends,
    onSuccess: (result) => {
      if (result.created > 0) {
        toast.success(
          `Created ${result.created} dividend(s)${
            result.netCashAdded && Number(result.netCashAdded) !== 0
              ? ` · ~${result.netCashAdded} net cash`
              : ""
          }`,
        );
      } else {
        toast.success("No missing dividends to create");
      }
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ASSET_DIVIDENDS, assetId] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DIVIDEND_CALENDAR] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ACTIVITY_DATA] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.HOLDINGS] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.INCOME_SUMMARY] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const view = viewQuery.data;
  const events = view?.events ?? [];
  const missing = events.filter((e) => e.kind === "past_unposted").length;
  const incomeCurrency = view?.currency ?? settings?.baseCurrency ?? "";

  const { marketValue, ttmYield, ytdYield } = useMemo(() => {
    const holdings = holdingsQuery.data ?? [];
    const mv = holdings.reduce((sum, h) => sum + Number(h.marketValue?.local ?? 0), 0);
    const ttm = Number(view?.ttmIncome ?? 0);
    const ytd = Number(view?.ytdIncome ?? 0);
    return {
      marketValue: mv,
      ttmYield: mv > 0 ? ttm / mv : null,
      ytdYield: mv > 0 ? ytd / mv : null,
    };
  }, [holdingsQuery.data, view?.ttmIncome, view?.ytdIncome]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-lg">Dividends</CardTitle>
          <p className="text-muted-foreground text-xs">
            Provider history with recorded, missing, and upcoming payouts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/dividends">Settings</Link>
          </Button>
          <Button
            size="sm"
            disabled={syncMutation.isPending || missing === 0}
            onClick={() => syncMutation.mutate()}
          >
            Sync missing{missing > 0 ? ` (${missing})` : ""}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {viewQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground text-xs">YTD · year to date</div>
                <div className="text-lg font-semibold">
                  <AmountDisplay value={Number(view?.ytdIncome ?? 0)} currency={incomeCurrency} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">52-week</div>
                <div className="text-lg font-semibold">
                  <AmountDisplay value={Number(view?.ttmIncome ?? 0)} currency={incomeCurrency} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">52-week yield</div>
                <div className="text-lg font-semibold tabular-nums">{formatYieldPct(ttmYield)}</div>
                <p className="text-muted-foreground text-xs">
                  vs{" "}
                  {marketValue > 0 ? (
                    <AmountDisplay value={marketValue} currency={incomeCurrency} />
                  ) : (
                    "—"
                  )}
                </p>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">YTD yield</div>
                <div className="text-lg font-semibold tabular-nums">{formatYieldPct(ytdYield)}</div>
                <p className="text-muted-foreground text-xs">Not annualized</p>
              </div>
            </div>

            {events.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No dividend events for this holding yet.
              </p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                {events.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{ev.date}</span>
                        <Badge variant="secondary" className={KIND_CLASS[ev.kind]}>
                          {KIND_LABEL[ev.kind]}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {ev.accountName}
                        {ev.notes ? ` · ${ev.notes}` : ""}
                      </div>
                    </div>
                    <AmountDisplay value={Number(ev.displayAmount)} currency={ev.currency} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
