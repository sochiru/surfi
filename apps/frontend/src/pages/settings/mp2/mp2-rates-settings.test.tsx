import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Mp2RatesSettings } from "./mp2-rates-settings";

const getMp2Rates = vi.fn();
const updateMp2Rates = vi.fn();

vi.mock("@/adapters", () => ({
  getMp2Rates: () => getMp2Rates(),
  updateMp2Rates: (rates: unknown) => updateMp2Rates(rates),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Mp2RatesSettings />
    </QueryClientProvider>,
  );
}

describe("Mp2RatesSettings", () => {
  beforeEach(() => {
    getMp2Rates.mockResolvedValue({ rates: { "2024": 0.071 } });
    updateMp2Rates.mockResolvedValue({ rates: {} });
  });

  test("accepts a decimal point and the digits typed after it", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByTestId("input-mp2-rate-2024");
    await user.clear(input);
    await user.type(input, "6.5");

    // The old version reformatted on every keystroke, so "6." became "6.00"
    // and the digits after the point could never be entered.
    expect(input).toHaveValue("6.5");

    await user.click(screen.getByTestId("button-save-mp2-rates"));
    expect(updateMp2Rates).toHaveBeenCalledWith({ rates: { "2024": 0.065 } });
  });

  test("reformats to two decimals once the field loses focus", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByTestId("input-mp2-rate-2024");
    await user.clear(input);
    await user.type(input, "7.1");
    await user.tab();

    expect(input).toHaveValue("7.10");
  });
});
