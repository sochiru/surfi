import { Separator } from "@wealthfolio/ui/components/ui/separator";
import { SettingsHeader } from "../settings-header";
import { Mp2RatesSettings } from "./mp2-rates-settings";

export default function Mp2SettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader heading="Pag-IBIG MP2" text="Dividend rates shared by every MP2 account." />
      <Separator />
      <Mp2RatesSettings />
    </div>
  );
}
