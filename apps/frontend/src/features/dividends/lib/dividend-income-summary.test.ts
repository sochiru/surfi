import { describe, expect, it } from "vitest";
import type { DividendCalendarEvent } from "@/adapters";
import type { Holding } from "@/lib/types";
import {
  buildDividendFxTable,
  buildDividendIncomeSummary,
  convertDividendToBase,
} from "./dividend-income-summary";

function holding(partial: Partial<Holding> & Pick<Holding, "localCurrency" | "fxRate">): Holding {
  return {
    id: partial.instrument?.symbol ?? partial.localCurrency,
    holdingType: "security",
    accountId: "acct",
    quantity: 1,
    baseCurrency: "PHP",
    marketValue: { local: 0, base: 0 },
    weight: null,
    asOfDate: "2026-11-14",
    ...partial,
  };
}

function event(
  partial: Pick<DividendCalendarEvent, "id" | "date" | "kind" | "displayAmount"> &
    Partial<DividendCalendarEvent>,
): DividendCalendarEvent {
  return {
    symbol: "AC",
    accountId: "acct",
    accountName: "Brokerage",
    currency: "PHP",
    ...partial,
  };
}

describe("buildDividendIncomeSummary period and grouping", () => {
  const now = new Date(2026, 10, 14);
  const events = [
    event({ id: "old", date: "2024-03-10", kind: "posted", displayAmount: 1000 }),
    event({ id: "a", date: "2026-01-10", kind: "posted", displayAmount: 100 }),
    event({
      id: "b",
      date: "2026-02-10",
      kind: "posted",
      displayAmount: 50,
      symbol: "BPI",
      accountId: "acct-2",
      accountName: "Second",
    }),
    event({ id: "c", date: "2026-03-10", kind: "posted", displayAmount: 30, symbol: "BPI" }),
    event({ id: "est", date: "2026-12-01", kind: "upcoming_estimated", displayAmount: 999 }),
  ];

  it("totals only posted payouts inside the period", () => {
    const summary = buildDividendIncomeSummary(events, [], "PHP", {
      bounds: { from: "2026-01-01", to: "2026-03-31" },
      now,
    });
    expect(summary.received).toBe(180);
    expect(summary.payoutCount).toBe(3);
    expect(summary.payerCount).toBe(2);
    expect(summary.chartData.map((row) => row.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(summary.ytd).toBe(180);
  });

  it("starts an open-ended period at the first payout", () => {
    const summary = buildDividendIncomeSummary(events, [], "PHP", {
      bounds: { from: "0000-01-01", to: "2026-11-14" },
      now,
    });
    expect(summary.received).toBe(1180);
    expect(summary.chartData[0]?.month).toBe("2024-03");
  });

  it("stacks bars by account or as one total", () => {
    const bounds = { from: "2026-01-01", to: "2026-03-31" };
    const byAccount = buildDividendIncomeSummary(events, [], "PHP", {
      bounds,
      groupBy: "account",
      now,
    });
    expect(byAccount.symbols).toEqual(["Brokerage", "Second"]);
    expect(byAccount.chartData.find((row) => row.month === "2026-03")?.Brokerage).toBe(30);

    const total = buildDividendIncomeSummary(events, [], "PHP", { bounds, groupBy: "total", now });
    expect(total.symbols).toEqual(["Dividends"]);
    expect(total.chartData.map((row) => row.Dividends)).toEqual([100, 50, 30]);
  });
});

describe("convertDividendToBase", () => {
  const fx = buildDividendFxTable(
    [
      holding({
        localCurrency: "USD",
        fxRate: 58,
        instrument: { id: "VOO", symbol: "VOO", currency: "USD", quoteMode: "MARKET" },
      }),
      holding({
        localCurrency: "GBp",
        fxRate: 0.01,
        instrument: { id: "LSE", symbol: "LSE", currency: "GBp", quoteMode: "MARKET" },
      }),
    ],
    "PHP",
  );

  it("uses any holding in the payout currency, keeps pence apart from pounds", () => {
    expect(convertDividendToBase(100, "PHP", "AC", fx)).toBe(100);
    expect(convertDividendToBase(2, "USD", "SOLD", fx)).toBe(116);
    expect(convertDividendToBase(250, "GBp", "LSE", fx)).toBe(2.5);
    expect(convertDividendToBase(100, "GBP", "LSE", fx)).toBeNull();
  });
});

describe("dividend currency conversion", () => {
  const now = new Date(2026, 10, 14);
  const holdings = [
    holding({
      localCurrency: "USD",
      fxRate: 58,
      marketValue: { local: 100, base: 5800 },
      instrument: { id: "VOO", symbol: "VOO", currency: "USD", quoteMode: "MARKET" },
    }),
    holding({
      localCurrency: "GBp",
      fxRate: 0.01,
      instrument: { id: "LSE", symbol: "LSE", currency: "GBp", quoteMode: "MARKET" },
    }),
  ];

  it("converts chart and period totals into the base currency", () => {
    const summary = buildDividendIncomeSummary(
      [
        event({
          id: "php",
          date: "2026-11-01",
          kind: "posted",
          displayAmount: 100,
          currency: "PHP",
        }),
        event({
          id: "usd",
          date: "2026-11-02",
          kind: "posted",
          displayAmount: 2,
          symbol: "SOLD",
          currency: "USD",
        }),
        event({
          id: "pence",
          date: "2026-11-03",
          kind: "posted",
          displayAmount: 200,
          symbol: "LSE",
          currency: "GBp",
        }),
        event({
          id: "pounds",
          date: "2026-11-04",
          kind: "posted",
          displayAmount: 10,
          symbol: "LSE",
          currency: "GBP",
        }),
      ],
      holdings,
      "PHP",
      { bounds: { from: "2026-11-01", to: "2026-11-14" }, now },
    );

    expect(summary.currency).toBe("PHP");
    expect(summary.received).toBe(100 + 2 * 58 + 200 * 0.01);
    expect(summary.payoutCount).toBe(3);
    expect(summary.chartData.map((row) => row.month)).toEqual(["2026-11"]);
    expect(summary.unconvertedCurrencies).toEqual(["GBP"]);
    expect(summary.week52Yield).toBe(summary.received / 5800);
  });
});
