import { startOfMonth } from "date-fns";

/**
 * The next 1st of `monthIndex` (0 = January) on or after the current month.
 * An earlier month rolls into next year.
 */
export function nextMonthOccurrence(monthIndex: number, today: Date): Date {
  const year = today.getFullYear();
  const targetYear = monthIndex >= today.getMonth() ? year : year + 1;
  return startOfMonth(new Date(targetYear, monthIndex, 1));
}
