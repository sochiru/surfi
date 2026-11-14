import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@wealthfolio/ui";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@wealthfolio/ui/components/ui/chart";
import { EmptyPlaceholder } from "@wealthfolio/ui/components/ui/empty-placeholder";
import { useAmountFormatting, useNumberFormatting } from "@wealthfolio/ui";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";
import { useIsMobileViewport } from "@/hooks";
import type { AnnualDividendIncome } from "../lib/dividend-outlook";

const chartConfig: ChartConfig = {
  received: { label: "Received", color: "var(--chart-1)" },
  expected: { label: "Expected", color: "var(--chart-1)" },
};

interface Props {
  rows: AnnualDividendIncome[];
  currency: string;
  isLoading?: boolean;
}

export function DividendAnnualChart({ rows, currency, isLoading }: Props) {
  const isMobile = useIsMobileViewport();
  const { isBalanceHidden } = useBalancePrivacy();
  const { formatAmount } = useAmountFormatting();
  const { formatPercent } = useNumberFormatting();
  const currentYear = rows.at(-1)?.year;
  const data = rows.map((row) => ({
    ...row,
    changeLabel:
      row.change == null ? "" : formatPercent(row.change, { digits: 0, signDisplay: "exceptZero" }),
  }));

  return (
    <Card>
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="text-lg">Income by year</CardTitle>
        <CardDescription>
          Recorded dividends per calendar year, with the change from the year before.
          {currentYear ? ` ${currentYear} adds the payouts still expected.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {isLoading ? (
          <div className="bg-muted/40 h-60 animate-pulse rounded-md" />
        ) : rows.length === 0 ? (
          <EmptyPlaceholder
            title="No recorded dividends yet"
            description="Sync missing dividends or record DIVIDEND activities to see yearly income."
          />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-60 w-full sm:h-64">
            <BarChart data={data} margin={{ top: 24, left: isMobile ? 0 : 8, right: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={isMobile ? 36 : 48}
                tickFormatter={(value: number) =>
                  isBalanceHidden
                    ? ""
                    : Math.abs(value) >= 1000
                      ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
                      : String(value)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                        <span className="text-muted-foreground">
                          {chartConfig[String(name)]?.label ?? String(name)}
                        </span>
                        <span className="text-foreground font-medium tabular-nums">
                          {isBalanceHidden ? "••••" : formatAmount(Number(value), currency)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="received" stackId="year" fill="var(--color-received)" />
              <Bar
                dataKey="expected"
                stackId="year"
                fill="var(--color-expected)"
                fillOpacity={0.4}
                radius={[3, 3, 0, 0]}
              >
                <LabelList
                  dataKey="changeLabel"
                  position="top"
                  className="fill-muted-foreground"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
