export const FIXED_INCOME_CATEGORY_ID = "FIXED_INCOME";

export type CashProductType = "HYSA" | "HYSA_GOAL" | "PAGIBIG_MP2";
export type CreditFrequency = "daily" | "monthly" | "yearly";
export type MonthlyCreditTiming = "month_end" | "next_month_start";
export type DayCount = "actual_actual" | "actual_365" | "actual_360";

/** Marginal band. Omit `upTo` for an uncapped row. */
export interface RateTier {
  upTo?: number;
  apy: number;
}

export interface YieldConfig {
  enabled: boolean;
  /**
   * Assumed rate, used for any year the provider has not declared yet.
   * Declared MP2 rates are app-wide — see `features/mp2/lib/dividend-rates`.
   * Flat rate when `rateTiers` is empty.
   */
  apy: number;
  /** Marginal APY bands. Empty/omitted means the single `apy` applies to the full balance. */
  rateTiers?: RateTier[];
  creditFrequency: CreditFrequency;
  /** Date used for monthly credits. Defaults to the first day of the next month. */
  monthlyCreditTiming?: MonthlyCreditTiming;
  /**
   * Final withholding deducted from each credit, as a fraction (0.2 = 20%).
   * Philippine bank interest is taxed at 20%; MP2 dividends are exempt.
   */
  withholdingTaxRate?: number;
  /** Balance the account must hold on a given day to earn anything that day. */
  minimumBalance?: number;
  /** A 360 basis pays slightly more per day than 365 for the same quoted rate. */
  dayCount?: DayCount;
  startDate?: string;
}

export interface ProductConfig {
  type: CashProductType;
  compounding: boolean;
  yield: YieldConfig;
  targetAmount?: number;
  firstContributionDate?: string;
  maturityDate?: string;
  mp2AccountNumber?: string;
}

export interface AccountProductMeta {
  allocation?: { cashCategoryId?: string };
  product?: ProductConfig;
  institutionId?: string;
  productId?: string;
}

export function parseAccountMeta(meta?: string | null): AccountProductMeta {
  if (!meta?.trim()) return {};
  try {
    return JSON.parse(meta) as AccountProductMeta;
  } catch {
    return {};
  }
}

export function serializeAccountMeta(meta: AccountProductMeta): string {
  return JSON.stringify(meta);
}

export function getProductType(meta?: string | null): CashProductType | null {
  const type = parseAccountMeta(meta).product?.type;
  return type ?? null;
}

export function isMp2Account(meta?: string | null): boolean {
  return getProductType(meta) === "PAGIBIG_MP2";
}

export function isHysaAccount(meta?: string | null): boolean {
  const type = getProductType(meta);
  return type === "HYSA" || type === "HYSA_GOAL";
}

export function isHysaGoalAccount(meta?: string | null): boolean {
  return getProductType(meta) === "HYSA_GOAL";
}

export function isCashProductAccount(meta?: string | null): boolean {
  return getProductType(meta) != null;
}

export function computeMp2Maturity(firstContributionDate: string): string {
  const [year, month, day] = firstContributionDate.split("-").map(Number);
  return `${year + 5}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function setCashCategoryInMeta(
  meta: string | null | undefined,
  categoryId: string | null,
): string {
  const parsed = parseAccountMeta(meta);
  if (categoryId) {
    parsed.allocation = { cashCategoryId: categoryId };
  } else {
    delete parsed.allocation;
  }
  return serializeAccountMeta(parsed);
}

export function setProductInMeta(
  meta: string | null | undefined,
  product: ProductConfig | null,
): string {
  const parsed = parseAccountMeta(meta);
  if (product) {
    parsed.product = product;
    parsed.allocation = { cashCategoryId: FIXED_INCOME_CATEGORY_ID };
  } else {
    delete parsed.product;
  }
  return serializeAccountMeta(parsed);
}

export function setCatalogSelectionInMeta(
  meta: string | null | undefined,
  institutionId: string | null,
  productId: string | null,
): string {
  const parsed = parseAccountMeta(meta);
  if (institutionId) {
    parsed.institutionId = institutionId;
  } else {
    delete parsed.institutionId;
  }
  if (productId) {
    parsed.productId = productId;
  } else {
    delete parsed.productId;
  }
  return serializeAccountMeta(parsed);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultYield(apy: number, frequency: CreditFrequency = "daily"): YieldConfig {
  return {
    enabled: true,
    apy,
    creditFrequency: frequency,
    monthlyCreditTiming: "next_month_start",
    dayCount: "actual_365",
    startDate: todayIsoDate(),
  };
}

export function defaultHysaProduct(
  apy = 0.045,
  frequency: CreditFrequency = "daily",
): ProductConfig {
  return {
    type: "HYSA",
    compounding: true,
    yield: defaultYield(apy, frequency),
  };
}

export function defaultHysaGoalProduct(
  apy = 0.05,
  targetAmount?: number,
  maturityDate?: string,
): ProductConfig {
  return {
    type: "HYSA_GOAL",
    compounding: true,
    yield: defaultYield(apy, "daily"),
    targetAmount,
    maturityDate,
  };
}

export function defaultCashProduct(type: CashProductType): ProductConfig {
  if (type === "PAGIBIG_MP2") {
    return defaultMp2Product(todayIsoDate());
  }
  return type === "HYSA_GOAL" ? defaultHysaGoalProduct() : defaultHysaProduct();
}

export function defaultMp2Product(
  firstContributionDate: string,
  compounding = true,
  apy = 0.0712,
): ProductConfig {
  return {
    type: "PAGIBIG_MP2",
    compounding,
    yield: {
      enabled: true,
      apy,
      creditFrequency: "yearly",
      dayCount: "actual_365",
      startDate: firstContributionDate,
    },
    firstContributionDate,
    maturityDate: computeMp2Maturity(firstContributionDate),
  };
}

export function sanitizeRateTiers(tiers: RateTier[] | undefined): RateTier[] {
  if (!tiers?.length) return [];
  const normalized = tiers
    .map((tier) => ({
      upTo: tier.upTo != null && tier.upTo > 0 ? tier.upTo : undefined,
      apy: Math.max(0, tier.apy),
    }))
    .sort((a, b) => {
      if (a.upTo == null && b.upTo == null) return 0;
      if (a.upTo == null) return 1;
      if (b.upTo == null) return -1;
      return a.upTo - b.upTo;
    });
  const unique: RateTier[] = [];
  for (const tier of normalized) {
    const last = unique[unique.length - 1];
    if (last && last.upTo === tier.upTo) {
      unique[unique.length - 1] = tier;
    } else {
      unique.push(tier);
    }
  }
  return unique;
}

export function headlineApy(yieldConfig: YieldConfig): number {
  const tiers = sanitizeRateTiers(yieldConfig.rateTiers);
  if (!tiers.length) return yieldConfig.apy;
  return Math.max(...tiers.map((tier) => tier.apy), 0);
}

export function effectiveApy(yieldConfig: YieldConfig, balance: number): number {
  const minimum = yieldConfig.minimumBalance ?? 0;
  if (balance <= 0 || balance < minimum) return 0;
  const tiers = sanitizeRateTiers(yieldConfig.rateTiers);
  if (!tiers.length) return yieldConfig.apy;
  let previous = 0;
  let weighted = 0;
  for (const tier of tiers) {
    if (balance <= previous) break;
    const ceiling = tier.upTo ?? balance;
    if (ceiling <= previous) continue;
    const slice = Math.min(balance, ceiling) - previous;
    if (slice > 0) weighted += slice * tier.apy;
    previous = ceiling;
    if (tier.upTo == null) break;
  }
  return weighted / balance;
}
