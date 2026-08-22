import { Card, CardContent, CardHeader, CardTitle, PrivacyAmount } from "@wealthfolio/ui";
import { formatApyPct, projectCashProduct } from "../lib/projection";

interface ProjectionCardProps {
  monthlyContribution: number;
  apy: number;
  years?: number;
  compounding: boolean;
  currency: string;
  startYear?: number;
  rateHistory?: Record<string, number>;
}

export function ProjectionCard({
  monthlyContribution,
  apy,
  years = 5,
  compounding,
  currency,
  startYear,
  rateHistory,
}: ProjectionCardProps) {
  const projection = projectCashProduct({
    monthlyContribution,
    apy,
    years,
    compounding,
    startYear,
    rateHistory,
  });
  const usesDeclaredRates = projection.years.some((row) => !row.estimated);

  return (
    <Card data-testid="card-mp2-projection">
      <CardHeader>
        <CardTitle className="text-base">
          Projection ({years} years @{" "}
          {usesDeclaredRates ? "declared + assumed rates" : formatApyPct(apy)})
        </CardTitle>
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
