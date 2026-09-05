import { Button } from "@wealthfolio/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui/components/ui/card";
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
import {
  useRemoveAllAutoInterest,
  useSyncAllCashInterest,
} from "@/features/mp2/hooks/use-cash-interest-maintenance";

export function CashInterestMaintenance() {
  const syncMutation = useSyncAllCashInterest();
  const removeMutation = useRemoveAllAutoInterest();
  const busy = syncMutation.isPending || removeMutation.isPending;

  return (
    <Card data-testid="cash-interest-maintenance">
      <CardHeader>
        <CardTitle className="text-lg">Maintenance — all accounts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          These buttons apply to every yield-bearing cash account at once. To generate or clear
          interest for a single account, open that account and use its action menu.
        </p>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button
            className="w-full sm:w-auto"
            data-testid="button-sync-all-cash-interest"
            disabled={busy}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending ? (
              <Icons.Spinner className="mr-2 size-4 animate-spin" />
            ) : (
              <Icons.Sparkles className="mr-2 size-4" />
            )}
            Generate interest (all accounts)
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                data-testid="button-remove-all-auto-interest"
                disabled={busy}
              >
                <Icons.Trash className="mr-2 size-4" />
                Remove auto interest (all accounts)
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove auto interest everywhere?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes auto-created interest and MP2 payout activities in every account.
                  Entries you edited yourself are kept. To clear a single account, open that account
                  and use its action menu instead.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="button-remove-all-auto-interest-confirm"
                  onClick={() => removeMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
