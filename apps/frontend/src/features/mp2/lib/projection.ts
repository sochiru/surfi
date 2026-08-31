export interface ProjectionInput {
  /** Assumed contribution per month, used for any year without recorded contributions. */
  monthlyContribution: number;
  /** Assumed rate, used for any year without a declared rate. */
  apy: number;
  years: number;
  compounding: boolean;
  /** Calendar year the projection starts from. Defaults to the current year. */
  startYear?: number;
  /** Declared rates keyed by calendar year; these override `apy` for their year. */
  rateHistory?: Record<string, number>;
  /** Contributions actually recorded, keyed by calendar year. */
  contributionHistory?: Record<string, number>;
  /** Dividends actually credited, keyed by calendar year. */
  dividendHistory?: Record<string, number>;
}

export interface ProjectionYear {
  /** 1-based position within the projection. */
  year: number;
  calendarYear: number;
  rate: number;
  /** True when this year fell back to the assumed rate. */
  estimated: boolean;
  /** True when the dividend came from a recorded credit rather than the model. */
  recorded: boolean;
  contributions: number;
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

/**
 * MP2-style projection using Pag-IBIG's month-weighted dividend base.
 *
 * Years covered by `contributionHistory` / `dividendHistory` are replayed from
 * what actually happened, so the run-up to today reflects real contributions and
 * declared dividends. Only the years still ahead fall back to the assumptions.
 */
export function projectCashProduct(input: ProjectionInput): ProjectionResult {
  const {
    monthlyContribution,
    apy,
    years,
    compounding,
    rateHistory,
    contributionHistory,
    dividendHistory,
  } = input;
  const startYear = input.startYear ?? new Date().getFullYear();
  const rows: ProjectionYear[] = [];
  let balance = 0;
  let totalContributions = 0;
  let totalPaidOut = 0;
  let totalDividends = 0;

  for (let year = 1; year <= years; year += 1) {
    const calendarYear = startYear + year - 1;
    const key = String(calendarYear);
    const declared = rateHistory?.[key];
    const rate = declared ?? apy;
    const creditedDividend = dividendHistory?.[key];

    const startBalance = balance;
    const contributions = contributionHistory?.[key] ?? monthlyContribution * 12;
    const dividendBase = startBalance + (contributions / 12) * LEVEL_CONTRIBUTION_WEIGHT;
    const dividend = creditedDividend ?? dividendBase * rate;
    totalContributions += contributions;
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
      estimated: creditedDividend == null && declared == null,
      recorded: creditedDividend != null,
      contributions,
      balance,
      dividend,
      paidOut: compounding ? 0 : dividend,
    });
  }

  return {
    finalBalance: balance,
    totalContributions,
    totalDividends,
    totalPaidOut,
    years: rows,
  };
}

export function formatApyPct(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

/**
 * Manual MP2 credits normally arrive in the year after they were earned.
 * Auto-generated December 31 entries already sit in their dividend year.
 */
export function resolveMp2DividendYear(creditDate: Date, storedYear?: unknown): number {
  const dividendYear = Number(storedYear);
  if (Number.isInteger(dividendYear)) return dividendYear;
  const creditedAtYearEnd = creditDate.getMonth() === 11 && creditDate.getDate() === 31;
  return creditedAtYearEnd ? creditDate.getFullYear() : creditDate.getFullYear() - 1;
}
