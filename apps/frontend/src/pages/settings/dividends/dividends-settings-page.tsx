import { Separator } from "@wealthfolio/ui/components/ui/separator";
import { DividendAutomationSettings } from "@/features/dividends/components/dividend-automation-settings";
import { SettingsHeader } from "../settings-header";

export default function DividendsSettingsPage() {
  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <SettingsHeader
        heading="Dividends"
        text="Choose which accounts auto-create dividends and how much tax is withheld."
      />
      <Separator />
      <DividendAutomationSettings />
    </div>
  );
}
