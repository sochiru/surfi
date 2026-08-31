import { describe, expect, test } from "vitest";
import {
  computeMp2Maturity,
  defaultMp2Product,
  parseAccountMeta,
  setProductInMeta,
} from "@/lib/cash-product-meta";
import {
  declaredRateYears,
  EMPTY_MP2_RATES,
  hasUndeclaredYear,
  isRateDeclared,
  MP2_PROGRAM_START_YEAR,
  nextUndeclaredYear,
  rateForYear,
  selectableYears,
  setDeclaredRate,
} from "./dividend-rates";
import { projectCashProduct, resolveMp2DividendYear } from "./projection";

describe("cash-product-meta", () => {
  test("parses MP2 meta", () => {
    const meta = setProductInMeta(null, defaultMp2Product("2024-01-15", true, 0.0712));
    const parsed = parseAccountMeta(meta);
    expect(parsed.product?.type).toBe("PAGIBIG_MP2");
    expect(parsed.allocation?.cashCategoryId).toBe("FIXED_INCOME");
    expect(parsed.product?.yield.creditFrequency).toBe("yearly");
  });

  test("MP2 maturity is five years later", () => {
    expect(computeMp2Maturity("2024-03-01")).toBe("2029-03-01");
  });
});

describe("global MP2 dividend rates", () => {
  test("falls back to the assumed rate until a year is declared", () => {
    const table = setDeclaredRate(EMPTY_MP2_RATES, 2023, 0.0705);
    expect(rateForYear(table, 2023, 0.0712)).toBe(0.0705);
    expect(isRateDeclared(table, 2023)).toBe(true);
    expect(rateForYear(table, 2024, 0.0712)).toBe(0.0712);
    expect(isRateDeclared(table, 2024)).toBe(false);
  });

  test("removing a year restores the assumed rate", () => {
    const table = setDeclaredRate(setDeclaredRate(EMPTY_MP2_RATES, 2023, 0.0705), 2023, null);
    expect(rateForYear(table, 2023, 0.0712)).toBe(0.0712);
    expect(declaredRateYears(table)).toEqual([]);
  });

  test("declared years come back sorted", () => {
    let table = setDeclaredRate(EMPTY_MP2_RATES, 2024, 0.071);
    table = setDeclaredRate(table, 2022, 0.0703);
    table = setDeclaredRate(table, 2023, 0.0705);
    expect(declaredRateYears(table)).toEqual([2022, 2023, 2024]);
  });

  test("suggests the most recent completed year that is still undeclared", () => {
    const lastCompleted = new Date().getFullYear() - 1;
    expect(nextUndeclaredYear(EMPTY_MP2_RATES)).toBe(lastCompleted);
    const table = setDeclaredRate(EMPTY_MP2_RATES, lastCompleted, 0.071);
    expect(nextUndeclaredYear(table, lastCompleted - 2)).toBe(lastCompleted - 1);
  });

  test("offers every year back to the start of the MP2 program", () => {
    const lastCompleted = new Date().getFullYear() - 1;
    const years = selectableYears();
    // Newest first, and never the current year — its rate is announced next March.
    expect(years[0]).toBe(lastCompleted);
    expect(years).not.toContain(lastCompleted + 1);
    expect(years.at(-1)).toBe(MP2_PROGRAM_START_YEAR);
    for (const year of [2024, 2023, 2022]) {
      expect(years).toContain(year);
    }
  });

  test("add is exhausted only once every year is declared", () => {
    let table = EMPTY_MP2_RATES;
    expect(hasUndeclaredYear(table)).toBe(true);
    for (const year of selectableYears()) {
      table = setDeclaredRate(table, year, 0.07);
    }
    expect(hasUndeclaredYear(table)).toBe(false);
  });
});

describe("projectCashProduct", () => {
  test("compounding yields more than annual payout", () => {
    const base = { monthlyContribution: 1000, apy: 0.0712, years: 5 };
    const compound = projectCashProduct({ ...base, compounding: true });
    const annual = projectCashProduct({ ...base, compounding: false });
    expect(compound.finalBalance).toBeGreaterThan(annual.finalBalance);
    expect(annual.totalPaidOut).toBeGreaterThan(0);
  });

  test("first year uses the month-weighted base, not half the contributions", () => {
    const result = projectCashProduct({
      monthlyContribution: 10000,
      apy: 0.071,
      years: 1,
      compounding: true,
      startYear: 2024,
    });
    // 10,000 x 6.5 months of weighting x 7.1%
    expect(result.years[0].dividend).toBeCloseTo(10000 * 6.5 * 0.071, 6);
  });

  test("declared rates override the assumed rate for their year", () => {
    const result = projectCashProduct({
      monthlyContribution: 1000,
      apy: 0.0712,
      years: 3,
      compounding: true,
      startYear: 2023,
      rateHistory: { "2023": 0.0705, "2024": 0.071 },
    });
    expect(result.years.map((y) => y.calendarYear)).toEqual([2023, 2024, 2025]);
    expect(result.years.map((y) => y.rate)).toEqual([0.0705, 0.071, 0.0712]);
    expect(result.years.map((y) => y.estimated)).toEqual([false, false, true]);
  });

  test("recorded contributions and dividends replace the assumptions for their year", () => {
    const result = projectCashProduct({
      monthlyContribution: 1000,
      apy: 0.0712,
      years: 3,
      compounding: true,
      startYear: 2024,
      contributionHistory: { "2024": 500_000, "2025": 0 },
      dividendHistory: { "2025": 40_000 },
    });

    const [first, second, third] = result.years;
    expect(first.contributions).toBe(500_000);
    expect(first.dividend).toBeCloseTo((500_000 / 12) * 6.5 * 0.0712, 6);
    expect(second.dividend).toBe(40_000);
    expect(second.recorded).toBe(true);
    expect(third.contributions).toBe(12_000);
    expect(third.recorded).toBe(false);
    expect(result.totalContributions).toBe(512_000);
  });

  test("an account with only past contributions still grows to maturity", () => {
    const result = projectCashProduct({
      monthlyContribution: 0,
      apy: 0.07,
      years: 3,
      compounding: true,
      startYear: 2024,
      contributionHistory: { "2024": 1_000_000 },
      dividendHistory: { "2024": 123_487.95 },
    });

    expect(result.years[0].balance).toBeCloseTo(1_123_487.95, 6);
    expect(result.finalBalance).toBeCloseTo(1_123_487.95 * 1.07 * 1.07, 6);
  });

  test("does not invent future contributions when no recurring amount is assumed", () => {
    const result = projectCashProduct({
      monthlyContribution: 0,
      apy: 0.07,
      years: 5,
      compounding: true,
      startYear: 2026,
      contributionHistory: { "2026": 150_000 },
    });

    expect(result.totalContributions).toBe(150_000);
    expect(result.finalBalance).toBeCloseTo(result.totalContributions + result.totalDividends, 6);
  });

  test("a lower declared rate reduces every later year", () => {
    const base = {
      monthlyContribution: 1000,
      apy: 0.0712,
      years: 3,
      compounding: true,
      startYear: 2023,
    };
    const assumed = projectCashProduct(base);
    const corrected = projectCashProduct({ ...base, rateHistory: { "2023": 0.06 } });
    expect(corrected.finalBalance).toBeLessThan(assumed.finalBalance);
  });
});

describe("resolveMp2DividendYear", () => {
  test("uses the explicitly recorded dividend year", () => {
    expect(resolveMp2DividendYear(new Date(2026, 2, 1), 2024)).toBe(2024);
  });

  test("attributes a following-year manual credit to the prior year", () => {
    expect(resolveMp2DividendYear(new Date(2026, 2, 1))).toBe(2025);
  });

  test("keeps a December 31 auto credit in the same year", () => {
    expect(resolveMp2DividendYear(new Date(2025, 11, 31))).toBe(2025);
  });
});
