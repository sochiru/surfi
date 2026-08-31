import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, PrivacyAmount } from "@wealthfolio/ui";
import { getActivities } from "@/adapters";
import { isHysaAccount, isMp2Account, parseAccountMeta } from "@/lib/cash-product-meta";
import { ActivityType } from "@/lib/constants";
import { QueryKeys } from "@/lib/query-keys";
import type { Account, ActivityDetails } from "@/lib/types";
import { ProjectionCard } from "./projection-card";
import { useMp2Rates } from "../hooks/use-mp2-rates";
import { rateForYear } from "../lib/dividend-rates";
import { resolveMp2DividendYear } from "../lib/projection";

interface CashProductPanelProps {
  account: Account;
}

function sumByYear(
  activities: ActivityDetails[],
  type: string,
  yearForActivity: (activity: ActivityDetails) => number = (activity) =>
    new Date(activity.date).getFullYear(),
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const activity of activities) {
    if (activity.activityType !== type) continue;
    const key = String(yearForActivity(activity));
    totals[key] = (totals[key] ?? 0) + Number(activity.amount ?? 0);
  }
  return totals;
}

/**
 * Product-specific summary for cash accounts, shown on the account page. MP2
 * additionally gets a maturity projection. The matching contribution, dividend
 * and interest actions live in the page header's action palette.
 */
export function CashProductPanel({ account }: CashProductPanelProps) {
  const year = new Date().getFullYear();
  const product = parseAccountMeta(account.meta).product;
  const isMp2 = isMp2Account(account.meta);
  const isHysa = isHysaAccount(account.meta);
  const compounding = product?.compounding ?? true;

  const { data: mp2Rates } = useMp2Rates();
  const activitiesQuery = useQuery({
    queryKey: [QueryKeys.ACTIVITIES, account.id],
    queryFn: () => getActivities(account.id),
    enabled: Boolean(product?.yield?.enabled),
  });

  const activities = useMemo(() => activitiesQuery.data ?? [], [activitiesQuery.data]);
  const contributionHistory = useMemo(
    () => sumByYear(activities, ActivityType.DEPOSIT),
    [activities],
  );
  const dividendHistory = useMemo(
    () =>
      sumByYear(activities, ActivityType.INTEREST, (activity) => {
        if (!isMp2) return new Date(activity.date).getFullYear();
        return resolveMp2DividendYear(new Date(activity.date), activity.metadata?.mp2DividendYear);
      }),
    [activities, isMp2],
  );
  const creditedInterestHistory = useMemo(
    () => sumByYear(activities, ActivityType.INTEREST),
    [activities],
  );
  const contributionsYtd = contributionHistory[String(year)] ?? 0;
  const interestYtd = creditedInterestHistory[String(year)] ?? 0;

  if (!product?.yield?.enabled) return null;

  const maturity = product.maturityDate;
  // Match the holdings cash tab: MP2 rates are declared in arrears, so show the
  // rate for the last completed year and fall back to the assumed one.
  const effectiveRate =
    isMp2 && mp2Rates ? rateForYear(mp2Rates, year - 1, product.yield.apy) : product.yield.apy;

  // The projection replays every year already on record before assuming anything,
  // so an account opened years ago starts from what it actually holds today.
  const activityYears = Object.keys({ ...contributionHistory, ...dividendHistory }).map(Number);
  if (product.firstContributionDate) {
    activityYears.push(Number(product.firstContributionDate.slice(0, 4)));
  }
  const projectionStartYear = activityYears.length ? Math.min(...activityYears) : year;
  const maturityYear = maturity ? Number(maturity.slice(0, 4)) : projectionStartYear + 5;
  const projectionYears = Math.max(1, maturityYear - projectionStartYear);

  return (
    <>
      <Card data-testid="card-cash-product">
        <CardHeader>
          <CardTitle className="text-base">
            {isMp2 ? "Pag-IBIG MP2" : isHysa ? "Savings interest" : "Fixed-income yield"}
          </CardTitle>
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
          monthlyContribution={0}
          apy={product.yield.apy}
          years={projectionYears}
          rateHistory={mp2Rates?.rates}
          contributionHistory={contributionHistory}
          dividendHistory={dividendHistory}
          startYear={projectionStartYear}
          compounding={compounding}
          currency={account.currency}
        />
      ) : null}
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
