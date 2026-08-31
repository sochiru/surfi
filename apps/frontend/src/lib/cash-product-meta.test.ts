import { describe, expect, it } from "vitest";
import {
  effectiveApy,
  headlineApy,
  parseAccountMeta,
  sanitizeRateTiers,
  setCatalogSelectionInMeta,
} from "./cash-product-meta";

describe("sanitizeRateTiers", () => {
  it("sorts bands and keeps the last duplicate limit", () => {
    expect(
      sanitizeRateTiers([
        { upTo: 100_000, apy: 0.08 },
        { upTo: 20_000, apy: 0.04 },
        { upTo: 20_000, apy: 0.041 },
      ]),
    ).toEqual([
      { upTo: 20_000, apy: 0.041 },
      { upTo: 100_000, apy: 0.08 },
    ]);
  });

  it("returns an empty list for a flat rate", () => {
    expect(sanitizeRateTiers(undefined)).toEqual([]);
    expect(sanitizeRateTiers([])).toEqual([]);
  });
});

describe("effectiveApy", () => {
  const goalYield = {
    enabled: true,
    apy: 0.08,
    creditFrequency: "monthly" as const,
    rateTiers: [
      { upTo: 20_000, apy: 0.04 },
      { upTo: 40_000, apy: 0.045 },
      { upTo: 60_000, apy: 0.05 },
      { upTo: 80_000, apy: 0.065 },
      { upTo: 100_000, apy: 0.08 },
    ],
  };

  it("uses the flat APY when there are no bands", () => {
    expect(
      effectiveApy({ enabled: true, apy: 0.045, creditFrequency: "daily" }, 50_000),
    ).toBe(0.045);
  });

  it("blends Personal Goals at ₱100,000 to 5.6%", () => {
    expect(effectiveApy(goalYield, 100_000)).toBeCloseTo(0.056);
    expect(headlineApy(goalYield)).toBe(0.08);
  });

  it("pays nothing on the excess above the last cap", () => {
    expect(effectiveApy(goalYield, 150_000)).toBeCloseTo((5600) / 150_000);
  });

  it("returns zero below the minimum balance", () => {
    expect(
      effectiveApy(
        { enabled: true, apy: 0.05, creditFrequency: "monthly", minimumBalance: 5_000 },
        4_000,
      ),
    ).toBe(0);
  });
});

describe("setCatalogSelectionInMeta", () => {
  it("stores and clears institution metadata without dropping the product", () => {
    const withIds = setCatalogSelectionInMeta(
      '{"product":{"type":"HYSA","compounding":true,"yield":{"enabled":true,"apy":0.05,"creditFrequency":"daily"}}}',
      "maya",
      "maya-savings",
    );
    expect(parseAccountMeta(withIds).institutionId).toBe("maya");
    expect(parseAccountMeta(withIds).productId).toBe("maya-savings");
    const cleared = setCatalogSelectionInMeta(withIds, null, null);
    expect(parseAccountMeta(cleared).institutionId).toBeUndefined();
    expect(parseAccountMeta(cleared).product?.type).toBe("HYSA");
  });
});
