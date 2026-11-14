import { isAllTimeDateRange } from "@/lib/performance-date-range";
import type { DateRange } from "@/lib/types";
import { formatDateISO } from "@/lib/utils";
import {
  pickForPortfolioRange,
  portfolioPeriodRange,
} from "@/features/spending/lib/dashboard-period-sync";
import { parseSpendingDate } from "@/features/spending/lib/date-range-params";
import type { TimePeriod } from "@wealthfolio/ui";

export const DIVIDEND_PERIOD_PARAM = "period";
export const DIVIDEND_FROM_PARAM = "from";
export const DIVIDEND_TO_PARAM = "to";
export const DIVIDEND_GROUP_PARAM = "group";

export type DividendGroupBy = "ticker" | "account" | "total";

export const DEFAULT_DIVIDEND_PERIOD: TimePeriod = "1Y";
export const DEFAULT_DIVIDEND_GROUP_BY: DividendGroupBy = "ticker";

const PERIOD_CODES: readonly TimePeriod[] = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"];
const GROUP_BY_VALUES: readonly DividendGroupBy[] = ["ticker", "account", "total"];

/** Inclusive calendar-day bounds, YYYY-MM-DD. */
export interface DividendPeriodBounds {
  from: string;
  to: string;
}

export function dividendRangeFromParams(params: URLSearchParams, todayISO: string): DateRange {
  const code = params.get(DIVIDEND_PERIOD_PARAM) as TimePeriod | null;
  if (code && PERIOD_CODES.includes(code)) {
    return portfolioPeriodRange(code, todayISO)!;
  }
  const from = parseSpendingDate(params.get(DIVIDEND_FROM_PARAM));
  const to = parseSpendingDate(params.get(DIVIDEND_TO_PARAM));
  if (from && to && from <= to) return { from, to };
  return portfolioPeriodRange(DEFAULT_DIVIDEND_PERIOD, todayISO)!;
}

/** Presets are stored by code so a saved link keeps meaning "last year" as days pass. */
export function writeDividendRangeParams(
  params: URLSearchParams,
  range: DateRange | undefined,
  todayISO: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(DIVIDEND_PERIOD_PARAM);
  next.delete(DIVIDEND_FROM_PARAM);
  next.delete(DIVIDEND_TO_PARAM);
  const pick = pickForPortfolioRange(range, todayISO);
  if (pick?.kind === "portfolio") {
    if (pick.code !== DEFAULT_DIVIDEND_PERIOD) next.set(DIVIDEND_PERIOD_PARAM, pick.code);
  } else if (pick?.kind === "range") {
    next.set(DIVIDEND_FROM_PARAM, pick.from);
    next.set(DIVIDEND_TO_PARAM, pick.to);
  }
  return next;
}

export function dividendGroupByFromParams(params: URLSearchParams): DividendGroupBy {
  const value = params.get(DIVIDEND_GROUP_PARAM) as DividendGroupBy | null;
  return value && GROUP_BY_VALUES.includes(value) ? value : DEFAULT_DIVIDEND_GROUP_BY;
}

export function writeDividendGroupByParam(
  params: URLSearchParams,
  groupBy: DividendGroupBy,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (groupBy === DEFAULT_DIVIDEND_GROUP_BY) next.delete(DIVIDEND_GROUP_PARAM);
  else next.set(DIVIDEND_GROUP_PARAM, groupBy);
  return next;
}

export function dividendPeriodBounds(range: DateRange, todayISO: string): DividendPeriodBounds {
  return {
    from: !range.from || isAllTimeDateRange(range) ? "0000-01-01" : formatDateISO(range.from),
    to: range.to ? formatDateISO(range.to) : todayISO,
  };
}
