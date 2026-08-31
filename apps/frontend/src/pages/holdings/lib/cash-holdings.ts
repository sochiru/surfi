import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Mp2DividendRates } from "@/adapters";
import { rateForYear } from "@/features/mp2/lib/dividend-rates";
import { type CashProductType, effectiveApy, parseAccountMeta } from "@/lib/cash-product-meta";
import { AccountType } from "@/lib/constants";
import type { Account, AccountScope, AccountValuation, PortfolioWithAccounts } from "@/lib/types";

export const CASH_PRODUCT_LABELS: Record<CashProductType, string> = {
  HYSA: "High-yield savings",
  HYSA_GOAL: "Savings goal",
  PAGIBIG_MP2: "Pag-IBIG MP2",
};

export interface CashHoldingRow {
  accountId: string;
  name: string;
  currency: string;
  balance: number;
  productType: CashProductType | null;
  /** Product name, or plain "Cash" for accounts with no product configured. */
  productLabel: string;
  /** Effective annual rate, or null when the account earns nothing. */
  rate: number | null;
  maturityDate?: string;
  daysToMaturity: number | null;
  compounding: boolean | null;
  targetAmount?: number;
}

/** Account ids a holdings-page scope selection resolves to, or null for "all". */
export function accountIdsForScope(
  scope: AccountScope,
  portfolios: PortfolioWithAccounts[],
): string[] | null {
  switch (scope.type) {
    case "account":
      return [scope.accountId];
    case "accounts":
      return scope.accountIds;
    case "portfolio":
      return portfolios.find((p) => p.id === scope.portfolioId)?.accountIds ?? [];
    default:
      return null;
  }
}

/**
 * Builds one row per cash account.
 *
 * Balances come from per-account valuations rather than the holdings list:
 * under a multi-account scope the backend merges cash holdings by currency and
 * stamps them with the scope id, which loses the per-account identity this
 * table needs.
 *
 * MP2 rates are declared app-wide and in arrears, so the rate shown is the one
 * for the last completed year, falling back to the account's assumed rate.
 */
export function buildCashHoldingRows(
  accounts: Account[],
  valuations: AccountValuation[],
  mp2Rates?: Mp2DividendRates,
): CashHoldingRow[] {
  const valuationByAccount = new Map(valuations.map((v) => [v.accountId, v]));
  const lastCompletedYear = new Date().getFullYear() - 1;

  return accounts
    .filter((account) => account.accountType === AccountType.CASH)
    .map((account) => {
      const product = parseAccountMeta(account.meta).product;
      const productType = product?.type ?? null;
      const apy = product?.yield?.enabled
        ? productType === "PAGIBIG_MP2" && product.yield.apy != null && mp2Rates
          ? rateForYear(mp2Rates, lastCompletedYear, product.yield.apy)
          : effectiveApy(
              product.yield,
              Number(valuationByAccount.get(account.id)?.cashBalance ?? 0),
            )
        : null;
      const maturityDate = product?.maturityDate;

      return {
        accountId: account.id,
        name: account.name,
        currency: account.currency,
        balance: Number(valuationByAccount.get(account.id)?.cashBalance ?? 0),
        productType,
        productLabel: productType ? CASH_PRODUCT_LABELS[productType] : "Cash",
        rate: apy,
        maturityDate,
        daysToMaturity: maturityDate
          ? differenceInCalendarDays(parseISO(maturityDate), new Date())
          : null,
        compounding: product?.compounding ?? null,
        targetAmount: product?.targetAmount,
      };
    })
    .sort((a, b) => b.balance - a.balance);
}
