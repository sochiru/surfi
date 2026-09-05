import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { removeAutoInterest, syncCashInterest } from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";

const LEDGER_KEYS = [QueryKeys.ACTIVITIES, QueryKeys.HOLDINGS, QueryKeys.ACCOUNTS_SUMMARY];

function useLedgerInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of LEDGER_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Generates interest for every yield-bearing cash account. */
export function useSyncAllCashInterest() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: syncCashInterest,
    onSuccess: (result) => {
      toast.success(`Generated ${result.created} interest entries across all accounts`);
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });
}

/** Clears auto-created interest from every account. */
export function useRemoveAllAutoInterest() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: removeAutoInterest,
    onSuccess: (count) => {
      toast.success(`Removed ${count} auto interest entries across all accounts`);
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });
}
