import { describe, expect, it } from "vitest";
import { accountTypeVisual } from "./account-type-visuals";
import { logoUrlForInstitution } from "./institutions/catalog";

describe("account visuals", () => {
  it("maps each account type to an icon", () => {
    expect(accountTypeVisual("SECURITIES").icon).toBeDefined();
    expect(accountTypeVisual("CASH").icon).toBeDefined();
    expect(accountTypeVisual("CREDIT_CARD").icon).toBeDefined();
    expect(accountTypeVisual("CRYPTOCURRENCY").icon).toBeDefined();
  });

  it("returns catalog logos and nothing for custom institutions", () => {
    expect(logoUrlForInstitution("maya")).toBe("/institutions/maya.webp");
    expect(logoUrlForInstitution("maribank")).toBe("/institutions/maribank.webp");
    expect(logoUrlForInstitution("custom")).toBeUndefined();
    expect(logoUrlForInstitution(undefined)).toBeUndefined();
  });
});
