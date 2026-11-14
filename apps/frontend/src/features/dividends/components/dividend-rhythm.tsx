import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wealthfolio/ui";
import { cn } from "@wealthfolio/ui/lib/utils";
import type { DividendRhythm } from "../lib/dividend-outlook";

interface Props {
  rhythm: DividendRhythm | null;
  isLoading?: boolean;
}

export function DividendRhythmCard({ rhythm, isLoading }: Props) {
  const quiet = rhythm?.months.filter((month) => month.quiet) ?? [];
  const firstYear = rhythm?.years[0];
  const lastYear = rhythm?.years.at(-1);

  return (
    <Card>
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="text-lg">Quiet months</CardTitle>
        <CardDescription>
          {rhythm && firstYear != null && lastYear != null
            ? `Months with a payout in fewer than half of ${firstYear}–${lastYear}. Useful when you want income every month.`
            : "Needs two full years of recorded dividends before quiet months stand out."}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {isLoading ? (
          <div className="bg-muted/40 h-16 animate-pulse rounded-md" />
        ) : rhythm == null ? (
          <p className="text-muted-foreground text-sm">Not enough history yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
              {rhythm.months.map((month) => (
                <div
                  key={month.month}
                  className={cn(
                    "rounded-md px-1 py-2 text-center text-xs",
                    month.quiet
                      ? "bg-muted text-muted-foreground"
                      : "bg-chart-1/15 text-foreground",
                  )}
                >
                  <div className="font-medium">{month.label}</div>
                  <div className="tabular-nums">
                    {month.yearsWithIncome}/{month.years}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {quiet.length > 0
                ? `Usually quiet: ${quiet.map((month) => month.label).join(", ")}.`
                : "Payouts landed in every month across these years."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
