import { describe, expect, it } from "vitest";
import { formatDateISO } from "@/lib/utils";
import {
  dividendGroupByFromParams,
  dividendPeriodBounds,
  dividendRangeFromParams,
  writeDividendGroupByParam,
  writeDividendRangeParams,
} from "./dividend-filters";

const TODAY = "2026-11-14";

function isoRange(params: URLSearchParams) {
  const range = dividendRangeFromParams(params, TODAY);
  return { from: formatDateISO(range.from!), to: formatDateISO(range.to!) };
}

describe("dividend period params", () => {
  it("defaults to the last year when the URL has no valid period", () => {
    for (const query of [
      "",
      "period=bogus",
      "from=2026-02-30&to=2026-03-01",
      "from=2026-05-01&to=2026-01-01",
    ]) {
      expect(isoRange(new URLSearchParams(query))).toEqual({ from: "2025-11-14", to: TODAY });
    }
  });

  it("reads preset codes relative to today and custom dates as given", () => {
    expect(isoRange(new URLSearchParams("period=YTD"))).toEqual({ from: "2026-01-01", to: TODAY });
    expect(isoRange(new URLSearchParams("from=2025-01-01&to=2025-12-31"))).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("stores presets by code, custom ranges by date, and keeps other params", () => {
    const base = new URLSearchParams("tab=dividends&group=account");
    const ytd = writeDividendRangeParams(
      base,
      { from: new Date(2026, 0, 1), to: new Date(2026, 10, 14) },
      TODAY,
    );
    expect(ytd.toString()).toBe("tab=dividends&group=account&period=YTD");

    const custom = writeDividendRangeParams(
      ytd,
      { from: new Date(2025, 0, 1), to: new Date(2025, 11, 31) },
      TODAY,
    );
    expect(custom.toString()).toBe("tab=dividends&group=account&from=2025-01-01&to=2025-12-31");

    const allTime = writeDividendRangeParams(
      custom,
      { from: new Date(1970, 0, 1), to: new Date(2026, 10, 14) },
      TODAY,
    );
    expect(allTime.get("period")).toBe("ALL");
    expect(isoRange(allTime).from).toBe("1970-01-01");

    const defaultPeriod = writeDividendRangeParams(
      allTime,
      { from: new Date(2025, 10, 14), to: new Date(2026, 10, 14) },
      TODAY,
    );
    expect(defaultPeriod.toString()).toBe("tab=dividends&group=account");
  });

  it("treats all time as open-ended bounds", () => {
    const range = dividendRangeFromParams(new URLSearchParams("period=ALL"), TODAY);
    expect(dividendPeriodBounds(range, TODAY)).toEqual({ from: "0000-01-01", to: TODAY });
  });
});

describe("dividend group-by param", () => {
  it("falls back to ticker and omits the default from the URL", () => {
    expect(dividendGroupByFromParams(new URLSearchParams("group=nope"))).toBe("ticker");
    const byAccount = writeDividendGroupByParam(new URLSearchParams("tab=dividends"), "account");
    expect(dividendGroupByFromParams(byAccount)).toBe("account");
    expect(writeDividendGroupByParam(byAccount, "ticker").toString()).toBe("tab=dividends");
  });
});
