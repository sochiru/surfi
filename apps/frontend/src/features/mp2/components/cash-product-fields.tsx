import type {
  CashProductType,
  CreditFrequency,
  DayCount,
  MonthlyCreditTiming,
  ProductConfig,
  RateTier,
} from "@/lib/cash-product-meta";
import {
  computeMp2Maturity,
  defaultHysaGoalProduct,
  defaultHysaProduct,
  defaultMp2Product,
  headlineApy,
  parseAccountMeta,
  sanitizeRateTiers,
  setProductInMeta,
} from "@/lib/cash-product-meta";
import { Button, Input, Label, Switch } from "@wealthfolio/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wealthfolio/ui/components/ui/select";
import { useState } from "react";
import { Link } from "react-router-dom";

interface CashProductFieldsProps {
  meta?: string | null;
  onMetaChange: (meta: string) => void;
  productKind: CashProductType;
  headingOverride?: { title: string; description: string };
}

const HEADINGS: Record<CashProductType, { title: string; description: string }> = {
  HYSA: {
    title: "High-yield savings",
    description: "Auto-generate interest from APY. Counts as fixed income in allocation.",
  },
  HYSA_GOAL: {
    title: "Goal / mini time deposit",
    description: "Own APY and lock date. Counts as fixed income in allocation.",
  },
  PAGIBIG_MP2: {
    title: "Pag-IBIG MP2",
    description: "Dividends credited yearly. Five-year term from first contribution.",
  },
};

/**
 * Keeps labels, inputs and help text on shared rows so a label that wraps to two
 * lines in one column does not push its input out of line with the next column.
 */
function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 sm:grid-rows-[auto_auto_auto]">
      {children}
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-y-2 sm:row-span-3 sm:grid-rows-subgrid">{children}</div>;
}

/**
 * Percentages are edited as free text so a half-typed value like "4." survives
 * until the field loses focus, instead of being reformatted away mid-keystroke.
 */
function PercentInput({
  id,
  testId,
  value,
  onChange,
}: {
  id: string;
  testId: string;
  value: number;
  onChange: (fraction: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      id={id}
      data-testid={testId}
      type="text"
      inputMode="decimal"
      value={draft ?? (value * 100).toFixed(2)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
        setDraft(raw);
        const percent = Number.parseFloat(raw);
        if (Number.isFinite(percent)) onChange(percent / 100);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function defaultForKind(kind: CashProductType): ProductConfig {
  if (kind === "PAGIBIG_MP2") {
    return defaultMp2Product(new Date().toISOString().slice(0, 10));
  }
  return kind === "HYSA_GOAL" ? defaultHysaGoalProduct() : defaultHysaProduct();
}

function readProduct(meta: string | null | undefined, kind: CashProductType): ProductConfig {
  const existing = parseAccountMeta(meta).product;
  return existing?.type === kind ? existing : defaultForKind(kind);
}

function RateTierEditor({
  tiers,
  fallbackApy,
  onChange,
}: {
  tiers: RateTier[] | undefined;
  fallbackApy: number;
  onChange: (tiers: RateTier[] | undefined, headline: number) => void;
}) {
  const rows = sanitizeRateTiers(tiers);

  const commit = (next: RateTier[]) => {
    const sanitized = sanitizeRateTiers(next);
    onChange(sanitized.length ? sanitized : undefined, headlineApy({
      enabled: true,
      apy: fallbackApy,
      rateTiers: sanitized,
      creditFrequency: "daily",
    }));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Rate tiers</p>
          <p className="text-muted-foreground text-xs">
            Each band earns its own APY. Leave the last limit blank to apply that rate to the rest.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="button-add-rate-tier"
          onClick={() =>
            commit([
              ...rows,
              rows.length
                ? { apy: fallbackApy }
                : { apy: fallbackApy },
            ])
          }
        >
          Add band
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No bands — the single APY above applies to the full balance.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((tier, index) => (
            <div key={`${tier.upTo ?? "uncapped"}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <div>
                {index === 0 ? (
                  <Label htmlFor={`rate-tier-up-to-${index}`}>Up to (optional)</Label>
                ) : null}
                <Input
                  id={`rate-tier-up-to-${index}`}
                  data-testid={`input-rate-tier-up-to-${index}`}
                  type="number"
                  placeholder="Uncapped"
                  value={tier.upTo ?? ""}
                  onChange={(event) => {
                    const next = [...rows];
                    const value = event.target.value;
                    next[index] = {
                      ...tier,
                      upTo: value ? Number(value) : undefined,
                    };
                    commit(next);
                  }}
                />
              </div>
              <div>
                {index === 0 ? <Label htmlFor={`rate-tier-apy-${index}`}>APY (%)</Label> : null}
                <PercentInput
                  id={`rate-tier-apy-${index}`}
                  testId={`input-rate-tier-apy-${index}`}
                  value={tier.apy}
                  onChange={(apy) => {
                    const next = [...rows];
                    next[index] = { ...tier, apy };
                    commit(next);
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={index === 0 ? "mt-6" : ""}
                data-testid={`button-remove-rate-tier-${index}`}
                aria-label={`Remove rate band ${index + 1}`}
                onClick={() => commit(rows.filter((_, rowIndex) => rowIndex !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CashProductFields({
  meta,
  onMetaChange,
  productKind,
  headingOverride,
}: CashProductFieldsProps) {
  const product = readProduct(meta, productKind);
  const isMp2 = productKind === "PAGIBIG_MP2";
  const heading = headingOverride ?? HEADINGS[productKind];

  const update = (patch: Partial<ProductConfig>) => {
    onMetaChange(setProductInMeta(meta, { ...product, type: productKind, ...patch }));
  };

  const updateYield = (patch: Partial<ProductConfig["yield"]>) => {
    update({ yield: { ...product.yield, ...patch } });
  };

  // MP2 maturity is always five years from the first contribution, so the two move together.
  const updateFirstContribution = (date: string) => {
    update({
      firstContributionDate: date || undefined,
      maturityDate: date ? computeMp2Maturity(date) : undefined,
      yield: { ...product.yield, startDate: date || product.yield.startDate },
    });
  };

  return (
    <div className="border-border bg-background dark:bg-muted/20 space-y-4 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{heading.title}</p>
        <p className="text-muted-foreground text-xs">{heading.description}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="yield-enabled">{isMp2 ? "Auto dividends" : "Auto interest"}</Label>
        <Switch
          id="yield-enabled"
          data-testid="switch-yield-enabled"
          checked={product.yield.enabled}
          onCheckedChange={(enabled) => updateYield({ enabled })}
        />
      </div>

      <FieldGrid>
        <Field>
          <Label htmlFor="product-apy">{isMp2 ? "Assumed dividend rate (%)" : "APY (%)"}</Label>
          <PercentInput
            id="product-apy"
            testId="input-product-apy"
            value={product.yield.apy}
            onChange={(apy) => updateYield({ apy })}
          />
        </Field>
        {!isMp2 && (
          <Field>
            <Label>Credit frequency</Label>
            <Select
              value={product.yield.creditFrequency}
              onValueChange={(value) => updateYield({ creditFrequency: value as CreditFrequency })}
            >
              <SelectTrigger data-testid="select-credit-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
        {!isMp2 && product.yield.creditFrequency === "monthly" && (
          <Field>
            <Label>Monthly credit date</Label>
            <Select
              value={product.yield.monthlyCreditTiming ?? "next_month_start"}
              onValueChange={(value) =>
                updateYield({ monthlyCreditTiming: value as MonthlyCreditTiming })
              }
            >
              <SelectTrigger data-testid="select-monthly-credit-timing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month_end">Last day of the month</SelectItem>
                <SelectItem value="next_month_start">First day of the next month</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </FieldGrid>

      {!isMp2 && (
        <RateTierEditor
          tiers={product.yield.rateTiers}
          fallbackApy={product.yield.apy}
          onChange={(rateTiers, headline) => updateYield({ rateTiers, apy: headline })}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="product-compound">
            {isMp2 ? "Compound dividends" : "Compound / reinvest"}
          </Label>
          {isMp2 && (
            <p className="text-muted-foreground text-xs">
              Off = annual payout (dividend is withdrawn on the credit date).
            </p>
          )}
        </div>
        <Switch
          id="product-compound"
          data-testid="switch-product-compound"
          checked={product.compounding}
          onCheckedChange={(compounding) => update({ compounding })}
        />
      </div>

      {productKind === "HYSA_GOAL" && (
        <FieldGrid>
          <Field>
            <Label htmlFor="target-amount">Target amount</Label>
            <Input
              id="target-amount"
              data-testid="input-target-amount"
              type="number"
              value={product.targetAmount ?? ""}
              onChange={(e) =>
                update({ targetAmount: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </Field>
          <Field>
            <Label htmlFor="lock-date">Lock / maturity date</Label>
            <Input
              id="lock-date"
              data-testid="input-lock-date"
              type="date"
              value={product.maturityDate ?? ""}
              onChange={(e) => update({ maturityDate: e.target.value || undefined })}
            />
          </Field>
        </FieldGrid>
      )}

      {isMp2 ? (
        <>
          <FieldGrid>
            <Field>
              <Label htmlFor="mp2-first-date">First contribution date</Label>
              <Input
                id="mp2-first-date"
                data-testid="input-mp2-first-date"
                type="date"
                value={product.firstContributionDate ?? ""}
                onChange={(e) => updateFirstContribution(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="mp2-maturity">Maturity date</Label>
              <Input
                id="mp2-maturity"
                data-testid="input-mp2-maturity"
                type="date"
                value={product.maturityDate ?? ""}
                onChange={(e) => update({ maturityDate: e.target.value || undefined })}
              />
              <p className="text-muted-foreground text-xs">First contribution + 5 years.</p>
            </Field>
          </FieldGrid>
          <div className="space-y-2">
            <Label htmlFor="mp2-number">MP2 account number (optional)</Label>
            <Input
              id="mp2-number"
              data-testid="input-mp2-number"
              value={product.mp2AccountNumber ?? ""}
              onChange={(e) => update({ mp2AccountNumber: e.target.value || undefined })}
            />
          </div>

          <p className="text-muted-foreground text-xs">
            Declared dividend rates are shared by all MP2 accounts — set them in{" "}
            <Link className="underline" to="/settings/mp2">
              Settings → Pag-IBIG MP2
            </Link>
            . The assumed rate above is only used for years Pag-IBIG has not announced yet.
          </p>
        </>
      ) : (
        <FieldGrid>
          <Field>
            <Label htmlFor="yield-start">Accrual start date</Label>
            <Input
              id="yield-start"
              data-testid="input-yield-start"
              type="date"
              value={product.yield.startDate ?? ""}
              onChange={(e) => updateYield({ startDate: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="withholding-tax">Withholding tax (%)</Label>
            <PercentInput
              id="withholding-tax"
              testId="input-withholding-tax"
              value={product.yield.withholdingTaxRate ?? 0}
              onChange={(withholdingTaxRate) => updateYield({ withholdingTaxRate })}
            />
            <p className="text-muted-foreground text-xs">
              Deducted from each credit. 20% for Philippine bank interest.
            </p>
          </Field>
          <Field>
            <Label>Day-count basis</Label>
            <Select
              value={product.yield.dayCount ?? "actual_365"}
              onValueChange={(value) => updateYield({ dayCount: value as DayCount })}
            >
              <SelectTrigger data-testid="select-day-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="actual_actual">Actual / actual (365 or 366)</SelectItem>
                <SelectItem value="actual_365">Actual / 365</SelectItem>
                <SelectItem value="actual_360">Actual / 360</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Tonik uses 365 days, or 366 in a leap year. A 360 basis pays slightly more.
            </p>
          </Field>
          <Field>
            <Label htmlFor="minimum-balance">Minimum balance to earn</Label>
            <Input
              id="minimum-balance"
              data-testid="input-minimum-balance"
              type="number"
              value={product.yield.minimumBalance ?? ""}
              onChange={(e) =>
                updateYield({
                  minimumBalance: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
            <p className="text-muted-foreground text-xs">
              Days below this earn nothing. Leave blank for no minimum.
            </p>
          </Field>
        </FieldGrid>
      )}
    </div>
  );
}
