import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Mp2DividendRates } from "@/adapters";
import { Button, Input } from "@wealthfolio/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wealthfolio/ui/components/ui/select";
import {
  declaredRateYears,
  EMPTY_MP2_RATES,
  hasUndeclaredYear,
  nextUndeclaredYear,
  selectableYears,
  setDeclaredRate,
} from "@/features/mp2/lib/dividend-rates";
import { useMp2Rates, useUpdateMp2Rates } from "@/features/mp2/hooks/use-mp2-rates";

export function Mp2RatesSettings() {
  const { data, isLoading } = useMp2Rates();

  if (isLoading) {
    return (
      <Card data-testid="mp2-rates-settings">
        <CardHeader>
          <CardTitle className="text-lg">Declared dividend rates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm" data-testid="mp2-rates-skeleton">
            Loading rates…
          </p>
        </CardContent>
      </Card>
    );
  }

  return <RatesEditor initial={data ?? EMPTY_MP2_RATES} />;
}

function RatesEditor({ initial }: { initial: Mp2DividendRates }) {
  const updateMutation = useUpdateMp2Rates();
  const [draft, setDraft] = useState<Mp2DividendRates>(initial);
  // Keystrokes for rows being typed in. A half-entered "7." is not a number yet,
  // so formatting the stored value back into the field would eat the decimal point.
  const [editing, setEditing] = useState<Record<string, string>>({});

  const years = declaredRateYears(draft);
  const currentYear = new Date().getFullYear();

  const stopEditing = (year: number) => setEditing(({ [String(year)]: _dropped, ...rest }) => rest);

  const percentText = (year: number) =>
    editing[String(year)] ?? ((draft.rates[String(year)] ?? 0) * 100).toFixed(2);

  const changeRate = (year: number, raw: string) => {
    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
    setEditing((prev) => ({ ...prev, [String(year)]: raw }));
    const percent = Number.parseFloat(raw);
    if (Number.isFinite(percent)) {
      setDraft((prev) => setDeclaredRate(prev, year, percent / 100));
    }
  };

  // Re-keying an entry has to drop the old year, otherwise both stay declared.
  const moveYear = (from: number, to: number) => {
    if (from === to) return;
    const rate = draft.rates[String(from)] ?? 0;
    setDraft(setDeclaredRate(setDeclaredRate(draft, from, null), to, rate));
    stopEditing(from);
  };

  const removeYear = (year: number) => {
    setDraft(setDeclaredRate(draft, year, null));
    stopEditing(year);
  };

  const yearOptions = (current: number) =>
    selectableYears().filter((year) => year === current || !years.includes(year));

  return (
    <Card data-testid="mp2-rates-settings">
      <CardHeader>
        <CardTitle className="text-lg">Declared dividend rates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Pag-IBIG declares one MP2 rate per year for all members, so these apply to every MP2
          account. Enter each rate under the year it was <span className="font-medium">earned</span>
          . Rates are announced around March of the following year, so the rate announced in March{" "}
          {currentYear} belongs to {currentYear - 1}. Years left out here use the assumed rate on
          the account and are corrected automatically once you add the declared rate.
        </p>

        <div className="space-y-2" data-testid="mp2-rates-list">
          {years.length === 0 ? (
            <p className="text-muted-foreground text-sm italic" data-testid="mp2-rates-empty-state">
              No declared rates yet.
            </p>
          ) : (
            years.map((year) => (
              <div key={year} className="flex items-center gap-2">
                <Select value={String(year)} onValueChange={(v) => moveYear(year, Number(v))}>
                  <SelectTrigger className="w-28" data-testid={`select-mp2-rate-year-${year}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions(year).map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative flex-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Declared MP2 rate for ${year} in percent`}
                    data-testid={`input-mp2-rate-${year}`}
                    value={percentText(year)}
                    onChange={(e) => changeRate(year, e.target.value)}
                    onBlur={() => stopEditing(year)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove declared MP2 rate for ${year}`}
                  data-testid={`button-remove-mp2-rate-${year}`}
                  onClick={() => removeYear(year)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="button-add-mp2-rate"
            disabled={!hasUndeclaredYear(draft)}
            onClick={() => setDraft(setDeclaredRate(draft, nextUndeclaredYear(draft), 0))}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Add year
          </Button>
          <Button
            type="button"
            data-testid="button-save-mp2-rates"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate(draft)}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
