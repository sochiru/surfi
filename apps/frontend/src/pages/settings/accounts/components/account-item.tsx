import { Avatar, AvatarFallback, AvatarImage } from "@wealthfolio/ui/components/ui/avatar";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@wealthfolio/ui";
import type { Account, Platform } from "@/lib/types";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AccountOperations } from "./account-operations";
import { getProductType, parseAccountMeta, type CashProductType } from "@/lib/cash-product-meta";
import { accountTypeVisual } from "@/lib/account-type-visuals";
import { logoUrlForInstitution } from "@/lib/institutions/catalog";

const productBadgeLabels: Record<CashProductType, string> = {
  HYSA: "HYSA",
  HYSA_GOAL: "Goal",
  PAGIBIG_MP2: "MP2",
};

export interface AccountItemProps {
  account: Account;
  platform?: Platform | null;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  onArchive: (account: Account, archive: boolean) => void;
  onHide: (account: Account, hide: boolean) => void;
}

export function AccountItem({
  account,
  platform,
  onEdit,
  onDelete,
  onArchive,
  onHide,
}: AccountItemProps) {
  const { t } = useTranslation();
  // Check if account is synced from broker (has provider_account_id set)
  const isSynced = !!account.providerAccountId;
  const typeConfig = accountTypeVisual(account.accountType);
  const IconComponent = typeConfig.icon;
  const productType = getProductType(account.meta);
  const institutionLogo = logoUrlForInstitution(parseAccountMeta(account.meta).institutionId);
  const logoSrc = (isSynced && platform?.logoUrl) || institutionLogo;
  const logoAlt = platform?.name || t("settings:accounts.platform_alt");

  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        {/* Avatar with platform logo or account type icon */}
        <Avatar className="h-10 w-10 rounded-lg">
          {logoSrc ? (
            <AvatarImage src={logoSrc} alt={logoAlt} className="bg-white object-contain p-1" />
          ) : null}
          <AvatarFallback className={`rounded-lg ${typeConfig.bgClass}`}>
            <IconComponent className={`h-5 w-5 ${typeConfig.iconClass}`} />
          </AvatarFallback>
        </Avatar>

        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/accounts/${account.id}`}
              className={`font-semibold hover:underline ${
                !account.isActive ? "text-muted-foreground" : ""
              }`}
            >
              {account.name}
            </Link>
            {isSynced && <Icons.CloudSync2 className="text-muted-foreground h-3.5 w-3.5" />}
            {productType && (
              <span className="bg-muted text-2xs rounded px-1.5 py-0.5 font-semibold tracking-wide">
                {productBadgeLabels[productType]}
              </span>
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <span>{account.currency}</span>
            {account.group && (
              <>
                <span>·</span>
                <span>{account.group}</span>
              </>
            )}
            <span>·</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  delay={300}
                  render={
                    account.trackingMode === "HOLDINGS" ? (
                      <span className="text-success flex cursor-help items-center gap-1">
                        <Icons.Holdings className="h-3 w-3" />
                        {t("settings:accounts.tracking_holdings")}
                      </span>
                    ) : account.trackingMode === "NOT_SET" ? (
                      <span className="text-warning flex cursor-help items-center gap-1">
                        <Icons.AlertTriangle className="h-3 w-3" />
                        {t("settings:accounts.tracking_needs_setup")}
                      </span>
                    ) : (
                      <span className="flex cursor-help items-center gap-1">
                        <Icons.Receipt className="h-3 w-3" />
                        {t("settings:accounts.tracking_transactions")}
                      </span>
                    )
                  }
                />
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {account.trackingMode === "HOLDINGS"
                      ? t("settings:accounts.tracking_tooltip_holdings")
                      : account.trackingMode === "NOT_SET"
                        ? t("settings:accounts.tracking_tooltip_needs_setup")
                        : t("settings:accounts.tracking_tooltip_transactions")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {account.isArchived && (
          <span className="border-destructive-subtle-border bg-destructive-subtle text-destructive-subtle-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium">
            <Icons.FileArchive className="h-3 w-3" />
            {t("settings:accounts.badge_archived")}
          </span>
        )}
        {!account.isActive && !account.isArchived && (
          <span className="border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium">
            <Icons.EyeOff className="h-3 w-3" />
            {t("settings:accounts.badge_hidden")}
          </span>
        )}
        <AccountOperations
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onArchive={onArchive}
          onHide={onHide}
        />
      </div>
    </div>
  );
}

AccountItem.Skeleton = function AccountItemSkeleton() {
  return (
    <div className="p-4">
      <div className="space-y-3">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
};
