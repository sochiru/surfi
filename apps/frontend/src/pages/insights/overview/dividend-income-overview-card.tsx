import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getDividendCalendarEvents } from "@/adapters";
import { DividendIncomeChart } from "@/features/dividends/components/dividend-income-chart";
import { QueryKeys } from "@/lib/query-keys";
import type { AccountScope, Holding, PortfolioWithAccounts } from "@/lib/types";
import { Button } from "@wealthfolio/ui";

interface Props {
  accountFilter: AccountScope;
  holdings: Holding[];
  portfolios: PortfolioWithAccounts[];
  baseCurrency: string;
  holdingsLoading?: boolean;
}

function accountIdsForScope(
  scope: AccountScope,
  portfolios: PortfolioWithAccounts[],
): string[] | null {
  if (scope.type === "all") return null;
  if (scope.type === "account") return [scope.accountId];
  if (scope.type === "accounts") return scope.accountIds;
  return portfolios.find((p) => p.id === scope.portfolioId)?.accountIds ?? [];
}

export function DividendIncomeOverviewCard({
  accountFilter,
  holdings,
  portfolios,
  baseCurrency,
  holdingsLoading,
}: Props) {
  const calendarQuery = useQuery({
    queryKey: [QueryKeys.DIVIDEND_CALENDAR, "insights-overview"],
    queryFn: getDividendCalendarEvents,
  });

  const filteredEvents = useMemo(() => {
    const events = calendarQuery.data ?? [];
    const ids = accountIdsForScope(accountFilter, portfolios);
    if (!ids) return events;
    const allowed = new Set(ids);
    return events.filter((e) => allowed.has(e.accountId));
  }, [accountFilter, portfolios, calendarQuery.data]);

  return (
    <DividendIncomeChart
      events={filteredEvents}
      holdings={holdings}
      isLoading={calendarQuery.isLoading || calendarQuery.isFetching || holdingsLoading}
      fallbackCurrency={baseCurrency}
      compact
      headerAction={
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8 px-2 text-xs"
        >
          <Link to="/insights?tab=dividends">View details</Link>
        </Button>
      }
    />
  );
}
