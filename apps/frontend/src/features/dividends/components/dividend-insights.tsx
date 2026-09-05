import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getDividendCalendarEvents, getHoldingsList, type DividendCalendarEvent } from "@/adapters";
import type { AccountScope, Holding, PortfolioWithAccounts } from "@/lib/types";
import { QueryKeys } from "@/lib/query-keys";
import {
  AmountDisplay,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui";
import { Alert, AlertDescription } from "@wealthfolio/ui/components/ui/alert";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { usePortfolios } from "@/hooks/use-portfolios";
import { useSettingsContext } from "@/lib/settings-provider";
import { DividendCalendar } from "./dividend-calendar";
import { DividendIncomeChart } from "./dividend-income-chart";
import { useDividendSyncSettings, useSyncDividends } from "../hooks/use-dividend-sync";

interface DividendInsightsProps {
  accountFilter: AccountScope;
}

function accountIdsForScope(
  scope: AccountScope,
  portfolios: PortfolioWithAccounts[],
): string[] | null {
  if (scope.type === "all") return null;
  if (scope.type === "account") return [scope.accountId];
  if (scope.type === "accounts") return scope.accountIds;
  return portfolios.find((portfolio) => portfolio.id === scope.portfolioId)?.accountIds ?? [];
}

function filterEventsByAccounts(
  events: DividendCalendarEvent[],
  accountIds: string[] | null,
): DividendCalendarEvent[] {
  if (!accountIds) return events;
  const allowed = new Set(accountIds);
  return events.filter((event) => allowed.has(event.accountId));
}

export function DividendInsightsActions() {
  const syncSettingsQuery = useDividendSyncSettings();
  const syncMutation = useSyncDividends();
  const syncSettings = syncSettingsQuery.data;
  const syncEnabled =
    syncSettings?.globalEnabled === true &&
    Object.values(syncSettings.accounts).some((account) => account.enabled);

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <Button
        variant="outline"
        size="icon"
        className="sm:w-auto sm:px-4"
        onClick={() => syncMutation.mutate()}
        disabled={!syncEnabled || syncMutation.isPending}
        aria-label="Sync dividends now"
      >
        {syncMutation.isPending ? (
          <Icons.Spinner className="size-4 animate-spin sm:mr-2" />
        ) : (
          <Icons.Refresh className="size-4 sm:mr-2" />
        )}
        <span className="hidden sm:inline">Sync now</span>
      </Button>
      <Button variant="ghost" size="icon" asChild aria-label="Dividend settings">
        <Link to="/settings/dividends">
          <Icons.Settings2 className="size-4" />
        </Link>
      </Button>
    </div>
  );
}

export function DividendInsights({ accountFilter }: DividendInsightsProps) {
  const { settings: appSettings } = useSettingsContext();
  const { data: portfolios = [] } = usePortfolios();
  const syncSettingsQuery = useDividendSyncSettings();

  const calendarQuery = useQuery({
    queryKey: [QueryKeys.DIVIDEND_CALENDAR],
    queryFn: getDividendCalendarEvents,
  });

  const holdingsQuery = useQuery<Holding[], Error>({
    queryKey: [QueryKeys.HOLDINGS, accountFilter],
    queryFn: () => getHoldingsList(accountFilter),
  });

  const filteredEvents = useMemo(() => {
    const ids = accountIdsForScope(accountFilter, portfolios);
    return filterEventsByAccounts(calendarQuery.data ?? [], ids);
  }, [accountFilter, portfolios, calendarQuery.data]);

  const upcoming = useMemo(() => {
    const events = filteredEvents.filter((event) => event.kind === "upcoming_estimated");
    const total = events.reduce((sum, event) => sum + Number(event.displayAmount), 0);
    const nextDate = events
      .map((event) => event.date)
      .sort()
      .at(0);
    return { total, count: events.length, nextDate };
  }, [filteredEvents]);

  const syncSettings = syncSettingsQuery.data;
  const syncEnabled =
    syncSettings?.globalEnabled === true &&
    Object.values(syncSettings.accounts).some((account) => account.enabled);

  return (
    <div className="flex min-w-0 flex-col gap-3 sm:gap-6">
      {syncSettingsQuery.isSuccess && !syncEnabled ? (
        <Alert>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Automatic dividends are off, so only manually recorded dividends appear here.
            </span>
            <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
              <Link to="/settings/dividends">Set up dividends</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <DividendIncomeChart
        events={filteredEvents}
        holdings={holdingsQuery.data ?? []}
        isLoading={calendarQuery.isLoading || calendarQuery.isFetching || holdingsQuery.isLoading}
        fallbackCurrency={appSettings?.baseCurrency}
      />

      <Card>
        <CardHeader className="px-4 pb-2 sm:px-6">
          <CardTitle className="text-lg">Upcoming</CardTitle>
          <CardDescription>
            {upcoming.count === 0
              ? "No announced dividends ahead for the selected accounts."
              : `${upcoming.count} announced payout${upcoming.count === 1 ? "" : "s"} × your current shares — an estimate only.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          <div className="text-2xl font-semibold tabular-nums">
            <AmountDisplay
              value={upcoming.total}
              currency={appSettings?.baseCurrency ?? ""}
              displayCurrency={false}
            />
          </div>
          {upcoming.nextDate ? (
            <p className="text-muted-foreground text-xs">Next payout {upcoming.nextDate}</p>
          ) : null}
        </CardContent>
      </Card>

      <DividendCalendar
        events={filteredEvents}
        isLoading={calendarQuery.isLoading || calendarQuery.isFetching}
      />
    </div>
  );
}
