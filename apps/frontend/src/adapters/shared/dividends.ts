import { invoke, logger } from "./platform";

export type DividendCalendarEventKind =
  | "posted"
  | "past_unposted"
  | "upcoming_estimated";

export interface DividendCalendarEvent {
  id: string;
  date: string;
  symbol: string;
  accountId: string;
  accountName: string;
  displayAmount: string | number;
  currency: string;
  kind: DividendCalendarEventKind;
  activityId?: string | null;
  notes?: string | null;
}

export interface AccountDividendSettings {
  enabled: boolean;
  dividendTaxRate: number;
}

export interface DividendSyncSettings {
  globalEnabled: boolean;
  accounts: Record<string, AccountDividendSettings>;
}

export interface DividendSyncAccountResult {
  accountId: string;
  accountName: string;
  created: number;
  skippedNoShares: number;
  skippedDuplicates: number;
}

export interface DividendSyncResult {
  created: number;
  skipped: number;
  skippedNoShares: number;
  skippedDuplicates: number;
  accounts: DividendSyncAccountResult[];
  errors: string[];
  netCashAdded: string;
}

export interface AssetDividendView {
  assetId: string;
  symbol: string;
  currency: string;
  ytdIncome: string | number;
  ttmIncome: string | number;
  events: DividendCalendarEvent[];
}

export const getDividendSyncSettings = async (): Promise<DividendSyncSettings> => {
  try {
    return await invoke<DividendSyncSettings>("get_dividend_sync_settings");
  } catch (error) {
    logger.error("Error fetching dividend sync settings.");
    throw error;
  }
};

export const updateDividendSyncSettings = async (
  settings: DividendSyncSettings,
): Promise<DividendSyncSettings> => {
  try {
    return await invoke<DividendSyncSettings>("update_dividend_sync_settings", { settings });
  } catch (error) {
    logger.error("Error updating dividend sync settings.");
    throw error;
  }
};

export const syncDividends = async (): Promise<DividendSyncResult> => {
  try {
    return await invoke<DividendSyncResult>("sync_dividends");
  } catch (error) {
    logger.error("Error syncing dividends.");
    throw error;
  }
};

export const removeAutoDividends = async (): Promise<number> => {
  try {
    return await invoke<number>("remove_auto_dividends");
  } catch (error) {
    logger.error("Error removing auto dividends.");
    throw error;
  }
};

export const getDividendCalendarEvents = async (): Promise<DividendCalendarEvent[]> => {
  try {
    return await invoke<DividendCalendarEvent[]>("get_dividend_calendar_events");
  } catch (error) {
    logger.error("Error fetching dividend calendar events.");
    throw error;
  }
};

export const getAssetDividendView = async (assetId: string): Promise<AssetDividendView> => {
  try {
    return await invoke<AssetDividendView>("get_asset_dividend_view", { assetId });
  } catch (error) {
    logger.error("Error fetching asset dividend view.");
    throw error;
  }
};
