import { describe, expect, it } from "vitest";
import { applyCatalogProduct, getCatalogProduct, INSTITUTIONS } from "./catalog";
import { parseAccountMeta } from "@/lib/cash-product-meta";

describe("institution catalog", () => {
  it("ships Maya, BanKo, Tonik, and MariBank products", () => {
    expect(INSTITUTIONS.map((institution) => institution.id)).toEqual([
      "maya",
      "banko",
      "tonik",
      "maribank",
    ]);
    expect(getCatalogProduct("maya-personal-goals")?.productKind).toBe("HYSA_GOAL");
    expect(getCatalogProduct("banko-todo-savings")?.createProduct().yield.minimumBalance).toBe(5000);
    expect(getCatalogProduct("tonik-account")?.createProduct().yield.dayCount).toBe("actual_actual");
  });

  it("applies a Maya Personal Goals template into account meta", () => {
    const product = getCatalogProduct("maya-personal-goals");
    expect(product).toBeDefined();
    const meta = applyCatalogProduct(null, product!);
    const parsed = parseAccountMeta(meta);
    expect(parsed.institutionId).toBe("maya");
    expect(parsed.productId).toBe("maya-personal-goals");
    expect(parsed.product?.type).toBe("HYSA_GOAL");
    expect(parsed.product?.yield.rateTiers).toHaveLength(5);
    expect(parsed.product?.yield.creditFrequency).toBe("monthly");
    expect(parsed.allocation?.cashCategoryId).toBe("FIXED_INCOME");
  });

  it("models Mari Savings as a boost band plus uncapped base in SGD", () => {
    const product = getCatalogProduct("maribank-savings")!;
    expect(product.defaultCurrency).toBe("SGD");
    expect(product.createProduct().yield.rateTiers).toEqual([
      { upTo: 100_000, apy: 0.0248 },
      { apy: 0.0088 },
    ]);
    expect(product.createProduct().yield.withholdingTaxRate).toBe(0);
  });

  it("models Maya Savings as a boost band plus uncapped base", () => {
    const yieldConfig = getCatalogProduct("maya-savings")!.createProduct().yield;
    expect(yieldConfig.rateTiers).toEqual([
      { upTo: 100_000, apy: 0.05 },
      { apy: 0.03 },
    ]);
  });
});
