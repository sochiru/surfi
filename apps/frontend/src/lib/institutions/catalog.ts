import {
  defaultHysaGoalProduct,
  defaultHysaProduct,
  serializeAccountMeta,
  parseAccountMeta,
  FIXED_INCOME_CATEGORY_ID,
  type CashProductType,
  type ProductConfig,
  todayIsoDate,
} from "@/lib/cash-product-meta";

export const CUSTOM_INSTITUTION_ID = "custom";

export interface CatalogProduct {
  id: string;
  institutionId: string;
  name: string;
  description: string;
  productKind: CashProductType;
  defaultCurrency: string;
  defaultGroup: string;
  suggestedName: string;
  createProduct: () => ProductConfig;
}

export interface CatalogInstitution {
  id: string;
  name: string;
  logoUrl: string;
  products: CatalogProduct[];
}

function catalogProduct(
  type: CashProductType,
  apy: number,
  extras: Partial<ProductConfig["yield"]> & {
    targetAmount?: number;
    withholdingTaxRate?: number;
  } = {},
): ProductConfig {
  const { targetAmount, withholdingTaxRate = 0.2, ...yieldExtras } = extras;
  const base = type === "HYSA_GOAL" ? defaultHysaGoalProduct(apy) : defaultHysaProduct(apy);
  return {
    ...base,
    type,
    targetAmount: targetAmount ?? base.targetAmount,
    yield: {
      ...base.yield,
      withholdingTaxRate,
      startDate: todayIsoDate(),
      ...yieldExtras,
    },
  };
}

export const INSTITUTIONS: CatalogInstitution[] = [
  {
    id: "maya",
    name: "Maya",
    logoUrl: "/institutions/maya.webp",
    products: [
      {
        id: "maya-savings",
        institutionId: "maya",
        name: "Maya Savings",
        description:
          "3% on the full balance, plus an editable boost on the first ₱100,000. If a mission unlocks 10% mid-month, add a rate period from that day so Aug 1–3 can stay at 3%.",
        productKind: "HYSA",
        defaultCurrency: "PHP",
        defaultGroup: "Maya",
        suggestedName: "Maya Savings",
        createProduct: () =>
          catalogProduct("HYSA", 0.05, {
            creditFrequency: "daily",
            dayCount: "actual_365",
            rateTiers: [
              { upTo: 100_000, apy: 0.05 },
              { apy: 0.03 },
            ],
          }),
      },
      {
        id: "maya-personal-goals",
        institutionId: "maya",
        name: "Personal Goals",
        description: "Marginal ₱20,000 bands up to 8% p.a. Nothing earns above ₱100,000.",
        productKind: "HYSA_GOAL",
        defaultCurrency: "PHP",
        defaultGroup: "Maya",
        suggestedName: "Maya Personal Goal",
        createProduct: () =>
          catalogProduct("HYSA_GOAL", 0.08, {
            creditFrequency: "monthly",
            monthlyCreditTiming: "next_month_start",
            dayCount: "actual_365",
            rateTiers: [
              { upTo: 20_000, apy: 0.04 },
              { upTo: 40_000, apy: 0.045 },
              { upTo: 60_000, apy: 0.05 },
              { upTo: 80_000, apy: 0.065 },
              { upTo: 100_000, apy: 0.08 },
            ],
          }),
      },
    ],
  },
  {
    id: "banko",
    name: "BanKo",
    logoUrl: "/institutions/banko.webp",
    products: [
      {
        id: "banko-todo-savings",
        institutionId: "banko",
        name: "TODO Savings",
        description: "5% p.a. from ₱5,000 up to ₱1M, then 0.0625% on the excess.",
        productKind: "HYSA",
        defaultCurrency: "PHP",
        defaultGroup: "BanKo",
        suggestedName: "BanKo TODO Savings",
        createProduct: () =>
          catalogProduct("HYSA", 0.05, {
            creditFrequency: "monthly",
            monthlyCreditTiming: "next_month_start",
            dayCount: "actual_360",
            minimumBalance: 5_000,
            rateTiers: [
              { upTo: 1_000_000, apy: 0.05 },
              { apy: 0.000625 },
            ],
          }),
      },
    ],
  },
  {
    id: "tonik",
    name: "Tonik",
    logoUrl: "/institutions/tonik.webp",
    products: [
      {
        id: "tonik-account",
        institutionId: "tonik",
        name: "Tonik Account",
        description: "Editable APY on actual/actual days. 20% withholding, credited monthly.",
        productKind: "HYSA",
        defaultCurrency: "PHP",
        defaultGroup: "Tonik",
        suggestedName: "Tonik Account",
        createProduct: () =>
          catalogProduct("HYSA", 0.01, {
            creditFrequency: "monthly",
            monthlyCreditTiming: "next_month_start",
            dayCount: "actual_actual",
          }),
      },
      {
        id: "tonik-stash",
        institutionId: "tonik",
        name: "Stash",
        description: "Goal pot with Tonik day-count. Edit the APY for Solo or Group Stash.",
        productKind: "HYSA_GOAL",
        defaultCurrency: "PHP",
        defaultGroup: "Tonik",
        suggestedName: "Tonik Stash",
        createProduct: () =>
          catalogProduct("HYSA_GOAL", 0.04, {
            creditFrequency: "monthly",
            monthlyCreditTiming: "next_month_start",
            dayCount: "actual_actual",
          }),
      },
    ],
  },
  {
    id: "maribank",
    name: "MariBank",
    logoUrl: "/institutions/maribank.webp",
    products: [
      {
        id: "maribank-savings",
        institutionId: "maribank",
        name: "Mari Savings Account",
        description: "0.88% p.a. base on all balances, credited daily. Boost on the first S$100,000 is editable.",
        productKind: "HYSA",
        defaultCurrency: "SGD",
        defaultGroup: "MariBank",
        suggestedName: "Mari Savings",
        createProduct: () =>
          catalogProduct("HYSA", 0.0248, {
            withholdingTaxRate: 0,
            creditFrequency: "daily",
            dayCount: "actual_365",
            rateTiers: [
              { upTo: 100_000, apy: 0.0248 },
              { apy: 0.0088 },
            ],
          }),
      },
      {
        id: "maribank-fixed-deposit",
        institutionId: "maribank",
        name: "Mari Fixed Deposit",
        description: "Locked term with an editable APY. Set the lock date to match your placement.",
        productKind: "HYSA_GOAL",
        defaultCurrency: "SGD",
        defaultGroup: "MariBank",
        suggestedName: "Mari Fixed Deposit",
        createProduct: () =>
          catalogProduct("HYSA_GOAL", 0.025, {
            withholdingTaxRate: 0,
            creditFrequency: "yearly",
            dayCount: "actual_365",
          }),
      },
    ],
  },
];

export function getInstitution(id?: string | null): CatalogInstitution | undefined {
  if (!id || id === CUSTOM_INSTITUTION_ID) return undefined;
  return INSTITUTIONS.find((institution) => institution.id === id);
}

export function getCatalogProduct(productId?: string | null): CatalogProduct | undefined {
  if (!productId) return undefined;
  return INSTITUTIONS.flatMap((institution) => institution.products).find(
    (product) => product.id === productId,
  );
}

export function logoUrlForInstitution(id?: string | null): string | undefined {
  return getInstitution(id)?.logoUrl;
}

export function applyCatalogProduct(
  meta: string | null | undefined,
  product: CatalogProduct,
): string {
  const parsed = parseAccountMeta(meta);
  parsed.allocation = { cashCategoryId: FIXED_INCOME_CATEGORY_ID };
  parsed.product = product.createProduct();
  parsed.institutionId = product.institutionId;
  parsed.productId = product.id;
  return serializeAccountMeta(parsed);
}
