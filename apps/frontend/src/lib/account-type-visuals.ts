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
    bgClass: "bg-info-subtle",
    iconClass: "text-info-subtle-foreground",
  },
  CASH: {
    icon: Icons.DollarSign,
    bgClass: "bg-success-subtle",
    iconClass: "text-success-subtle-foreground",
  },
  CREDIT_CARD: {
    icon: Icons.CreditCard,
    bgClass: "bg-destructive-subtle",
    iconClass: "text-destructive-subtle-foreground",
  },
  CRYPTOCURRENCY: {
    icon: Icons.Bitcoin,
    bgClass: "bg-warning-subtle",
    iconClass: "text-warning-subtle-foreground",
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
