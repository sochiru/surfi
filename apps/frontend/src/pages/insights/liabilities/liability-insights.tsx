import { useMemo } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useAlternativeHoldings } from "@/hooks/use-alternative-assets";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";
import type { AlternativeAssetHolding } from "@/lib/types";
import { AmountDisplay, EmptyPlaceholder, Icons, buttonVariants } from "@wealthfolio/ui";
import { Badge } from "@wealthfolio/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui/components/ui/card";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isRevolvingLiability(subtype: string | undefined): boolean {
  return subtype === "credit_card" || subtype === "heloc";
}

function projectionNumber(metadata: Record<string, unknown>, key: string): number | null {
  const projection = metadata.loan_projection;
  if (!projection || typeof projection !== "object") return null;
  return metadataNumber(projection as Record<string, unknown>, key);
}

function currentRate(metadata: Record<string, unknown>): number | null {
  return projectionNumber(metadata, "annualRate") ?? metadataNumber(metadata, "interest_rate");
}

function monthlyPayment(metadata: Record<string, unknown>): number | null {
  return projectionNumber(metadata, "paymentAmount") ?? metadataNumber(metadata, "monthly_payment");
}

/** True once a recorded lock-in date has passed and no later rate change exists. */
function rateReviewDue(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  const maturity = metadata.renewal_maturity_date;
  if (typeof maturity !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(maturity)) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (maturity >= today) return false;
  const events = Array.isArray(metadata.loan_events) ? metadata.loan_events : [];
  return !events.some((event) => {
    if (!event || typeof event !== "object") return false;
    const record = event as Record<string, unknown>;
    return (
      record.type === "rate_change" &&
      typeof record.effectiveDate === "string" &&
      record.effectiveDate > maturity
    );
  });
}

function paydownPercent(holding: AlternativeAssetHolding): number | null {
  const metadata = holding.metadata ?? {};
  const original =
    metadataNumber(metadata, "original_amount") ?? metadataNumber(metadata, "purchase_price");
  const balance = Math.abs(Number(holding.marketValue));
  if (!original || original <= 0 || !Number.isFinite(balance)) return null;
  return Math.max(0, Math.min(100, ((original - balance) / original) * 100));
}

export function LiabilityInsights() {
  const { t } = useTranslation();
  const { isBalanceHidden } = useBalancePrivacy();
  const { data: holdings = [], isLoading } = useAlternativeHoldings();

  const liabilities = useMemo(
    () => holdings.filter((holding) => holding.kind.toLowerCase() === "liability"),
    [holdings],
  );
  const installmentLoans = useMemo(
    () =>
      liabilities.filter((holding) => {
        const metadata = holding.metadata ?? {};
        const subtype = (metadata.sub_type ?? metadata.liability_type) as string | undefined;
        return !isRevolvingLiability(subtype);
      }),
    [liabilities],
  );
  const rateUpdatesDue = installmentLoans.filter((holding) =>
    rateReviewDue(holding.metadata),
  ).length;
  const paydownValues = installmentLoans
    .map(paydownPercent)
    .filter((value): value is number => value != null);
  const averagePaydown =
    paydownValues.length > 0
      ? paydownValues.reduce((sum, value) => sum + value, 0) / paydownValues.length
      : null;
  const paymentsByCurrency = installmentLoans.reduce<Record<string, number>>((totals, holding) => {
    const payment = monthlyPayment(holding.metadata ?? {});
    if (payment != null) {
      totals[holding.currency] = (totals[holding.currency] ?? 0) + payment;
    }
    return totals;
  }, {});

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (liabilities.length === 0) {
    return (
      <EmptyPlaceholder
        icon={<Icons.TrendingDown className="text-muted-foreground h-10 w-10" />}
        title={t("insights:liabilities.empty_title")}
        description={t("insights:liabilities.empty_description")}
      >
        <Link to="/holdings?tab=liabilities" className={buttonVariants({ size: "sm" })}>
          {t("insights:liabilities.add_liability")}
        </Link>
      </EmptyPlaceholder>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label={t("insights:liabilities.installment_loans")}
          value={String(installmentLoans.length)}
          icon={<Icons.TrendingDown className="h-4 w-4" />}
        />
        <SummaryCard
          label={t("insights:liabilities.average_paid_down")}
          value={averagePaydown == null ? "—" : `${averagePaydown.toFixed(1)}%`}
          icon={<Icons.CircleGauge className="h-4 w-4" />}
        />
        <SummaryCard
          label={t("insights:liabilities.rate_updates_due")}
          value={String(rateUpdatesDue)}
          icon={<Icons.Calendar className="h-4 w-4" />}
          destructive={rateUpdatesDue > 0}
        />
      </div>

      {Object.keys(paymentsByCurrency).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("insights:liabilities.monthly_payments")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-6 gap-y-2">
            {Object.entries(paymentsByCurrency).map(([currency, amount]) => (
              <AmountDisplay
                key={currency}
                value={amount}
                currency={currency}
                isHidden={isBalanceHidden}
                className="text-lg font-semibold"
              />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {liabilities.map((holding) => (
          <LiabilityCard key={holding.id} holding={holding} />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  destructive = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-muted-foreground text-sm">{label}</p>
          <p
            className={
              destructive ? "text-destructive text-2xl font-semibold" : "text-2xl font-semibold"
            }
          >
            {value}
          </p>
        </div>
        <div className="bg-muted text-muted-foreground rounded-full p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

function LiabilityCard({ holding }: { holding: AlternativeAssetHolding }) {
  const { t } = useTranslation();
  const { isBalanceHidden } = useBalancePrivacy();
  const metadata = holding.metadata ?? {};
  const subtype = (metadata.sub_type ?? metadata.liability_type) as string | undefined;
  const revolving = isRevolvingLiability(subtype);
  const rate = currentRate(metadata);
  const payment = monthlyPayment(metadata);
  const term =
    projectionNumber(metadata, "paymentCount") ?? metadataNumber(metadata, "original_term_months");
  const paidDown = paydownPercent(holding);
  const reviewDue = rateReviewDue(metadata);
  const lockIn =
    typeof metadata.renewal_maturity_date === "string" ? metadata.renewal_maturity_date : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              <Link to={`/holdings/${encodeURIComponent(holding.id)}`} className="hover:underline">
                {holding.name}
              </Link>
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{holding.symbol}</p>
          </div>
          {revolving ? (
            <Badge variant="secondary">{t("insights:liabilities.snapshot_only")}</Badge>
          ) : reviewDue ? (
            <Badge variant="destructive">{t("insights:liabilities.rate_due")}</Badge>
          ) : (
            <Badge variant="secondary">{t("insights:liabilities.auto_amortizing")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-muted-foreground text-xs">
            {t("insights:liabilities.current_balance")}
          </p>
          <AmountDisplay
            value={Math.abs(Number(holding.marketValue))}
            currency={holding.currency}
            isHidden={isBalanceHidden}
            className="text-xl font-semibold"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Metric
            label={t("insights:liabilities.interest_rate")}
            value={rate == null ? "—" : `${rate}%`}
          />
          <Metric
            label={t("insights:liabilities.monthly_payment")}
            value={
              payment == null ? (
                "—"
              ) : (
                <AmountDisplay
                  value={payment}
                  currency={holding.currency}
                  isHidden={isBalanceHidden}
                />
              )
            }
          />
          <Metric
            label={t("insights:liabilities.loan_term")}
            value={term == null ? "—" : t("insights:liabilities.months", { count: term })}
          />
          <Metric
            label={t("insights:liabilities.next_rate_review")}
            value={lockIn ? format(new Date(`${lockIn}T00:00:00`), "MMM d, yyyy") : "—"}
          />
        </div>

        {paidDown != null && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{t("insights:liabilities.paid_down")}</span>
              <span>{paidDown.toFixed(1)}%</span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div className="bg-primary h-full rounded-full" style={{ width: `${paidDown}%` }} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="font-medium">{value}</div>
    </div>
  );
}
