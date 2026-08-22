import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { DataTable } from "@wealthfolio/ui/components/ui/data-table";
import { DataTableColumnHeader } from "@wealthfolio/ui/components/ui/data-table/data-table-column-header";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import { AmountDisplay, EmptyPlaceholder } from "@wealthfolio/ui";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";
import type { CashHoldingRow } from "../lib/cash-holdings";

interface CashHoldingsTableProps {
  holdings: CashHoldingRow[];
  isLoading: boolean;
  onRowClick?: (row: CashHoldingRow) => void;
}

export function CashHoldingsTable({ holdings, isLoading, onRowClick }: CashHoldingsTableProps) {
  const { t } = useTranslation();
  const { isBalanceHidden } = useBalancePrivacy();

  const columns: ColumnDef<CashHoldingRow>[] = useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("holdings:account")} />
        ),
        cell: ({ row }) => {
          const holding = row.original;
          const open = () => onRowClick?.(holding);

          return (
            <div
              className={`flex items-center gap-3 ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={open}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open();
                      }
                    }
                  : undefined
              }
            >
              <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
                <CashProductIcon productType={holding.productType} />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{holding.name}</span>
                <span className="text-muted-foreground text-xs">{holding.productLabel}</span>
              </div>
            </div>
          );
        },
        enableSorting: true,
      },
      {
        id: "productLabel",
        accessorKey: "productLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("holdings:type")} />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.productLabel}</span>
        ),
        enableSorting: true,
        // Backs the type filter; the value is already shown under the account name.
        enableHiding: true,
        filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
      },
      {
        id: "rate",
        accessorKey: "rate",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Rate" className="justify-end" />
        ),
        cell: ({ row }) => {
          const { rate, compounding } = row.original;
          if (rate == null) {
            return <div className="text-muted-foreground text-right text-sm">—</div>;
          }
          return (
            <div className="flex flex-col items-end">
              <span className="text-sm font-medium">{(rate * 100).toFixed(2)}%</span>
              {compounding != null && (
                <span className="text-muted-foreground text-xs">
                  {compounding ? "Compounding" : "Payout"}
                </span>
              )}
            </div>
          );
        },
        enableSorting: true,
      },
      {
        id: "maturity",
        accessorKey: "maturityDate",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Maturity" className="justify-end" />
        ),
        cell: ({ row }) => {
          const { maturityDate, daysToMaturity } = row.original;
          if (!maturityDate) {
            return <div className="text-muted-foreground text-right text-sm">—</div>;
          }
          return (
            <div className="flex flex-col items-end">
              <span className="text-sm">{format(parseISO(maturityDate), "MMM d, yyyy")}</span>
              <span className="text-muted-foreground text-xs">
                {daysToMaturity != null && daysToMaturity > 0
                  ? `${daysToMaturity} days left`
                  : "Matured"}
              </span>
            </div>
          );
        },
        enableSorting: true,
      },
      {
        id: "balance",
        accessorKey: "balance",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("holdings:sort_value")}
            className="justify-end"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right">
            <AmountDisplay
              value={row.original.balance}
              currency={row.original.currency}
              isHidden={isBalanceHidden}
              displayCurrency={true}
            />
          </div>
        ),
        enableSorting: true,
      },
    ],
    [isBalanceHidden, onRowClick, t],
  );

  const typeOptions = useMemo(
    () =>
      Array.from(new Set(holdings.map((h) => h.productLabel))).map((label) => ({
        label,
        value: label,
      })),
    [holdings],
  );

  if (isLoading) {
    return (
      <div className="space-y-4 pt-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <EmptyPlaceholder
          icon={<Icons.PiggyBank className="text-muted-foreground h-10 w-10" />}
          title="No cash accounts yet"
          description="Add a cash account to track savings, MP2 and other fixed-income products."
        />
      </div>
    );
  }

  return (
    <DataTable
      data={holdings}
      columns={columns}
      searchBy="name"
      filters={[{ id: "productLabel", title: t("holdings:type"), options: typeOptions }]}
      defaultSorting={[{ id: "balance", desc: true }]}
      defaultColumnVisibility={{ productLabel: false }}
    />
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

export default CashHoldingsTable;
