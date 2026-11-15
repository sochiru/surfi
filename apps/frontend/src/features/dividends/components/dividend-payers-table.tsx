import type { ReactNode } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
import type {
  DividendPayerRow,
  DividendPayersSummary,
  DividendSectorSlice,
} from "../lib/dividend-outlook";
import { formatYieldPct } from "../lib/dividend-income-summary";
import { DividendSourceBadge } from "./dividend-year-outlook";

interface Props {
  summary: DividendPayersSummary;
  sectors: DividendSectorSlice[];
  currency: string;
  isLoading?: boolean;
}

function shortDate(date: string, withYear = false): string {
  return format(parseISO(date), withYear ? "MMM d, yyyy" : "MMM d");
}

const CONCENTRATION_TOP = 5;
const CONCENTRATION_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function AccountLine({ row }: { row: DividendPayerRow }) {
  if (row.accounts.length === 0) return "No payouts this period";
  if (row.accounts.length === 1) return <bdi>{row.accounts[0]}</bdi>;
  return `${row.accounts.length} accounts`;
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

function ConcentrationBar({ rows, currency }: { rows: DividendPayerRow[]; currency: string }) {
  const { formatPercent } = useNumberFormatting();
  const top = rows.slice(0, CONCENTRATION_TOP);
  const rest = rows.slice(CONCENTRATION_TOP);
  const otherShare = rest.reduce((sum, row) => sum + row.share, 0);
  const otherAmount = rest.reduce((sum, row) => sum + row.received, 0);
  const items = [
    ...top.map((row, index) => ({
      key: row.symbol,
      symbol: row.symbol,
      share: row.share,
      amount: row.received,
      color: CONCENTRATION_COLORS[index] ?? "var(--chart-1)",
    })),
    ...(otherShare > 0
      ? [
          {
            key: "other",
            symbol: "Other",
            share: otherShare,
            amount: otherAmount,
            color: "var(--chart-stone)",
          },
        ]
      : []),
  ].filter((item) => item.share > 0);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">By holding</div>
      <div className="flex h-5 w-full gap-0.5">
        {items.map((item) => (
          <Tooltip key={item.key}>
            <TooltipTrigger
              render={<div />}
              className="h-5 min-w-1 cursor-pointer rounded-lg"
              style={{ flexGrow: item.share, flexBasis: 0, backgroundColor: item.color }}
            />
            <TooltipContent>
              <div className="text-sm font-medium">
                <bdi>{item.symbol}</bdi>
              </div>
              <div className="text-sm font-medium tabular-nums">
                <PrivacyAmount value={item.amount} currency={currency} />
              </div>
              <div className="text-muted-foreground text-xs">
                {formatPercent(item.share, { digits: 0 })} of income
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {items.map((item) => (
          <span key={item.key} className="inline-flex max-w-full min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <bdi>{item.symbol}</bdi>
            <span className="text-muted-foreground tabular-nums">
              {formatPercent(item.share, { digits: 0 })}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SectorBar({ slices, currency }: { slices: DividendSectorSlice[]; currency: string }) {
  const { formatPercent } = useNumberFormatting();
  const items = slices.map((slice, index) => ({
    ...slice,
    swatch:
      slice.id === "unclassified"
        ? "var(--chart-stone)"
        : (slice.color ??
          CONCENTRATION_COLORS[index % CONCENTRATION_COLORS.length] ??
          "var(--chart-1)"),
  }));

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">By sector</div>
      <div className="flex h-5 w-full gap-0.5">
        {items.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={<div />}
              className="h-5 min-w-1 cursor-pointer rounded-lg"
              style={{ flexGrow: item.share, flexBasis: 0, backgroundColor: item.swatch }}
            />
            <TooltipContent>
              <div className="text-sm font-medium">{item.name}</div>
              <div className="text-sm font-medium tabular-nums">
                <PrivacyAmount value={item.amount} currency={currency} />
              </div>
              <div className="text-muted-foreground text-xs">
                {formatPercent(item.share, { digits: 0 })} of income
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {items.map((item) => (
          <span key={item.id} className="inline-flex max-w-full min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: item.swatch }}
            />
            <span className="break-words">{item.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatPercent(item.share, { digits: 0 })}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function NarrowField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-words tabular-nums">{children}</dd>
    </div>
  );
}

function PayerListNarrow({ rows, currency }: { rows: DividendPayerRow[]; currency: string }) {
  const { formatPercent } = useNumberFormatting();

  return (
    <ul className="divide-border divide-y xl:hidden">
      {rows.map((row) => (
        <li key={row.symbol} className="space-y-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <TickerAvatar symbol={row.symbol} className="size-7 shrink-0" />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold">
                  <bdi>{row.symbol}</bdi>
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  <AccountLine row={row} />
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <ChangeCell row={row} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <NarrowField label="Received">
              <PrivacyAmount value={row.received} currency={currency} />
            </NarrowField>
            <NarrowField label="Share">
              <div className="flex items-center gap-2">
                <div className="bg-secondary h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-chart-1 h-full rounded-full"
                    style={{ width: `${row.share * 100}%` }}
                  />
                </div>
                <span className="text-muted-foreground w-10 shrink-0 text-end text-xs tabular-nums">
                  {formatPercent(row.share, { digits: 0 })}
                </span>
              </div>
            </NarrowField>
            <NarrowField label="Next 12 mo">
              <PrivacyAmount value={row.expectedNextYear} currency={currency} />
            </NarrowField>
            <NarrowField label="Yield">{formatYieldPct(row.yieldOnValue)}</NarrowField>
            <NarrowField label="On cost">{formatYieldPct(row.yieldOnCost)}</NarrowField>
            <NarrowField label="Last paid">
              {row.lastPaid ? shortDate(row.lastPaid, true) : "—"}
            </NarrowField>
            <div className="col-span-2 min-w-0">
              <dt className="text-muted-foreground text-xs">Next payout</dt>
              <dd className="text-sm break-words">
                {row.next ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">
                      <PrivacyAmount value={row.next.amount} currency={currency} />
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {shortDate(row.next.date, true)}
                    </span>
                    <DividendSourceBadge source={row.next.source} />
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function DividendPayersTable({ summary, sectors, currency, isLoading }: Props) {
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
      <CardContent className="space-y-4 px-4 sm:px-6">
        {isLoading ? (
          <div className="bg-muted/40 h-48 animate-pulse rounded-md" />
        ) : rows.length === 0 ? (
          <EmptyPlaceholder
            title="No dividends in this period"
            description="Choose a longer period, or sync missing dividends."
          />
        ) : (
          <>
            {rows.length > 1 || sectors.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {rows.length > 1 ? <ConcentrationBar rows={rows} currency={currency} /> : null}
                {sectors.length > 0 ? <SectorBar slices={sectors} currency={currency} /> : null}
              </div>
            ) : null}
            <PayerListNarrow rows={rows} currency={currency} />
            <div className="hidden overflow-x-auto xl:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Holding</TableHead>
                    <TableHead className="text-end">Received</TableHead>
                    <TableHead className="w-40">Share</TableHead>
                    <TableHead className="text-end">Next 12 mo</TableHead>
                    <TableHead className="text-end">Yield</TableHead>
                    <TableHead className="text-end">On cost</TableHead>
                    <TableHead className="text-end">Change</TableHead>
                    <TableHead>Last paid</TableHead>
                    <TableHead>Next payout</TableHead>
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
                              <AccountLine row={row} />
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-end font-medium tabular-nums">
                        <PrivacyAmount value={row.received} currency={currency} />
                      </TableCell>
                      <TableCell className="py-2.5">
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
                      <TableCell className="py-2.5 text-end tabular-nums">
                        {formatYieldPct(row.yieldOnValue)}
                      </TableCell>
                      <TableCell className="py-2.5 text-end tabular-nums">
                        {formatYieldPct(row.yieldOnCost)}
                      </TableCell>
                      <TableCell className="py-2.5 text-end">
                        <ChangeCell row={row} />
                      </TableCell>
                      <TableCell className="text-muted-foreground py-2.5 text-sm">
                        {row.lastPaid ? shortDate(row.lastPaid, true) : "—"}
                      </TableCell>
                      <TableCell className="py-2.5">
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
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
