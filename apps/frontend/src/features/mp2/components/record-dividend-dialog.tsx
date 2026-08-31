import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@wealthfolio/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wealthfolio/ui/components/ui/select";
import { toast } from "sonner";
import { selectableYears } from "../lib/dividend-rates";
import { recordMp2Dividend } from "../lib/record-dividend";

interface RecordDividendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  currency: string;
  firstContributionDate?: string;
  compounding: boolean;
  onRecorded: () => void;
}

export function RecordDividendDialog({
  open,
  onOpenChange,
  accountId,
  currency,
  firstContributionDate,
  compounding,
  onRecorded,
}: RecordDividendDialogProps) {
  const [amount, setAmount] = useState("");
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const dividendYears = selectableYears(
    firstContributionDate ? Number(firstContributionDate.slice(0, 4)) : undefined,
  );
  const [dividendYear, setDividendYear] = useState(dividendYears[0]);

  const recordMutation = useMutation({
    mutationFn: async () =>
      recordMp2Dividend({
        accountId,
        currency,
        amount: Number(amount),
        activityDate: new Date(`${activityDate}T00:00:00`),
        dividendYear,
        compounding,
        notes: compounding ? "MP2 dividend (compounded)" : "MP2 dividend (annual payout)",
      }),
    onSuccess: () => {
      toast.success(compounding ? "Dividend recorded" : "Dividend recorded with payout withdrawal");
      onRecorded();
      onOpenChange(false);
      setAmount("");
    },
    onError: (error) => toast.error(String(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-record-mp2-dividend">
        <DialogHeader>
          <DialogTitle>Record MP2 dividend</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Dividend year</Label>
            <Select
              value={String(dividendYear)}
              onValueChange={(value) => setDividendYear(Number(value))}
            >
              <SelectTrigger data-testid="select-mp2-dividend-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dividendYears.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              The year the dividend was earned, even when credited the following year.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dividend-date">Credit date</Label>
            <Input
              id="dividend-date"
              data-testid="input-mp2-dividend-date"
              type="date"
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dividend-amount">Amount ({currency})</Label>
            <Input
              id="dividend-amount"
              data-testid="input-mp2-dividend-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {!compounding && (
            <p className="text-muted-foreground text-xs">
              A matching withdrawal will be posted on{" "}
              {format(new Date(`${activityDate}T00:00:00`), "MMM d, yyyy")} so the MP2 balance stays
              correct.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="button-record-mp2-dividend"
            disabled={recordMutation.isPending || !amount || Number(amount) <= 0}
            onClick={() => recordMutation.mutate()}
          >
            Record dividend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
