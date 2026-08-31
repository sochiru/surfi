import { getIncomeSummary, searchActivities } from "@/adapters";
import { DashboardCard } from "@/components/dashboard-card";
import { QueryKeys } from "@/lib/query-keys";
import { useSettingsContext } from "@/lib/settings-provider";
import { AmountDisplay, Button, Skeleton } from "@wealthfolio/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

const DIVIDENDS_ROUTE = "/insights?tab=dividends";

export function DividendsCard() {
  const { settings } = useSettingsContext();
  const baseCurrency = settings?.baseCurrency ?? "USD";

  const incomeQuery = useQuery({
    queryKey: [QueryKeys.INCOME_SUMMARY, "dashboard-dividends"],
    queryFn: () => getIncomeSummary(),
  });

  const recentQuery = useQuery({
    queryKey: [QueryKeys.ACTIVITY_DATA, "dashboard-dividends-recent"],
    queryFn: async () => {
      const res = await searchActivities(1, 20, { activityTypes: ["DIVIDEND"] }, "");
      return res.data.slice(0, 5);
    },
  });

  const ytd = incomeQuery.data?.find((s) => s.period === "YTD" || s.period === "ytd");
  const all = incomeQuery.data?.find((s) => s.period === "ALL" || s.period === "all");
  const summary = ytd ?? all;
  const dividendIncome = summary?.byType?.DIVIDEND ?? 0;

  return (
    <DashboardCard
      title="Dividends"
      action={
        <Link to={DIVIDENDS_ROUTE} className="text-muted-foreground text-xs hover:underline">
          View dividends
        </Link>
      }
    >
      {incomeQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-muted-foreground text-xs">
              {ytd ? "YTD dividends" : "All-time dividends"}
            </div>
            <div className="text-2xl font-semibold">
              <AmountDisplay value={dividendIncome} currency={summary?.currency ?? baseCurrency} />
            </div>
          </div>

          {recentQuery.data && recentQuery.data.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {recentQuery.data.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="truncate">{a.assetSymbol}</span>
                  <AmountDisplay value={Number(a.amount ?? 0)} currency={a.currency} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              Sync missing dividends to auto-create payouts from market data.
            </p>
          )}

          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to={DIVIDENDS_ROUTE}>Open dividends</Link>
          </Button>
        </div>
      )}
    </DashboardCard>
  );
}
