import type { Mp2DividendRates } from "@/adapters";

export const EMPTY_MP2_RATES: Mp2DividendRates = { rates: {} };

export function declaredRate(table: Mp2DividendRates, year: number): number | undefined {
  return table.rates[String(year)];
}

export function isRateDeclared(table: Mp2DividendRates, year: number): boolean {
  return declaredRate(table, year) != null;
}

/** Declared rate for the year when Pag-IBIG has announced it, otherwise the assumed rate. */
export function rateForYear(table: Mp2DividendRates, year: number, assumed: number): number {
  return declaredRate(table, year) ?? assumed;
}

export function setDeclaredRate(
  table: Mp2DividendRates,
  year: number,
  rate: number | null,
): Mp2DividendRates {
  const rates = { ...table.rates };
  if (rate == null) {
    delete rates[String(year)];
  } else {
    rates[String(year)] = rate;
  }
  return { rates };
}

export function declaredRateYears(table: Mp2DividendRates): number[] {
  return Object.keys(table.rates)
    .map(Number)
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => a - b);
}

/** Pag-IBIG launched MP2 in 2010, so there is no earlier dividend to record. */
export const MP2_PROGRAM_START_YEAR = 2010;

/**
 * Years a rate could have been declared for, newest first. The newest is last
 * year, since the current year's rate is not announced until the following March.
 */
export function selectableYears(fromYear: number = MP2_PROGRAM_START_YEAR): number[] {
  const lastCompleted = new Date().getFullYear() - 1;
  const from = Number.isFinite(fromYear)
    ? Math.min(fromYear, lastCompleted)
    : MP2_PROGRAM_START_YEAR;
  return Array.from({ length: lastCompleted - from + 1 }, (_, i) => lastCompleted - i);
}

/** Most recent year still missing a rate — the one a new row should default to. */
export function nextUndeclaredYear(table: Mp2DividendRates, fromYear?: number): number {
  const taken = new Set(declaredRateYears(table));
  const candidates = selectableYears(fromYear);
  return candidates.find((year) => !taken.has(year)) ?? candidates[0];
}

export function hasUndeclaredYear(table: Mp2DividendRates, fromYear?: number): boolean {
  const taken = new Set(declaredRateYears(table));
  return selectableYears(fromYear).some((year) => !taken.has(year));
}
