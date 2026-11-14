import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { formatZonedDateKey } from "@/features/spending/lib/timezone";
import { useSettingsContext } from "@/lib/settings-provider";
import type { DateRange } from "@/lib/types";
import { parseLocalDate } from "@/lib/utils";
import {
  dividendGroupByFromParams,
  dividendPeriodBounds,
  dividendRangeFromParams,
  writeDividendGroupByParam,
  writeDividendRangeParams,
  type DividendGroupBy,
} from "../lib/dividend-filters";

/** Period and grouping for the dividends tab, kept in the URL next to `tab`. */
export function useDividendFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useSettingsContext();
  const todayISO = formatZonedDateKey(new Date(), settings?.timezone);
  const today = useMemo(() => parseLocalDate(todayISO), [todayISO]);

  const range = useMemo(
    () => dividendRangeFromParams(searchParams, todayISO),
    [searchParams, todayISO],
  );
  const bounds = useMemo(() => dividendPeriodBounds(range, todayISO), [range, todayISO]);
  const groupBy = dividendGroupByFromParams(searchParams);

  const setRange = useCallback(
    (next: DateRange | undefined) =>
      setSearchParams((prev) => writeDividendRangeParams(prev, next, todayISO), { replace: true }),
    [setSearchParams, todayISO],
  );
  const setGroupBy = useCallback(
    (next: DividendGroupBy) =>
      setSearchParams((prev) => writeDividendGroupByParam(prev, next), { replace: true }),
    [setSearchParams],
  );

  return { today, todayISO, range, bounds, groupBy, setRange, setGroupBy };
}
