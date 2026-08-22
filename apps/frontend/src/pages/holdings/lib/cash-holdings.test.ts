import { describe, expect, test } from "vitest";
import type { Account, AccountValuation, PortfolioWithAccounts } from "@/lib/types";
import { serializeAccountMeta } from "@/lib/cash-product-meta";
import { accountIdsForScope, buildCashHoldingRows } from "./cash-holdings";

function account(id: string, name: string, accountType = "CASH", meta?: string): Account {
  return { id, name, accountType, currency: "PHP", meta } as unknown as Account;
}

function valuation(accountId: string, cashBalance: number): AccountValuation {
  return { accountId, cashBalance } as unknown as AccountValuation;
}

const mp2Meta = serializeAccountMeta({
  product: {
    type: "PAGIBIG_MP2",
    compounding: true,
    yield: { enabled: true, apy: 0.0712, creditFrequency: "yearly" },
    maturityDate: "2030-01-15",
  },
});

describe("buildCashHoldingRows", () => {
  test("keeps only cash accounts and sorts by balance", () => {
    const rows = buildCashHoldingRows(
      [
        account("a", "Savings"),
        account("b", "Brokerage", "SECURITIES"),
        account("c", "MP2", "CASH", mp2Meta),
      ],
      [valuation("a", 100), valuation("b", 999), valuation("c", 500)],
    );

    expect(rows.map((r) => r.accountId)).toEqual(["c", "a"]);
  });

  test("keeps accounts distinct instead of merging them by currency", () => {
    const rows = buildCashHoldingRows(
      [account("m1", "MP2 One", "CASH", mp2Meta), account("m2", "MP2 Two", "CASH", mp2Meta)],
      [valuation("m1", 300), valuation("m2", 200)],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.accountId)).toEqual(["m1", "m2"]);
    expect(rows.map((r) => r.balance)).toEqual([300, 200]);
  });

  test("labels accounts without a product as plain cash and reports no rate", () => {
    const [row] = buildCashHoldingRows([account("a", "Savings")], [valuation("a", 100)]);

    expect(row.productLabel).toBe("Cash");
    expect(row.productType).toBeNull();
    expect(row.rate).toBeNull();
    expect(row.maturityDate).toBeUndefined();
  });

  test("surfaces MP2 product details from account meta", () => {
    const [row] = buildCashHoldingRows(
      [account("c", "MP2", "CASH", mp2Meta)],
      [valuation("c", 500)],
    );

    expect(row.productLabel).toBe("Pag-IBIG MP2");
    expect(row.compounding).toBe(true);
    expect(row.maturityDate).toBe("2030-01-15");
    expect(row.rate).toBe(0.0712);
  });

  test("prefers the declared MP2 rate for the last completed year over the assumed one", () => {
    const lastCompletedYear = new Date().getFullYear() - 1;
    const [row] = buildCashHoldingRows(
      [account("c", "MP2", "CASH", mp2Meta)],
      [valuation("c", 500)],
      { rates: { [String(lastCompletedYear)]: 0.061 } },
    );

    expect(row.rate).toBe(0.061);
  });

  test("falls back to a zero balance when the account has no valuation yet", () => {
    const [row] = buildCashHoldingRows([account("new", "Fresh")], []);

    expect(row.balance).toBe(0);
    expect(row.currency).toBe("PHP");
  });
});

describe("accountIdsForScope", () => {
  const portfolios = [{ id: "p1", accountIds: ["a", "b"] } as unknown as PortfolioWithAccounts];

  test("returns null for the all scope so every cash account is kept", () => {
    expect(accountIdsForScope({ type: "all" }, portfolios)).toBeNull();
  });

  test("resolves account, accounts and portfolio scopes", () => {
    expect(accountIdsForScope({ type: "account", accountId: "a" }, portfolios)).toEqual(["a"]);
    expect(accountIdsForScope({ type: "accounts", accountIds: ["a", "c"] }, portfolios)).toEqual([
      "a",
      "c",
    ]);
    expect(accountIdsForScope({ type: "portfolio", portfolioId: "p1" }, portfolios)).toEqual([
      "a",
      "b",
    ]);
  });

  test("resolves an unknown portfolio to no accounts", () => {
    expect(accountIdsForScope({ type: "portfolio", portfolioId: "nope" }, portfolios)).toEqual([]);
  });
});
