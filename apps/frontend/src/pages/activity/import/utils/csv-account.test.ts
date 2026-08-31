import { describe, expect, it } from "vitest";
import { accountIdFromCsvValue } from "./csv-account";

const accounts = [
  { id: "acc-maya", name: "Maya Savings" },
  { id: "acc-broker", name: "Brokerage" },
];

describe("accountIdFromCsvValue", () => {
  it("uses an explicit mapping first", () => {
    expect(accountIdFromCsvValue("Maya Savings", accounts, { "Maya Savings": "acc-broker" })).toBe(
      "acc-broker",
    );
  });

  it("accepts a destination account id", () => {
    expect(accountIdFromCsvValue("acc-maya", accounts)).toBe("acc-maya");
  });

  it("matches a unique account name so an export can re-import on another instance", () => {
    expect(accountIdFromCsvValue("Maya Savings", accounts)).toBe("acc-maya");
    expect(accountIdFromCsvValue("maya savings", accounts)).toBe("acc-maya");
  });

  it("does not guess when two accounts share a name", () => {
    expect(
      accountIdFromCsvValue("Maya Savings", [
        { id: "a", name: "Maya Savings" },
        { id: "b", name: "Maya Savings" },
      ]),
    ).toBeUndefined();
  });
});
