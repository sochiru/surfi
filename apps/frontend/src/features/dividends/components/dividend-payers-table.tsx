import { format, parseISO } from "date-fns";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  GainPercent,
  PrivacyAmount,
  useNumberFormatting,
} from "@wealthfolio/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wealthfolio/ui/components/ui/table";
import { EmptyPlaceholder } from "@wealthfolio/ui/components/ui/empty-placeholder";
import { TickerAvatar } from "@/components/ticker-avatar";
import type { DividendPayerRow, DividendPayersSummary } from "../lib/dividend-outlook";
import { formatYieldPct } from "../lib/dividend-income-summary";
import { DividendSourceBadge } from "./dividend-year-outlook";

interface Props {
  summary: DividendPayersSummary;
  currency: string;
  isLoading?: boolean;
}

function shortDate(date: string, withYear = false): string {
  return format(parseISO(date), withYear ? "MMM d, yyyy" : "MMM d");
}

function ChangeCell({ row }: { row: DividendPayerRow }) {
  if (row.status === "stopped") return <Badge variant="destructive-subtle">Stopped</Badge>;
  if (row.status === "new") return <Badge variant="success-subtle">New</Badge>;
  if (row.change == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center justify-end gap-1.5">
      {row.status === "down" ? <Badge variant="warning-subtle">Down</Badge> : null}
      <GainPercent value={row.change} className="text-xs" />
    </div>
  );
}

export function DividendPayersTable({ summary, currency, isLoading }: Props) {
  const { formatPercent } = useNumberFormatting();
  const { rows, previous, topThreeShare } = summary;

  const comparison = previous
    ? `Change compares with ${shortDate(previous.from, true)} – ${shortDate(previous.to, true)} and includes shares bought or sold.`
    : "All time has no earlier period to compare.";

  return (
    <Card>
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="text-lg">Paying holdings</CardTitle>
        <CardDescription>
          Income per holding in the selected period. Yield uses the last 12 months of cash. Next 12
          mo includes announced and estimated payouts. {comparison}
          {rows.length > 3 && topThreeShare > 0
            ? ` Your top 3 holdings paid ${formatPercent(topThreeShare, { digits: 0 })} of it.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-2">
        {isLoading ? (
          <div className="bg-muted/40 mx-4 h-48 animate-pulse rounded-md sm:mx-4" />
        ) : rows.length === 0 ? (
          <div className="px-4">
            <EmptyPlaceholder
              title="No dividends in this period"
              description="Choose a longer period, or sync missing dividends."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holding</TableHead>
                <TableHead className="text-end">Received</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Share</TableHead>
                <TableHead className="text-end">Next 12 mo</TableHead>
                <TableHead className="hidden text-end md:table-cell">Yield</TableHead>
                <TableHead className="hidden text-end xl:table-cell">On cost</TableHead>
                <TableHead className="text-end">Change</TableHead>
                <TableHead className="hidden lg:table-cell">Last paid</TableHead>
                <TableHead className="hidden sm:table-cell">Next payout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.symbol}>
                  <TableCell className="py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TickerAvatar symbol={row.symbol} className="size-7 shrink-0" />
                      <div className="min-w-0 leading-tight">
                        <p className="truncate text-sm font-semibold">
                          <bdi>{row.symbol}</bdi>
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {row.accounts.length === 0 ? (
                            "No payouts this period"
                          ) : row.accounts.length === 1 ? (
                            <bdi>{row.accounts[0]}</bdi>
                          ) : (
                            `${row.accounts.length} accounts`
                          )}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 text-end font-medium tabular-nums">
                    <PrivacyAmount value={row.received} currency={currency} />
                  </TableCell>
                  <TableCell className="hidden py-2.5 md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="bg-secondary h-1.5 flex-1 overflow-hidden rounded-full">
                        <div
                          className="bg-chart-1 h-full rounded-full"
                          style={{ width: `${row.share * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-10 text-end text-xs tabular-nums">
                        {formatPercent(row.share, { digits: 0 })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 text-end tabular-nums">
                    <PrivacyAmount value={row.expectedNextYear} currency={currency} />
                  </TableCell>
                  <TableCell className="hidden py-2.5 text-end tabular-nums md:table-cell">
                    {formatYieldPct(row.yieldOnValue)}
                  </TableCell>
                  <TableCell className="hidden py-2.5 text-end tabular-nums xl:table-cell">
                    {formatYieldPct(row.yieldOnCost)}
                  </TableCell>
                  <TableCell className="py-2.5 text-end">
                    <ChangeCell row={row} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden py-2.5 text-sm lg:table-cell">
                    {row.lastPaid ? shortDate(row.lastPaid, true) : "—"}
                  </TableCell>
                  <TableCell className="hidden py-2.5 sm:table-cell">
                    {row.next ? (
                      <div className="flex items-center gap-2">
                        <div className="leading-tight">
                          <p className="text-sm tabular-nums">
                            <PrivacyAmount value={row.next.amount} currency={currency} />
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {shortDate(row.next.date, true)}
                          </p>
                        </div>
                        <DividendSourceBadge source={row.next.source} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
