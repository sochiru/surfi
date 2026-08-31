import { Avatar, AvatarFallback, AvatarImage } from "@wealthfolio/ui/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AccountType } from "@/lib/constants";
import { accountTypeVisual } from "@/lib/account-type-visuals";
import {
  CUSTOM_INSTITUTION_ID,
  INSTITUTIONS,
  type CatalogInstitution,
  type CatalogProduct,
} from "@/lib/institutions/catalog";
import { Icons } from "@wealthfolio/ui/components/ui/icons";

const TYPE_CARD_CLASS =
  "hover:bg-accent/50 flex cursor-pointer flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left transition-colors dark:bg-muted/20 dark:hover:bg-muted/30";

interface AccountTypeCardsProps {
  value: AccountType;
  onChange: (value: AccountType) => void;
  labels: Record<AccountType, string>;
}

export function AccountTypeCards({ value, onChange, labels }: AccountTypeCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-2" role="listbox" aria-label="Account type">
      {(Object.keys(labels) as AccountType[]).map((type) => {
        const visual = accountTypeVisual(type);
        const Icon = visual.icon;
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid={`account-type-card-${type.toLowerCase()}`}
            className={cn(
              TYPE_CARD_CLASS,
              selected
                ? "border-primary bg-primary/5 dark:border-foreground/60 dark:bg-secondary/30"
                : "border-border",
            )}
            onClick={() => onChange(type)}
          >
            <span
              className={cn("flex h-8 w-8 items-center justify-center rounded-lg", visual.bgClass)}
            >
              <Icon className={cn("h-4 w-4", visual.iconClass)} />
            </span>
            <span className="text-sm font-medium">{labels[type]}</span>
          </button>
        );
      })}
    </div>
  );
}

interface InstitutionCardsProps {
  value: string;
  onChange: (institutionId: string) => void;
  customLabel: string;
}

export function InstitutionCards({ value, onChange, customLabel }: InstitutionCardsProps) {
  const options: (Pick<CatalogInstitution, "id" | "name" | "logoUrl"> & { custom?: boolean })[] = [
    { id: CUSTOM_INSTITUTION_ID, name: customLabel, logoUrl: "" },
    ...INSTITUTIONS,
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="listbox" aria-label="Institution">
      {options.map((institution) => {
        const selected = value === institution.id;
        return (
          <button
            key={institution.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid={`institution-card-${institution.id}`}
            className={cn(
              TYPE_CARD_CLASS,
              "items-center",
              selected
                ? "border-primary bg-primary/5 dark:border-foreground/60 dark:bg-secondary/30"
                : "border-border",
            )}
            onClick={() => onChange(institution.id)}
          >
            <Avatar className="h-9 w-9 rounded-lg">
              {institution.logoUrl ? (
                <AvatarImage src={institution.logoUrl} alt="" className="bg-white object-contain" />
              ) : null}
              <AvatarFallback className="rounded-lg">
                <Icons.Building className="text-muted-foreground h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium">{institution.name}</span>
          </button>
        );
      })}
    </div>
  );
}

interface CatalogProductCardsProps {
  products: CatalogProduct[];
  value?: string | null;
  onChange: (product: CatalogProduct) => void;
}

export function CatalogProductCards({ products, value, onChange }: CatalogProductCardsProps) {
  return (
    <div className="grid gap-2" role="listbox" aria-label="Institution product">
      {products.map((product) => {
        const selected = value === product.id;
        return (
          <button
            key={product.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid={`product-card-${product.id}`}
            className={cn(
              TYPE_CARD_CLASS,
              selected
                ? "border-primary bg-primary/5 dark:border-foreground/60 dark:bg-secondary/30"
                : "border-border",
            )}
            onClick={() => onChange(product)}
          >
            <span className="text-sm font-medium">{product.name}</span>
            <span className="text-muted-foreground text-xs">{product.description}</span>
          </button>
        );
      })}
    </div>
  );
}
