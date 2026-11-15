import { describe, expect, it } from "vitest";
import { nextMonthOccurrence } from "./dividend-calendar";

describe("nextMonthOccurrence", () => {
  const today = new Date(2026, 10, 15);

  it("keeps the current month in this year", () => {
    expect(nextMonthOccurrence(10, today)).toEqual(new Date(2026, 10, 1));
  });

  it("keeps a later month in this year", () => {
    expect(nextMonthOccurrence(11, today)).toEqual(new Date(2026, 11, 1));
  });

  it("rolls an earlier month into next year", () => {
    expect(nextMonthOccurrence(1, today)).toEqual(new Date(2027, 1, 1));
  });
});
