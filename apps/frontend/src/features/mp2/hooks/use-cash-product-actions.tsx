import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icons,
  Input,
  Label,
} from "@wealthfolio/ui";
import { createActivity, removeAutoInterestAccount, syncCashInterestAccount } from "@/adapters";
import type { ActionPaletteGroup } from "@/components/action-palette";
import { isMp2Account, parseAccountMeta } from "@/lib/cash-product-meta";
import { ActivityType } from "@/lib/constants";
import { QueryKeys } from "@/lib/query-keys";
import type { Account } from "@/lib/types";
import { RecordDividendDialog } from "../components/record-dividend-dialog";

interface CashProductActions {
  /** Null unless the account holds a yield-bearing cash product. */
  group: ActionPaletteGroup | null;
  dialogs: React.ReactNode;
}

/**
 * Cash-product actions for the account page's action palette. The palette sits in
 * the page header while its dialogs belong in the page body, so the hook owns both
 * and hands each back to the slot it renders in.
 */
export function useCashProductActions(account: Account | undefined): CashProductActions {
  const queryClient = useQueryClient();
  const product = parseAccountMeta(account?.meta).product;
  const isMp2 = isMp2Account(account?.meta);
  const compounding = product?.compounding ?? true;

  const [contributeOpen, setContributeOpen] = useState(false);
  const [dividendOpen, setDividendOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.ACTIVITIES] });
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.HOLDINGS] });
  };

  const syncMutation = useMutation({
    mutationFn: () => syncCashInterestAccount(account?.id ?? ""),
    onSuccess: (result) => {
      toast.success(`Generated ${result.created} interest entries for ${account?.name}`);
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeAutoInterestAccount(account?.id ?? ""),
    onSuccess: (count) => {
      toast.success(`Removed ${count} auto interest entries from ${account?.name}`);
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });

  const contributeMutation = useMutation({
    mutationFn: () =>
      createActivity({
        accountId: account?.id ?? "",
        activityType: ActivityType.DEPOSIT,
        activityDate: new Date(`${activityDate}T00:00:00`),
        amount: Number(amount),
        currency: account?.currency ?? "",
        fee: 0,
        comment: "MP2 contribution",
      }),
    onSuccess: () => {
      toast.success("Contribution recorded");
      setContributeOpen(false);
      setAmount("");
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });

  if (!account || !product?.yield?.enabled) return { group: null, dialogs: null };

  const group: ActionPaletteGroup = {
    title: isMp2 ? "Pag-IBIG MP2" : "Cash interest",
    items: [
      ...(isMp2
        ? [
            {
              icon: Icons.Plus,
              label: "Contribute",
              testId: "button-mp2-contribute",
              onClick: () => setContributeOpen(true),
            },
            {
              icon: Icons.Coins,
              label: "Record dividend",
              testId: "button-mp2-record-dividend",
              onClick: () => setDividendOpen(true),
            },
          ]
        : []),
      {
        icon: Icons.Sparkles,
        label: "Generate interest for this account",
        testId: "button-sync-cash-interest",
        onClick: () => syncMutation.mutate(),
      },
      {
        icon: Icons.Trash,
        label: "Remove auto interest from this account",
        testId: "button-remove-auto-interest",
        variant: "destructive",
        onClick: () => removeMutation.mutate(),
      },
    ],
  };

  const dialogs = (
    <>
      <Dialog open={contributeOpen} onOpenChange={setContributeOpen}>
        <DialogContent data-testid="dialog-mp2-contribute">
          <DialogHeader>
            <DialogTitle>Record contribution</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mp2-contrib-date">Date</Label>
              <Input
                id="mp2-contrib-date"
                data-testid="input-mp2-contrib-date"
                type="date"
                value={activityDate}
                onChange={(e) => setActivityDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mp2-contrib-amount">Amount ({account.currency})</Label>
              <Input
                id="mp2-contrib-amount"
                data-testid="input-mp2-contrib-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributeOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="button-mp2-contrib-save"
              disabled={contributeMutation.isPending || !amount || Number(amount) <= 0}
              onClick={() => contributeMutation.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordDividendDialog
        open={dividendOpen}
        onOpenChange={setDividendOpen}
        accountId={account.id}
        currency={account.currency}
        firstContributionDate={product.firstContributionDate}
        compounding={compounding}
        onRecorded={invalidate}
      />
    </>
  );

  return { group, dialogs };
}
