import { format, parseISO } from "date-fns";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";
import { AmountDisplay } from "@wealthfolio/ui";
import { Card } from "@wealthfolio/ui/components/ui/card";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import type { CashHoldingRow } from "../lib/cash-holdings";

interface CashHoldingsListMobileProps {
  holdings: CashHoldingRow[];
  isLoading: boolean;
  onRowClick?: (row: CashHoldingRow) => void;
}

export function CashHoldingsListMobile({
  holdings,
  isLoading,
  onRowClick,
}: CashHoldingsListMobileProps) {
  const { isBalanceHidden } = useBalancePrivacy();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (holdings.length === 0) return null;

  return (
    <div className="space-y-2">
      {holdings.map((holding) => (
        <Card
          key={holding.accountId}
          className="hover:bg-muted/50 cursor-pointer p-3 transition-colors"
          onClick={() => onRowClick?.(holding)}
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-1 items-center gap-3 overflow-hidden">
              <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <CashProductIcon productType={holding.productType} />
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="truncate font-semibold">{holding.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {holding.productLabel}
                  {holding.rate != null ? ` · ${(holding.rate * 100).toFixed(2)}%` : ""}
                </p>
              </div>
            </div>
            <div className="ml-2 text-right">
              <AmountDisplay
                value={holding.balance}
                currency={holding.currency}
                isHidden={isBalanceHidden}
                className="font-medium"
              />
              {holding.maturityDate && (
                <p className="text-muted-foreground text-xs">
                  {holding.daysToMaturity != null && holding.daysToMaturity > 0
                    ? `Matures ${format(parseISO(holding.maturityDate), "MMM yyyy")}`
                    : "Matured"}
                </p>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function CashProductIcon({ productType }: { productType: CashHoldingRow["productType"] }) {
  switch (productType) {
    case "PAGIBIG_MP2":
      return <Icons.PiggyBank className="h-5 w-5" />;
    case "HYSA":
    case "HYSA_GOAL":
      return <Icons.Wallet className="h-5 w-5" />;
    default:
      return <Icons.DollarSign className="h-5 w-5" />;
  }
}
