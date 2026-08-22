export interface ProjectionInput {
  monthlyContribution: number;
  /** Assumed rate, used for any year without a declared rate. */
  apy: number;
  years: number;
  compounding: boolean;
  /** Calendar year the projection starts from. Defaults to the current year. */
  startYear?: number;
  /** Declared rates keyed by calendar year; these override `apy` for their year. */
  rateHistory?: Record<string, number>;
}

export interface ProjectionYear {
  /** 1-based position within the projection. */
  year: number;
  calendarYear: number;
  rate: number;
  /** True when this year fell back to the assumed rate. */
  estimated: boolean;
  balance: number;
  dividend: number;
  paidOut: number;
}

export interface ProjectionResult {
  finalBalance: number;
  totalContributions: number;
  totalDividends: number;
  totalPaidOut: number;
  years: ProjectionYear[];
}

/**
 * Sum of Pag-IBIG's month weights for twelve equal monthly contributions:
 * (12 + 11 + ... + 1) / 12. A year of level contributions therefore earns as
 * though 6.5 months' worth had been on deposit all year.
 */
const LEVEL_CONTRIBUTION_WEIGHT = 6.5;

/** MP2-style projection using Pag-IBIG's month-weighted dividend base. */
export function projectCashProduct(input: ProjectionInput): ProjectionResult {
  const { monthlyContribution, apy, years, compounding, rateHistory } = input;
  const startYear = input.startYear ?? new Date().getFullYear();
  const rows: ProjectionYear[] = [];
  let balance = 0;
  let totalPaidOut = 0;
  let totalDividends = 0;

  for (let year = 1; year <= years; year += 1) {
    const calendarYear = startYear + year - 1;
    const declared = rateHistory?.[String(calendarYear)];
    const rate = declared ?? apy;

    const startBalance = balance;
    const contributions = monthlyContribution * 12;
    const dividendBase = startBalance + monthlyContribution * LEVEL_CONTRIBUTION_WEIGHT;
    const dividend = dividendBase * rate;
    totalDividends += dividend;

    if (compounding) {
      balance = startBalance + contributions + dividend;
    } else {
      balance = startBalance + contributions;
      totalPaidOut += dividend;
    }

    rows.push({
      year,
      calendarYear,
      rate,
      estimated: declared == null,
      balance,
      dividend,
      paidOut: compounding ? 0 : dividend,
    });
  }

  return {
    finalBalance: balance,
    totalContributions: monthlyContribution * 12 * years,
    totalDividends,
    totalPaidOut,
    years: rows,
  };
}

export function formatApyPct(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}
