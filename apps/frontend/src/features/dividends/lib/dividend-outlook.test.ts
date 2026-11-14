import { describe, expect, it } from "vitest";
import type { DividendCalendarEvent } from "@/adapters";
import type { Holding } from "@/lib/types";
import { buildDividendFxTable } from "./dividend-income-summary";
import {
  buildAnnualDividendIncome,
  buildDividendPayers,
  buildDividendRhythm,
  buildDividendYearOutlook,
  countMissingDividendPayouts,
  previousDividendPeriod,
} from "./dividend-outlook";

const NOW = new Date(2026, 10, 14);
const fx = buildDividendFxTable(
  [
    {
      id: "VOO",
      holdingType: "security",
      accountId: "acct",
      quantity: 1,
      localCurrency: "USD",
      baseCurrency: "PHP",
      fxRate: 50,
      marketValue: { local: 0, base: 0 },
      weight: null,
      asOfDate: "2026-11-14",
      instrument: { id: "VOO", symbol: "VOO", currency: "USD", quoteMode: "MARKET" },
    } satisfies Holding,
  ],
  "PHP",
);

function posted(id: string, date: string, amount: number, symbol = "AC", currency = "PHP") {
  return event({ id, date, kind: "posted", displayAmount: amount, symbol, currency });
}

function upcoming(id: string, date: string, amount: number, symbol = "AC") {
  return event({ id, date, kind: "upcoming_estimated", displayAmount: amount, symbol });
}

function event(
  partial: Pick<DividendCalendarEvent, "id" | "date" | "kind" | "displayAmount"> &
    Partial<DividendCalendarEvent>,
): DividendCalendarEvent {
  return { symbol: "AC", accountId: "acct", accountName: "Brokerage", currency: "PHP", ...partial };
}

describe("buildDividendYearOutlook", () => {
  const events = [
    posted("ly-early", "2025-03-01", 400),
    posted("ly-late", "2025-12-01", 600),
    posted("ty-php", "2026-03-01", 500),
    posted("ty-usd", "2026-06-01", 4, "VOO", "USD"),
    upcoming("upcoming-acct-AC-1", "2026-11-20", 100),
    upcoming("projected-acct-AC-2026-12-15", "2026-12-15", 50),
    upcoming("projected-acct-AC-2027-01-20", "2027-01-20", 70),
    upcoming("projected-acct-AC-2027-03-01", "2027-03-01", 80),
    event({ id: "missing", date: "2026-10-01", kind: "past_unposted", displayAmount: 999 }),
  ];

  it("projects the year and compares it with last year's total and same dates", () => {
    const outlook = buildDividendYearOutlook(events, fx, NOW);
    expect(outlook.receivedYtd).toBe(700);
    expect(outlook.expectedAnnounced).toBe(100);
    expect(outlook.expectedEstimated).toBe(50);
    expect(outlook.expectedCount).toBe(2);
    expect(outlook.projected).toBe(850);
    expect(outlook.lastYear).toBe(1000);
    expect(outlook.lastYearSameDates).toBe(400);
    expect(outlook.changeVsLastYear).toBeCloseTo(-0.15);
    expect(outlook.changeSameDates).toBeCloseTo(0.75);
  });

  it("lists the next 90 days across year end with their source", () => {
    const outlook = buildDividendYearOutlook(events, fx, NOW);
    expect(outlook.next90Days.map((row) => [row.date, row.source])).toEqual([
      ["2026-11-20", "announced"],
      ["2026-12-15", "estimated"],
      ["2027-01-20", "estimated"],
    ]);
  });

  it("has no change when last year had no income", () => {
    const outlook = buildDividendYearOutlook([posted("a", "2026-01-05", 10)], fx, NOW);
    expect(outlook.changeVsLastYear).toBeNull();
    expect(outlook.changeSameDates).toBeNull();
  });
});

describe("buildAnnualDividendIncome", () => {
  it("fills gap years and adds this year's expected payouts", () => {
    const rows = buildAnnualDividendIncome(
      [
        posted("a", "2023-05-01", 100),
        posted("b", "2025-05-01", 200),
        posted("c", "2026-05-01", 150),
        upcoming("upcoming-x", "2026-12-01", 100),
        upcoming("projected-y", "2027-02-01", 999),
      ],
      fx,
      NOW,
    );
    expect(rows).toEqual([
      { year: "2023", received: 100, expected: 0, change: null },
      { year: "2024", received: 0, expected: 0, change: -1 },
      { year: "2025", received: 200, expected: 0, change: null },
      { year: "2026", received: 150, expected: 100, change: 0.25 },
    ]);
  });
});

describe("previousDividendPeriod", () => {
  it("uses the same dates a year earlier without overlapping", () => {
    expect(previousDividendPeriod({ from: "2026-01-01", to: "2026-11-14" })).toEqual({
      from: "2025-01-01",
      to: "2025-11-14",
    });
    expect(previousDividendPeriod({ from: "2025-11-14", to: "2026-11-14" })).toEqual({
      from: "2024-11-14",
      to: "2025-11-13",
    });
    expect(previousDividendPeriod({ from: "2021-11-14", to: "2026-11-14" })).toEqual({
      from: "2016-11-14",
      to: "2021-11-13",
    });
    expect(previousDividendPeriod({ from: "0000-01-01", to: "2026-11-14" })).toBeNull();
  });
});

describe("buildDividendPayers", () => {
  it("ranks holdings, flags new, down and stopped payers, and finds the next payout", () => {
    const summary = buildDividendPayers(
      [
        posted("ac-now", "2026-03-01", 600),
        posted("ac-before", "2025-03-01", 500),
        posted("bpi-now", "2026-04-01", 100, "BPI"),
        posted("bpi-before", "2025-04-01", 200, "BPI"),
        posted("voo-now", "2026-05-01", 6, "VOO", "USD"),
        posted("mer-before", "2025-06-01", 50, "MER"),
        upcoming("projected-ac-2", "2026-12-20", 80),
        upcoming("upcoming-ac-1", "2026-11-30", 90),
      ],
      fx,
      { from: "2026-01-01", to: "2026-11-14" },
      NOW,
    );

    expect(summary.total).toBe(1000);
    expect(summary.rows.map((row) => [row.symbol, row.received, row.status])).toEqual([
      ["AC", 600, null],
      ["VOO", 300, "new"],
      ["BPI", 100, "down"],
      ["MER", 0, "stopped"],
    ]);
    expect(summary.rows[0]?.change).toBeCloseTo(0.2);
    expect(summary.rows[0]?.next).toEqual({ date: "2026-11-30", amount: 90, source: "announced" });
    expect(summary.rows[0]?.expectedNextYear).toBe(170);
    expect(summary.topThreeShare).toBeCloseTo(1);
  });

  it("adds the next 12 months, yield, and yield on cost from current holdings", () => {
    const summary = buildDividendPayers(
      [
        posted("now", "2026-06-01", 2, "VOO", "USD"),
        posted("trail", "2026-01-01", 2, "VOO", "USD"),
        posted("old", "2024-01-01", 9, "VOO", "USD"),
        event({
          id: "upcoming-voo",
          date: "2027-02-01",
          kind: "upcoming_estimated",
          displayAmount: 1,
          symbol: "VOO",
          currency: "USD",
        }),
        event({
          id: "projected-voo-later",
          date: "2028-01-01",
          kind: "upcoming_estimated",
          displayAmount: 5,
          symbol: "VOO",
          currency: "USD",
        }),
      ],
      fx,
      { from: "2026-01-01", to: "2026-11-14" },
      NOW,
      [
        {
          id: "VOO",
          holdingType: "security",
          accountId: "acct",
          quantity: 1,
          localCurrency: "USD",
          baseCurrency: "PHP",
          marketValue: { local: 200, base: 10000 },
          costBasis: { local: 100, base: 5000 },
          weight: null,
          asOfDate: "2026-11-14",
          instrument: { id: "VOO", symbol: "VOO", currency: "USD", quoteMode: "MARKET" },
        } satisfies Holding,
      ],
    );

    const row = summary.rows[0];
    expect(row?.received).toBe(200);
    expect(row?.trailing).toBe(200);
    expect(row?.expectedNextYear).toBe(50);
    expect(row?.yieldOnValue).toBeCloseTo(0.02);
    expect(row?.yieldOnCost).toBeCloseTo(0.04);
    expect(row?.next?.date).toBe("2027-02-01");
  });
});

describe("buildDividendRhythm", () => {
  it("marks months that were empty in most completed years", () => {
    const rhythm = buildDividendRhythm(
      [
        posted("a", "2024-01-15", 10),
        posted("b", "2024-03-15", 10),
        posted("c", "2025-01-15", 10),
        posted("d", "2025-06-15", 10),
        posted("e", "2026-01-15", 10),
      ],
      fx,
      NOW,
    );
    expect(rhythm?.years).toEqual([2024, 2025]);
    expect(rhythm?.months.find((month) => month.label === "Jan")?.quiet).toBe(false);
    expect(rhythm?.months.find((month) => month.label === "Feb")?.quiet).toBe(true);
    expect(rhythm?.months.find((month) => month.label === "Mar")?.quiet).toBe(false);
  });

  it("waits for two completed years", () => {
    expect(buildDividendRhythm([posted("a", "2025-01-15", 10)], fx, NOW)).toBeNull();
  });
});

describe("countMissingDividendPayouts", () => {
  it("counts past payouts that were never recorded", () => {
    expect(
      countMissingDividendPayouts([
        posted("a", "2026-01-01", 10),
        event({ id: "missing-1", date: "2026-02-01", kind: "past_unposted", displayAmount: 5 }),
        event({ id: "missing-2", date: "2026-03-01", kind: "past_unposted", displayAmount: 5 }),
        upcoming("upcoming-x", "2026-12-01", 5),
      ]),
    ).toBe(2);
  });
});
