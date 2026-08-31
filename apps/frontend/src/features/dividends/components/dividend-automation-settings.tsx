import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from "@wealthfolio/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@wealthfolio/ui/components/ui/alert-dialog";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { getAccounts, type DividendSyncSettings } from "@/adapters";
import type { Account } from "@/lib/types";
import { QueryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  useDividendSyncSettings,
  useRemoveAutoDividends,
  useSyncDividends,
  useUpdateDividendSyncSettings,
} from "../hooks/use-dividend-sync";

function defaultRate(currency: string): number {
  return currency === "PHP" ? 0.1 : 0;
}

export function DividendAutomationSettings() {
  const [message, setMessage] = useState<string | null>(null);

  const settingsQuery = useDividendSyncSettings();
  const accountsQuery = useQuery<Account[], Error>({
    queryKey: [QueryKeys.ACCOUNTS, false],
    queryFn: () => getAccounts(false),
  });

  const persistSettings = useUpdateDividendSyncSettings();
  const syncMutation = useSyncDividends(setMessage);
  const removeMutation = useRemoveAutoDividends();

  const settings = settingsQuery.data;
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const busy = syncMutation.isPending || removeMutation.isPending || persistSettings.isPending;

  const updateLocal = useCallback(
    (updater: (prev: DividendSyncSettings) => DividendSyncSettings) => {
      if (!settings) return;
      persistSettings.mutate(updater(settings));
    },
    [persistSettings, settings],
  );

  if (!settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const enabledCount = accounts.filter((a) => settings.accounts[a.id]?.enabled).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-4 sm:gap-4 sm:px-6">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">Automatic dividends</CardTitle>
            <CardDescription>
              Create cash dividend activities from market data history, using the shares held in
              each account at the ex-date. The same ticker held in several accounts gets a separate
              payout per account.
            </CardDescription>
          </div>
          <Switch
            id="dividend-global-enabled"
            aria-label="Enable automatic dividends"
            checked={settings.globalEnabled}
            onCheckedChange={(checked) =>
              updateLocal((prev) => ({ ...prev, globalEnabled: checked }))
            }
          />
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="text-muted-foreground flex items-start gap-2 text-sm">
            <Icons.Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Dividend history comes from your market data providers (Yahoo, EODHD, Finnhub, Alpha
              Vantage). Cash is booked into each investment account&apos;s balance.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className={cn(!settings.globalEnabled && "opacity-60")}>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>
            {enabledCount === 0
              ? "No account is syncing dividends yet — turn one on to start."
              : `${enabledCount} of ${accounts.length} accounts sync dividends.`}{" "}
            Withholding is deducted from the gross payout before it hits your cash balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y border-y">
            {accounts.map((account) => {
              const row = settings.accounts[account.id] ?? {
                enabled: false,
                dividendTaxRate: defaultRate(account.currency),
              };
              return (
                <div
                  key={account.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Switch
                      id={`dividend-enabled-${account.id}`}
                      disabled={!settings.globalEnabled || busy}
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
                    <Label
                      htmlFor={`dividend-enabled-${account.id}`}
                      className="min-w-0 cursor-pointer"
                    >
                      <span className="block truncate font-medium">{account.name}</span>
                      <span className="text-muted-foreground text-xs font-normal">
                        {account.currency}
                      </span>
                    </Label>
                  </div>
                  <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-2 pl-11 sm:flex sm:pl-0">
                    <Label
                      htmlFor={`dividend-tax-${account.id}`}
                      className="text-muted-foreground text-xs font-normal"
                    >
                      Withholding
                    </Label>
                    <Input
                      id={`dividend-tax-${account.id}`}
                      className="w-20"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.1}
                      disabled={!settings.globalEnabled || !row.enabled || busy}
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
                    <span className="text-muted-foreground text-sm">%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-base">Maintenance</CardTitle>
          <CardDescription>
            Run a catch-up sync after changing these settings, or clear everything automation has
            created.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-6">
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button
              className="w-full sm:w-auto"
              onClick={() => syncMutation.mutate()}
              disabled={busy || !settings.globalEnabled || enabledCount === 0}
            >
              {syncMutation.isPending ? (
                <Icons.Spinner className="mr-2 size-4 animate-spin" />
              ) : (
                <Icons.Refresh className="mr-2 size-4" />
              )}
              Sync missing dividends
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto" disabled={busy}>
                  <Icons.Trash className="mr-2 size-4" />
                  Remove auto-created
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove auto-created dividends?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes every dividend activity that automation created, including legacy
                    ones from the PSE addon. Dividends you entered manually are kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => removeMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {message ? <p className="text-muted-foreground break-words text-sm">{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
