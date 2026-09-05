import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getDividendSyncSettings,
  removeAutoDividends,
  removeAutoDividendsAccount,
  syncDividends,
  syncDividendsAccount,
  updateDividendSyncSettings,
  type DividendSyncResult,
} from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";

const LEDGER_KEYS = [
  QueryKeys.DIVIDEND_CALENDAR,
  QueryKeys.ACTIVITY_DATA,
  QueryKeys.INCOME_SUMMARY,
  QueryKeys.HOLDINGS,
  QueryKeys.ACCOUNTS_SUMMARY,
];

export function useDividendSyncSettings() {
  return useQuery({
    queryKey: [QueryKeys.DIVIDEND_SYNC_SETTINGS],
    queryFn: getDividendSyncSettings,
  });
}

export function useUpdateDividendSyncSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateDividendSyncSettings,
    onSuccess: (next) => {
      queryClient.setQueryData([QueryKeys.DIVIDEND_SYNC_SETTINGS], next);
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DIVIDEND_CALENDAR] });
    },
    onError: (error) => toast.error(String(error)),
  });
}

/** Human-readable recap of a sync run, suitable for an inline detail line. */
export function describeSyncResult(result: DividendSyncResult): string {
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
  return `${parts.join(", ")}.${accountParts.length ? ` ${accountParts.join(" · ")}.` : ""}${errText}`;
}

/** Pass an account id to scope the run; omit it to cover every enabled account. */
export function useSyncDividends(onMessage?: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation<DividendSyncResult, Error, string | void>({
    mutationFn: (accountId) => (accountId ? syncDividendsAccount(accountId) : syncDividends()),
    onSuccess: (result) => {
      onMessage?.(describeSyncResult(result));

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

      for (const key of LEDGER_KEYS) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => {
      onMessage?.(String(error));
      toast.error(String(error));
    },
  });
}

/** Pass an account id to scope the removal; omit it to clear every account. */
export function useRemoveAutoDividends() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, string | void>({
    mutationFn: (accountId) =>
      accountId ? removeAutoDividendsAccount(accountId) : removeAutoDividends(),
    onSuccess: (n) => {
      toast.success(`Removed ${n} auto-created activities`);
      for (const key of LEDGER_KEYS) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => toast.error(String(error)),
  });
}
