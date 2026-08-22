import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PrivacyAmount,
} from "@wealthfolio/ui";
import {
  createActivity,
  getActivities,
  removeAutoInterest,
  syncCashInterestAccount,
} from "@/adapters";
import { isHysaAccount, isMp2Account, parseAccountMeta } from "@/lib/cash-product-meta";
import { ActivityType } from "@/lib/constants";
import { QueryKeys } from "@/lib/query-keys";
import type { Account, ActivityDetails } from "@/lib/types";
import { ProjectionCard } from "./projection-card";
import { RecordDividendDialog } from "./record-dividend-dialog";
import { useMp2Rates } from "../hooks/use-mp2-rates";
import { rateForYear } from "../lib/dividend-rates";

interface CashProductPanelProps {
  account: Account;
}

function ytdSum(activities: ActivityDetails[], type: string, year: number): number {
  return activities
    .filter((a) => a.activityType === type && new Date(a.date).getFullYear() === year)
    .reduce((sum, a) => sum + Number(a.amount ?? 0), 0);
}

/**
 * Product-specific controls for cash accounts, shown on the account page.
 * MP2 additionally gets contribution/dividend entry and a maturity projection.
 */
export function CashProductPanel({ account }: CashProductPanelProps) {
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();
  const product = parseAccountMeta(account.meta).product;
  const isMp2 = isMp2Account(account.meta);
  const isHysa = isHysaAccount(account.meta);
  const compounding = product?.compounding ?? true;

  const [contributeOpen, setContributeOpen] = useState(false);
  const [dividendOpen, setDividendOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: mp2Rates } = useMp2Rates();
  const activitiesQuery = useQuery({
    queryKey: [QueryKeys.ACTIVITIES, account.id],
    queryFn: () => getActivities(account.id),
    enabled: Boolean(product?.yield?.enabled),
  });

  const activities = useMemo(() => activitiesQuery.data ?? [], [activitiesQuery.data]);
  const contributionsYtd = useMemo(
    () => ytdSum(activities, ActivityType.DEPOSIT, year),
    [activities, year],
  );
  const interestYtd = useMemo(
    () => ytdSum(activities, ActivityType.INTEREST, year),
    [activities, year],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.ACTIVITIES] });
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.HOLDINGS] });
  };

  const syncMutation = useMutation({
    mutationFn: () => syncCashInterestAccount(account.id),
    onSuccess: (result) => {
      toast.success(`Generated ${result.created} interest entries`);
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });

  const removeMutation = useMutation({
    mutationFn: removeAutoInterest,
    onSuccess: (count) => {
      toast.success(`Removed ${count} auto interest entries`);
      invalidate();
    },
    onError: (error) => toast.error(String(error)),
  });

  const contributeMutation = useMutation({
    mutationFn: () =>
      createActivity({
        accountId: account.id,
        activityType: ActivityType.DEPOSIT,
        activityDate: new Date(`${activityDate}T00:00:00`),
        amount: Number(amount),
        currency: account.currency,
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

  if (!product?.yield?.enabled) return null;

  const maturity = product.maturityDate;
  // Match the holdings cash tab: MP2 rates are declared in arrears, so show the
  // rate for the last completed year and fall back to the assumed one.
  const effectiveRate =
    isMp2 && mp2Rates ? rateForYear(mp2Rates, year - 1, product.yield.apy) : product.yield.apy;

  return (
    <>
      <Card data-testid="card-cash-product">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            {isMp2 ? "Pag-IBIG MP2" : isHysa ? "Savings interest" : "Fixed-income yield"}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="button-sync-cash-interest"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              Generate interest
            </Button>
            {isMp2 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-mp2-contribute"
                  onClick={() => setContributeOpen(true)}
                >
                  Contribute
                </Button>
                <Button
                  size="sm"
                  data-testid="button-mp2-record-dividend"
                  onClick={() => setDividendOpen(true)}
                >
                  Record dividend
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              data-testid="button-remove-auto-interest"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              Remove auto interest
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Contributions YTD"
            value={
              <PrivacyAmount
                value={contributionsYtd}
                currency={account.currency}
                className="text-xl font-semibold"
              />
            }
          />
          <Stat
            label={isMp2 ? "Dividends YTD" : "Interest YTD"}
            value={
              <PrivacyAmount
                value={interestYtd}
                currency={account.currency}
                className="text-xl font-semibold"
              />
            }
          />
          <Stat
            label="Status"
            value={
              <div className="space-y-0.5 text-sm">
                <p>
                  {(effectiveRate * 100).toFixed(2)}% ·{" "}
                  {compounding ? "Compounding" : "Annual payout"}
                </p>
                {maturity && (
                  <p className="text-muted-foreground">
                    Matures {format(parseISO(maturity), "MMM d, yyyy")}
                  </p>
                )}
              </div>
            }
          />
        </CardContent>
      </Card>

      {isMp2 && product.yield.apy ? (
        <ProjectionCard
          monthlyContribution={contributionsYtd > 0 ? contributionsYtd / 12 : 0}
          apy={product.yield.apy}
          rateHistory={mp2Rates?.rates}
          startYear={year}
          compounding={compounding}
          currency={account.currency}
        />
      ) : null}

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
        compounding={compounding}
        onRecorded={invalidate}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      {value}
    </div>
  );
}
