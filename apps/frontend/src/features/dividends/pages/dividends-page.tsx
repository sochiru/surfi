import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAccounts,
  getDividendCalendarEvents,
  getDividendSyncSettings,
  getHoldingsList,
  removeAutoDividends,
  syncDividends,
  updateDividendSyncSettings,
  type DividendCalendarEvent,
  type DividendSyncSettings,
} from "@/adapters";
import type { Account, AccountScope, Holding, PortfolioWithAccounts } from "@/lib/types";
import { QueryKeys } from "@/lib/query-keys";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Page,
  PageContent,
  PageHeader,
  Switch,
} from "@wealthfolio/ui";
import { Alert, AlertDescription } from "@wealthfolio/ui/components/ui/alert";
import { toast } from "sonner";
import { AccountScopeSelector } from "@/components/account-filter-selector";
import { usePortfolios } from "@/hooks/use-portfolios";
import { DividendCalendar } from "../components/dividend-calendar";
import { DividendIncomeChart } from "../components/dividend-income-chart";
import { useSettingsContext } from "@/lib/settings-provider";

function accountIdsForScope(
  scope: AccountScope,
  portfolios: PortfolioWithAccounts[],
): string[] | null {
  if (scope.type === "all") return null;
  if (scope.type === "account") return [scope.accountId];
  if (scope.type === "accounts") return scope.accountIds;
  return portfolios.find((p) => p.id === scope.portfolioId)?.accountIds ?? [];
}

function filterEventsByAccounts(
  events: DividendCalendarEvent[],
  accountIds: string[] | null,
): DividendCalendarEvent[] {
  if (!accountIds) return events;
  const allowed = new Set(accountIds);
  return events.filter((e) => allowed.has(e.accountId));
}

export default function DividendsPage() {
  const queryClient = useQueryClient();
  const { settings: appSettings } = useSettingsContext();
  const { data: portfolios = [] } = usePortfolios();
  const [message, setMessage] = useState<string | null>(null);
  const [accountFilter, setAccountScope] = useState<AccountScope>({ type: "all" });

  const settingsQuery = useQuery({
    queryKey: [QueryKeys.DIVIDEND_SYNC_SETTINGS],
    queryFn: getDividendSyncSettings,
  });

  const accountsQuery = useQuery<Account[], Error>({
    queryKey: [QueryKeys.ACCOUNTS, false],
    queryFn: () => getAccounts(false),
  });

  const calendarQuery = useQuery({
    queryKey: [QueryKeys.DIVIDEND_CALENDAR],
    queryFn: getDividendCalendarEvents,
  });

  const holdingsQuery = useQuery<Holding[], Error>({
    queryKey: [QueryKeys.HOLDINGS, accountFilter],
    queryFn: () => getHoldingsList(accountFilter),
  });

  const settings = settingsQuery.data;

  const filteredEvents = useMemo(() => {
    const ids = accountIdsForScope(accountFilter, portfolios);
    return filterEventsByAccounts(calendarQuery.data ?? [], ids);
  }, [accountFilter, portfolios, calendarQuery.data]);

  const persistSettings = useMutation({
    mutationFn: updateDividendSyncSettings,
    onSuccess: (next) => {
      queryClient.setQueryData([QueryKeys.DIVIDEND_SYNC_SETTINGS], next);
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DIVIDEND_CALENDAR] });
    },
    onError: (error) => toast.error(String(error)),
  });

  const updateLocal = useCallback(
    (updater: (prev: DividendSyncSettings) => DividendSyncSettings) => {
      if (!settings) return;
      const next = updater(settings);
      persistSettings.mutate(next);
    },
    [persistSettings, settings],
  );

  const syncMutation = useMutation({
    mutationFn: syncDividends,
    onSuccess: (result) => {
      const parts = [`Created ${result.created}`, `skipped ${result.skipped}`];
      if (result.skippedNoShares) {
        parts.push(`(${result.skippedNoShares} held 0 shares at ex-date)`);
      }
      if (result.skippedDuplicates) {
        parts.push(`(${result.skippedDuplicates} already synced)`);
      }
      const accountParts = result.accounts
        .filter((a) => a.created > 0 || a.skippedNoShares > 0 || a.skippedDuplicates > 0)
        .map(
          (a) =>
            `${a.accountName}: created ${a.created}; skipped (0 shares) ${a.skippedNoShares}; dup ${a.skippedDuplicates}`,
        );
      const errText = result.errors.length ? ` Notes: ${result.errors.join("; ")}` : "";
      setMessage(
        `${parts.join(", ")}.${accountParts.length ? ` ${accountParts.join(" · ")}.` : ""}${errText}`,
      );

      if (result.created > 0) {
        const net = Number(result.netCashAdded);
        toast.success(
          `Created ${result.created} dividend${result.created === 1 ? "" : "s"}${
            Number.isFinite(net) && net !== 0
              ? ` · ~${net.toFixed(2)} net cash added to account balances`
              : ""
          }`,
        );
      } else if (result.errors.length && result.skippedNoShares === 0) {
        toast.error(result.errors[0] ?? "Sync failed");
      } else if (result.skippedNoShares > 0) {
        toast.message("Nothing new created — check shares at ex-date");
      } else {
        toast.success("Nothing new to create");
      }

      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DIVIDEND_CALENDAR] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ACTIVITY_DATA] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.INCOME_SUMMARY] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.HOLDINGS] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ACCOUNTS_SUMMARY] });
    },
    onError: (error) => {
      setMessage(String(error));
      toast.error(String(error));
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeAutoDividends,
    onSuccess: (n) => {
      toast.success(`Removed ${n} auto-created activities`);
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DIVIDEND_CALENDAR] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ACTIVITY_DATA] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.INCOME_SUMMARY] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.HOLDINGS] });
    },
    onError: (error) => toast.error(String(error)),
  });

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const busy =
    syncMutation.isPending || removeMutation.isPending || persistSettings.isPending;

  const upcomingEstimate = useMemo(() => {
    return filteredEvents
      .filter((e) => e.kind === "upcoming_estimated")
      .reduce((sum, e) => sum + Number(e.displayAmount), 0);
  }, [filteredEvents]);

  if (!settings) {
    return (
      <Page>
        <PageHeader heading="Dividends" />
        <PageContent>
          <p className="text-muted-foreground">Loading settings…</p>
        </PageContent>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        heading="Dividends"
        text="Auto-create cash dividends from market data history using shares held at each ex-date. Opt in per account — same ticker in multiple accounts gets separate payouts."
        actions={<AccountScopeSelector value={accountFilter} onChange={setAccountScope} />}
      />
      <PageContent className="flex flex-col gap-6">
        <Alert>
          <AlertDescription>
            Market data is the only source for auto dividends (Yahoo / EODHD / Finnhub / Alpha
            Vantage). Cash books into each investment account&apos;s balance (e.g. CASH:PHP /
            CASH:USD) — open the account page to see updated cash after sync. Chart, yield, and
            calendar respect the account filter above.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Automation</CardTitle>
              <p className="text-muted-foreground text-sm">
                Global switch plus per-account enable and withholding rate.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="div-global">Enabled</Label>
              <Switch
                id="div-global"
                checked={settings.globalEnabled}
                onCheckedChange={(checked) =>
                  updateLocal((prev) => ({ ...prev, globalEnabled: checked }))
                }
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={busy || !settings.globalEnabled}
              >
                Sync missing dividends
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove all auto-created dividend activities (including legacy PSE addon ones)?",
                    )
                  ) {
                    removeMutation.mutate();
                  }
                }}
                disabled={busy}
              >
                Remove auto-created
              </Button>
            </div>
            {message ? <p className="text-muted-foreground text-sm">{message}</p> : null}

            <div className="divide-y rounded-md border">
              {accounts.map((account) => {
                const row = settings.accounts[account.id] ?? {
                  enabled: false,
                  dividendTaxRate: account.currency === "PHP" ? 0.1 : 0,
                };
                return (
                  <div
                    key={account.id}
                    className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="font-medium">{account.name}</div>
                      <div className="text-muted-foreground text-xs">{account.currency}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`div-en-${account.id}`}>Sync</Label>
                        <Switch
                          id={`div-en-${account.id}`}
                          checked={row.enabled}
                          onCheckedChange={(checked) =>
                            updateLocal((prev) => ({
                              ...prev,
                              accounts: {
                                ...prev.accounts,
                                [account.id]: { ...row, enabled: checked },
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`div-tax-${account.id}`}>Tax %</Label>
                        <Input
                          id={`div-tax-${account.id}`}
                          className="w-20"
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={Number((row.dividendTaxRate * 100).toFixed(4))}
                          onChange={(e) => {
                            const pct = Number(e.target.value);
                            if (!Number.isFinite(pct)) return;
                            updateLocal((prev) => ({
                              ...prev,
                              accounts: {
                                ...prev.accounts,
                                [account.id]: {
                                  ...row,
                                  dividendTaxRate: Math.min(1, Math.max(0, pct / 100)),
                                },
                              },
                            }));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upcoming estimate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {upcomingEstimate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <p className="text-muted-foreground text-xs">
              Sum of upcoming provider events × current shares (estimate only; currencies may
              differ).
            </p>
          </CardContent>
        </Card>

        <DividendIncomeChart
          events={filteredEvents}
          holdings={holdingsQuery.data ?? []}
          isLoading={
            calendarQuery.isLoading ||
            calendarQuery.isFetching ||
            holdingsQuery.isLoading
          }
          fallbackCurrency={appSettings?.baseCurrency}
        />

        <DividendCalendar
          events={filteredEvents}
          isLoading={calendarQuery.isLoading || calendarQuery.isFetching}
        />
      </PageContent>
    </Page>
  );
}
