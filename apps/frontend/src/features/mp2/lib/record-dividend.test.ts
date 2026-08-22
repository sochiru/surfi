import { describe, expect, test, vi, beforeEach } from "vitest";
import { recordMp2Dividend } from "./record-dividend";

vi.mock("@/adapters", () => ({
  createActivity: vi.fn(),
}));

import { createActivity } from "@/adapters";

describe("recordMp2Dividend", () => {
  beforeEach(() => {
    vi.mocked(createActivity).mockReset();
    vi.mocked(createActivity).mockResolvedValue({} as never);
  });

  test("compound mode posts interest only", async () => {
    await recordMp2Dividend({
      accountId: "a1",
      currency: "PHP",
      amount: 500,
      activityDate: new Date("2024-12-31"),
      compounding: true,
    });
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: "INTEREST", amount: 500 }),
    );
  });

  test("annual payout posts interest and withdrawal", async () => {
    await recordMp2Dividend({
      accountId: "a1",
      currency: "PHP",
      amount: 500,
      activityDate: new Date("2024-12-31"),
      compounding: false,
    });
    expect(createActivity).toHaveBeenCalledTimes(2);
    expect(createActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ activityType: "INTEREST" }),
    );
    expect(createActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ activityType: "WITHDRAWAL" }),
    );
  });
});
