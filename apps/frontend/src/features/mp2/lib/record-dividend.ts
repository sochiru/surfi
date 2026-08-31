import { createActivity } from "@/adapters";
import { ActivityType } from "@/lib/constants";

interface RecordMp2DividendInput {
  accountId: string;
  currency: string;
  amount: number;
  activityDate: Date;
  dividendYear: number;
  compounding: boolean;
  notes?: string;
}

export async function recordMp2Dividend(input: RecordMp2DividendInput): Promise<void> {
  const date = input.activityDate;
  await createActivity({
    accountId: input.accountId,
    activityType: ActivityType.INTEREST,
    activityDate: date,
    amount: input.amount,
    currency: input.currency,
    fee: 0,
    comment: input.notes ?? "MP2 dividend",
    metadata: { mp2DividendYear: input.dividendYear },
  });
  if (!input.compounding) {
    await createActivity({
      accountId: input.accountId,
      activityType: ActivityType.WITHDRAWAL,
      activityDate: date,
      amount: input.amount,
      currency: input.currency,
      fee: 0,
      comment: "MP2 annual dividend payout",
    });
  }
}
