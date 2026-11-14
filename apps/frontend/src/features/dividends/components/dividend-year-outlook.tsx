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
} from "@wealthfolio/ui";
import { TickerAvatar } from "@/components/ticker-avatar";
import type { DividendEstimateSource, DividendYearOutlook } from "../lib/dividend-outlook";
import { UnconvertedDividendNotice } from "./dividend-income-chart";

const NEXT_PAYOUTS_SHOWN = 6;

interface Props {
  outlook: DividendYearOutlook;
  currency: string;
  isLoading?: boolean;
}

export function DividendSourceBadge({ source }: { source: DividendEstimateSource }) {
  return source === "announced" ? (
    <Badge variant="info-subtle">Announced</Badge>
  ) : (
    <Badge variant="warning-subtle">Estimated</Badge>
  );
}

function ChangeLine({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {value != null ? (
        <GainPercent value={value} className="text-start text-xs" />
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function DividendYearOutlookCard({ outlook, currency, isLoading }: Props) {
  const {
    year,
    receivedYtd,
    expectedAnnounced,
    expectedEstimated,
    expectedCount,
    projected,
    lastYear,
    lastYearSameDates,
    changeVsLastYear,
    changeSameDates,
    next90Days,
    unconvertedCurrencies,
  } = outlook;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="px-4 pb-2 sm:px-6">
          <CardTitle className="text-lg">{year} outlook</CardTitle>
          <CardDescription>Loading expected dividends…</CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="bg-muted/40 h-40 animate-pulse rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // The bar spans the larger of this year's projection and last year's total, so the
  // last-year marker always fits.
  const scale = Math.max(projected, lastYear, 1);
  const pct = (value: number) => `${(value / scale) * 100}%`;
  const expected = expectedAnnounced + expectedEstimated;

  return (
    <Card>
      <CardHeader className="px-4 pb-2 sm:px-6">
        <CardTitle className="text-lg">{year} outlook</CardTitle>
        <CardDescription>
          Received so far plus payouts expected through Dec 31. Estimates use your current shares.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 sm:px-6">
        <UnconvertedDividendNotice currencies={unconvertedCurrencies} baseCurrency={currency} />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <div className="text-muted-foreground text-xs">Projected {year}</div>
              <div className="text-2xl font-semibold tabular-nums">
                <PrivacyAmount value={projected} currency={currency} />
              </div>
              <ChangeLine
                value={changeVsLastYear}
                label={lastYear > 0 ? `vs ${year - 1} total` : `No ${year - 1} income to compare`}
              />
            </div>

            <div className="space-y-1.5">
              <div
                className="bg-secondary relative h-3 w-full overflow-hidden rounded-full"
                role="img"
                aria-label={`Received and expected dividends for ${year}, compared with ${year - 1}`}
              >
                <div className="absolute inset-y-0 start-0 flex w-full">
                  <div className="bg-chart-1 h-full" style={{ width: pct(receivedYtd) }} />
                  <div className="bg-chart-1/40 h-full" style={{ width: pct(expected) }} />
                </div>
                {lastYear > 0 ? (
                  <div
                    className="bg-foreground absolute inset-y-0 w-0.5"
                    style={{ insetInlineStart: `min(${pct(lastYear)}, calc(100% - 2px))` }}
                  />
                ) : null}
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="bg-chart-1 size-2 rounded-full" />
                  Received
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="bg-chart-1/40 size-2 rounded-full" />
                  Expected
                </span>
                {lastYear > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="bg-foreground h-2.5 w-0.5" />
                    {year - 1} total
                  </span>
                ) : null}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Received so far</dt>
                <dd className="font-medium tabular-nums">
                  <PrivacyAmount value={receivedYtd} currency={currency} />
                </dd>
                <ChangeLine
                  value={changeSameDates}
                  label={
                    lastYearSameDates > 0
                      ? "vs same dates last year"
                      : "Nothing same dates last year"
                  }
                />
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">
                  Expected · {expectedCount} payout{expectedCount === 1 ? "" : "s"}
                </dt>
                <dd className="font-medium tabular-nums">
                  <PrivacyAmount value={expected} currency={currency} />
                </dd>
                <p className="text-muted-foreground text-xs tabular-nums">
                  <PrivacyAmount value={expectedAnnounced} currency={currency} /> announced ·{" "}
                  <PrivacyAmount value={expectedEstimated} currency={currency} /> estimated
                </p>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{year - 1} total</dt>
                <dd className="font-medium tabular-nums">
                  <PrivacyAmount value={lastYear} currency={currency} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{year - 1} by today</dt>
                <dd className="font-medium tabular-nums">
                  <PrivacyAmount value={lastYearSameDates} currency={currency} />
                </dd>
              </div>
            </dl>
          </div>

          <div className="min-w-0">
            <div className="mb-2 text-sm font-medium">Next 90 days</div>
            {next90Days.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No payouts expected in the next 90 days.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {next90Days.slice(0, NEXT_PAYOUTS_SHOWN).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TickerAvatar symbol={row.symbol} className="size-7 shrink-0" />
                      <div className="min-w-0 leading-tight">
                        <p className="truncate text-sm font-semibold">
                          <bdi>{row.symbol}</bdi>
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {format(parseISO(row.date), "EEE, MMM d")} · <bdi>{row.accountName}</bdi>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums">
                        <PrivacyAmount value={row.amount} currency={currency} />
                      </span>
                      <DividendSourceBadge source={row.source} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {next90Days.length > NEXT_PAYOUTS_SHOWN ? (
              <p className="text-muted-foreground pt-2 text-xs">
                +{next90Days.length - NEXT_PAYOUTS_SHOWN} more in the calendar below
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
