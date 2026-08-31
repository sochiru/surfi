import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PrivacyAmount,
} from "@wealthfolio/ui";
import { formatApyPct, projectCashProduct } from "../lib/projection";

interface ProjectionCardProps {
  monthlyContribution: number;
  apy: number;
  years?: number;
  compounding: boolean;
  currency: string;
  startYear?: number;
  rateHistory?: Record<string, number>;
  contributionHistory?: Record<string, number>;
  dividendHistory?: Record<string, number>;
}

export function ProjectionCard({
  monthlyContribution,
  apy,
  years = 5,
  compounding,
  currency,
  startYear,
  rateHistory,
  contributionHistory,
  dividendHistory,
}: ProjectionCardProps) {
  const projection = projectCashProduct({
    monthlyContribution,
    apy,
    years,
    compounding,
    startYear,
    rateHistory,
    contributionHistory,
    dividendHistory,
  });
  const recordedYears = projection.years.filter((row) => row.recorded).length;
  const remainingYears = projection.years.length - recordedYears;
  const usesDeclaredRates = projection.years.some((row) => !row.recorded && !row.estimated);
  const lastYear = projection.years.at(-1)?.calendarYear;

  return (
    <Card data-testid="card-mp2-projection">
      <CardHeader>
        <CardTitle className="text-base">
          Projection{lastYear ? ` through ${lastYear}` : ""}
        </CardTitle>
        <CardDescription>
          {recordedYears > 0 && `${recordedYears} ${plural(recordedYears, "year")} recorded · `}
          {remainingYears} {plural(remainingYears, "year")} @{" "}
          {usesDeclaredRates ? "declared + assumed rates" : formatApyPct(apy)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground text-xs">Final balance</p>
          <PrivacyAmount
            value={projection.finalBalance}
            currency={currency}
            className="font-medium"
          />
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Total dividends</p>
          <PrivacyAmount
            value={projection.totalDividends}
            currency={currency}
            className="font-medium"
          />
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{compounding ? "Mode" : "Paid out"}</p>
          <p className="font-medium">
            {compounding ? (
              "Compounding"
            ) : (
              <PrivacyAmount value={projection.totalPaidOut} currency={currency} />
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
