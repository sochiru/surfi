import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getDividendCalendarEvents, getHoldingsList, type DividendCalendarEvent } from "@/adapters";
import type { AccountScope, HoldingsListResponse, PortfolioWithAccounts } from "@/lib/types";
import { QueryKeys } from "@/lib/query-keys";
import { Button, buttonVariants, DateRangeSelector } from "@wealthfolio/ui";
import { Alert, AlertDescription } from "@wealthfolio/ui/components/ui/alert";
import { cn } from "@wealthfolio/ui/lib/utils";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { usePortfolios } from "@/hooks/use-portfolios";
import { useSettingsContext } from "@/lib/settings-provider";
import { DividendIncomeChart } from "./dividend-income-chart";
import { buildDividendFxTable } from "../lib/dividend-income-summary";
import {
  buildAnnualDividendIncome,
  buildDividendPayers,
  buildDividendRhythm,
  buildDividendYearOutlook,
  countMissingDividendPayouts,
} from "../lib/dividend-outlook";
import { DividendAnnualChart } from "./dividend-annual-chart";
import { DividendCalendar } from "./dividend-calendar";
import { DividendPayersTable } from "./dividend-payers-table";
import { DividendRhythmCard } from "./dividend-rhythm";
import { DividendYearOutlookCard } from "./dividend-year-outlook";
import { useDividendFilters } from "../hooks/use-dividend-filters";
import { useDividendSyncSettings, useSyncDividends } from "../hooks/use-dividend-sync";

const DIVIDEND_HIDDEN_DATE_RANGES = ["1D", "1W"] as const;

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

export function DividendPeriodSelector() {
  const { today, range, setRange } = useDividendFilters();
  return (
    <DateRangeSelector
      asOf={today}
      value={range}
      onChange={setRange}
      hiddenRanges={DIVIDEND_HIDDEN_DATE_RANGES}
    />
  );
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
          <Icons.Spinner className="size-4 animate-spin sm:me-2" />
        ) : (
          <Icons.Refresh className="size-4 sm:me-2" />
        )}
        <span className="hidden sm:inline">Sync now</span>
      </Button>
      <Link
        to="/settings/dividends"
        aria-label="Dividend settings"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <Icons.Settings2 className="size-4" />
      </Link>
    </div>
  );
}

export function DividendInsights({ accountFilter }: DividendInsightsProps) {
  const { settings: appSettings } = useSettingsContext();
  const { data: portfolios = [] } = usePortfolios();
  const syncSettingsQuery = useDividendSyncSettings();
  const syncMutation = useSyncDividends();
  const { bounds, groupBy, setGroupBy } = useDividendFilters();

  const calendarQuery = useQuery({
    queryKey: [QueryKeys.DIVIDEND_CALENDAR],
    queryFn: getDividendCalendarEvents,
  });

  const holdingsQuery = useQuery<HoldingsListResponse, Error>({
    queryKey: [QueryKeys.HOLDINGS, accountFilter],
    queryFn: () => getHoldingsList(accountFilter),
  });

  const filteredEvents = useMemo(() => {
    const ids = accountIdsForScope(accountFilter, portfolios);
    return filterEventsByAccounts(calendarQuery.data ?? [], ids);
  }, [accountFilter, portfolios, calendarQuery.data]);

  const dividendFx = useMemo(
    () => buildDividendFxTable(holdingsQuery.data?.holdings ?? [], appSettings?.baseCurrency ?? ""),
    [holdingsQuery.data?.holdings, appSettings?.baseCurrency],
  );
  const outlook = useMemo(
    () => buildDividendYearOutlook(filteredEvents, dividendFx),
    [filteredEvents, dividendFx],
  );
  const annual = useMemo(
    () => buildAnnualDividendIncome(filteredEvents, dividendFx),
    [filteredEvents, dividendFx],
  );
  const holdings = holdingsQuery.data?.holdings;
  const payers = useMemo(
    () => buildDividendPayers(filteredEvents, dividendFx, bounds, new Date(), holdings ?? []),
    [filteredEvents, dividendFx, bounds, holdings],
  );
  const rhythm = useMemo(
    () => buildDividendRhythm(filteredEvents, dividendFx),
    [filteredEvents, dividendFx],
  );
  const missingPayouts = useMemo(
    () => countMissingDividendPayouts(filteredEvents),
    [filteredEvents],
  );
  const baseCurrency = appSettings?.baseCurrency ?? "";
  // Totals wait for holdings, whose rates convert foreign payouts.
  const totalsLoading =
    calendarQuery.isLoading || calendarQuery.isFetching || holdingsQuery.isLoading;

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
            <Link
              to="/settings/dividends"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full sm:w-auto")}
            >
              Set up dividends
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {missingPayouts > 0 ? (
        <Alert>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {missingPayouts} past payout{missingPayouts === 1 ? "" : "s"} not recorded.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => syncMutation.mutate()}
              disabled={!syncEnabled || syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Icons.Spinner className="size-4 animate-spin" />
              ) : (
                "Sync now"
              )}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <DividendIncomeChart
        events={filteredEvents}
        holdings={holdings ?? []}
        isLoading={totalsLoading}
        fallbackCurrency={appSettings?.baseCurrency}
        bounds={bounds}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
      />

      <DividendYearOutlookCard
        outlook={outlook}
        currency={baseCurrency}
        isLoading={totalsLoading}
      />

      <DividendAnnualChart rows={annual} currency={baseCurrency} isLoading={totalsLoading} />

      <DividendRhythmCard rhythm={rhythm} isLoading={totalsLoading} />

      <DividendPayersTable summary={payers} currency={baseCurrency} isLoading={totalsLoading} />

      <DividendCalendar
        events={filteredEvents}
        isLoading={calendarQuery.isLoading || calendarQuery.isFetching}
      />
    </div>
  );
}
