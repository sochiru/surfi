import { invoke, logger } from "./platform";

export interface CashInterestSyncAccountResult {
  accountId: string;
  accountName: string;
  created: number;
  amended: number;
  removed: number;
  skippedOverrides: number;
  skippedDuplicates: number;
}

export interface CashInterestSyncResult {
  created: number;
  amended: number;
  removed: number;
  skipped: number;
  skippedOverrides: number;
  skippedDuplicates: number;
  accounts: CashInterestSyncAccountResult[];
  errors: string[];
  netCashAdded: string;
}

/**
 * Pag-IBIG declares one MP2 rate per year for all members, so these are app-wide
 * rather than per-account. Keys are the calendar year the dividend was earned.
 */
export interface Mp2DividendRates {
  rates: Record<string, number>;
}

export const syncCashInterest = async (): Promise<CashInterestSyncResult> => {
  try {
    return await invoke<CashInterestSyncResult>("sync_cash_interest");
  } catch (error) {
    logger.error("Error syncing cash interest.");
    throw error;
  }
};

export const syncCashInterestAccount = async (
  accountId: string,
): Promise<CashInterestSyncResult> => {
  try {
    return await invoke<CashInterestSyncResult>("sync_cash_interest_account", { accountId });
  } catch (error) {
    logger.error("Error syncing cash interest for account.");
    throw error;
  }
};

export const removeAutoInterest = async (): Promise<number> => {
  try {
    return await invoke<number>("remove_auto_interest");
  } catch (error) {
    logger.error("Error removing auto interest.");
    throw error;
  }
};

export const removeAutoInterestAccount = async (accountId: string): Promise<number> => {
  try {
    return await invoke<number>("remove_auto_interest_account", { accountId });
  } catch (error) {
    logger.error("Error removing auto interest for account.");
    throw error;
  }
};

export const getMp2Rates = async (): Promise<Mp2DividendRates> => {
  try {
    return await invoke<Mp2DividendRates>("get_mp2_rates");
  } catch (error) {
    logger.error("Error fetching MP2 dividend rates.");
    throw error;
  }
};

export const updateMp2Rates = async (rates: Mp2DividendRates): Promise<Mp2DividendRates> => {
  try {
    return await invoke<Mp2DividendRates>("update_mp2_rates", { rates });
  } catch (error) {
    logger.error("Error updating MP2 dividend rates.");
    throw error;
  }
};
