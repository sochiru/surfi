import { Icons, type Icon } from "@wealthfolio/ui/components/ui/icons";
import { AccountType } from "@/lib/constants";

export interface AccountTypeVisual {
  icon: Icon;
  bgClass: string;
  iconClass: string;
}

export const ACCOUNT_TYPE_VISUALS: Record<AccountType, AccountTypeVisual> = {
  SECURITIES: {
    icon: Icons.Briefcase,
    bgClass: "bg-blue-500/10",
    iconClass: "text-blue-500",
  },
  CASH: {
    icon: Icons.DollarSign,
    bgClass: "bg-green-500/10",
    iconClass: "text-green-500",
  },
  CREDIT_CARD: {
    icon: Icons.CreditCard,
    bgClass: "bg-rose-500/10",
    iconClass: "text-rose-500",
  },
  CRYPTOCURRENCY: {
    icon: Icons.Bitcoin,
    bgClass: "bg-orange-500/10",
    iconClass: "text-orange-500",
  },
};

export function accountTypeVisual(type?: string | null): AccountTypeVisual {
  return (
    ACCOUNT_TYPE_VISUALS[type as AccountType] ?? {
      icon: Icons.Wallet,
      bgClass: "bg-muted",
      iconClass: "text-muted-foreground",
    }
  );
}
