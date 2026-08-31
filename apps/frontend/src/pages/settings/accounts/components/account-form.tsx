import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Button } from "@wealthfolio/ui/components/ui/button";
import { Switch } from "@wealthfolio/ui/components/ui/switch";

import { newAccountSchema } from "@/lib/schemas";
import { AccountType } from "@/lib/constants";
import { useTaxonomy } from "@/hooks/use-taxonomies";
import { cn } from "@/lib/utils";
import {
  CurrencyInput,
  RadioGroup,
  RadioGroupItem,
  ToggleGroup,
  ToggleGroupItem,
} from "@wealthfolio/ui";
import { Alert, AlertDescription } from "@wealthfolio/ui/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@wealthfolio/ui/components/ui/alert-dialog";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wealthfolio/ui/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@wealthfolio/ui/components/ui/form";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Input } from "@wealthfolio/ui/components/ui/input";

import { useAccountMutations } from "./use-account-mutations";
import { AccountTypeCards, CatalogProductCards, InstitutionCards } from "./account-form-pickers";
import { CashProductFields } from "@/features/mp2/components/cash-product-fields";
import type { CashProductType } from "@/lib/cash-product-meta";
import {
  defaultCashProduct,
  getProductType,
  parseAccountMeta,
  setCashCategoryInMeta,
  setCatalogSelectionInMeta,
  setProductInMeta,
} from "@/lib/cash-product-meta";
import { accountTypeVisual } from "@/lib/account-type-visuals";
import {
  applyCatalogProduct,
  CUSTOM_INSTITUTION_ID,
  getCatalogProduct,
  getInstitution,
  type CatalogProduct,
} from "@/lib/institutions/catalog";

const CASH_ALLOCATION_DEFAULT_VALUE = "__default__";
const CASH_FIXED_INCOME_CATEGORY_ID = "FIXED_INCOME";
const CASH_PRODUCT_NONE = "__none__";

function getSelectableCashCategoryFromMeta(meta?: string | null): string {
  const categoryId = parseAccountMeta(meta).allocation?.cashCategoryId;
  return categoryId === CASH_FIXED_INCOME_CATEGORY_ID
    ? CASH_FIXED_INCOME_CATEGORY_ID
    : CASH_ALLOCATION_DEFAULT_VALUE;
}

const formCardClassName =
  "rounded-xl border border-border bg-background p-4 sm:p-5 dark:border-border/70 dark:bg-muted/20";
const formSectionLabelClassName =
  "text-muted-foreground text-xs font-semibold uppercase tracking-[0.18em]";
const trackingOptionClassName =
  "hover:bg-accent/50 relative flex cursor-pointer gap-3 rounded-xl border bg-card p-4 transition-colors dark:bg-muted/20 dark:hover:bg-muted/30";
const cashClassificationItemClassName =
  "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-9 rounded-md text-sm data-[state=on]:shadow-sm dark:data-[state=on]:bg-secondary dark:data-[state=on]:text-foreground";

// Input type (what the form receives)
type AccountFormInput = z.input<typeof newAccountSchema>;
// Output type after zod parsing (with defaults applied)
type AccountFormOutput = z.output<typeof newAccountSchema>;

interface AccountFormlProps {
  defaultValues?: AccountFormInput;
  onSuccess?: () => void;
}

export function AccountForm({ defaultValues, onSuccess = () => undefined }: AccountFormlProps) {
  const { t } = useTranslation();
  const { createAccountMutation, updateAccountMutation } = useAccountMutations({ onSuccess });

  const accountTypeLabels: Record<AccountType, string> = useMemo(
    () => ({
      SECURITIES: t("settings:accounts_form_type_securities"),
      CASH: t("settings:accounts_form_type_cash"),
      CREDIT_CARD: t("settings:accounts_form_type_credit_card"),
      CRYPTOCURRENCY: t("settings:accounts_form_type_crypto"),
    }),
    [t],
  );

  const lastPrefill = useRef<{ name: string; group?: string; currency: string } | null>(null);

  // Track initial tracking mode to detect changes
  const initialTrackingMode = defaultValues?.trackingMode;
  const needsSetup = initialTrackingMode === "NOT_SET" || initialTrackingMode === undefined;

  // State for mode switch confirmation dialog
  const [showModeConfirmation, setShowModeConfirmation] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<AccountFormOutput | null>(null);

  const form = useForm<AccountFormInput, unknown, AccountFormOutput>({
    resolver: zodResolver(newAccountSchema),
    defaultValues: {
      ...defaultValues,
      // Don't default to any mode if account needs setup (must come after spread)
      trackingMode: needsSetup ? undefined : defaultValues?.trackingMode,
    },
  });

  const currentTrackingMode = form.watch("trackingMode");
  const currentAccountType = form.watch("accountType");
  const isCreditCardAccount = currentAccountType === AccountType.CREDIT_CARD;
  const isCashAccount = currentAccountType === AccountType.CASH;
  const cashMeta = form.watch("meta");
  const parsedCashMeta = parseAccountMeta(cashMeta);
  const cashProductType = getProductType(cashMeta);
  const selectedInstitutionId = parsedCashMeta.institutionId ?? CUSTOM_INSTITUTION_ID;
  const selectedCatalogProduct = getCatalogProduct(parsedCashMeta.productId);
  const catalogInstitution = getInstitution(selectedInstitutionId);
  const isFixedIncome =
    getSelectableCashCategoryFromMeta(cashMeta) === CASH_FIXED_INCOME_CATEGORY_ID;

  const { data: assetClassesTaxonomy } = useTaxonomy(isCashAccount ? "asset_classes" : null);
  const fixedIncomeCategoryName = useMemo(() => {
    return (
      assetClassesTaxonomy?.categories.find(
        (c) => !c.parentId && c.id === CASH_FIXED_INCOME_CATEGORY_ID,
      )?.name ?? t("settings:accounts.form_cash_classification_fixed_income")
    );
  }, [assetClassesTaxonomy, t]);

  useEffect(() => {
    if (isCreditCardAccount && currentTrackingMode !== "TRANSACTIONS") {
      form.setValue("trackingMode", "TRANSACTIONS", { shouldDirty: true, shouldValidate: true });
    }
  }, [currentTrackingMode, form, isCreditCardAccount]);

  // Perform the actual submit (after confirmation if needed)
  // Returns a promise when updating so it can be chained with other operations
  const doSubmit = useCallback(
    (data: AccountFormOutput, options?: { async?: boolean }) => {
      const { id, trackingMode, ...rest } = data;

      if (id) {
        if (options?.async) {
          return updateAccountMutation.mutateAsync({
            id,
            trackingMode,
            ...rest,
          });
        }
        return updateAccountMutation.mutate({ id, trackingMode, ...rest });
      }
      return createAccountMutation.mutate({ trackingMode, ...rest });
    },
    [createAccountMutation, updateAccountMutation],
  );

  function onSubmit(data: AccountFormOutput) {
    // Check if this is an existing account (update) and mode is switching from HOLDINGS to TRANSACTIONS
    const isExistingAccount = !!data.id;
    const isSwitchingFromHoldingsToTransactions =
      !needsSetup && initialTrackingMode === "HOLDINGS" && data.trackingMode === "TRANSACTIONS";

    if (isExistingAccount && isSwitchingFromHoldingsToTransactions) {
      // Show confirmation dialog
      setPendingFormData(data);
      setShowModeConfirmation(true);
      return;
    }

    // Otherwise, submit directly
    doSubmit(data);
  }

  // Handle confirmation dialog actions
  const handleConfirmModeSwitch = async () => {
    setShowModeConfirmation(false);
    if (pendingFormData?.id) {
      try {
        // Save all account details including tracking mode
        await doSubmit(pendingFormData, { async: true });
      } finally {
        setPendingFormData(null);
      }
    }
  };

  const handleCancelModeSwitch = () => {
    setShowModeConfirmation(false);
    setPendingFormData(null);
    // Revert the tracking mode in the form
    form.setValue("trackingMode", initialTrackingMode);
  };

  const applyCatalog = useCallback(
    (product: CatalogProduct) => {
      const values = form.getValues();
      const last = lastPrefill.current;
      form.setValue("meta", applyCatalogProduct(values.meta, product), { shouldDirty: true });
      if (!values.name || values.name === last?.name) {
        form.setValue("name", product.suggestedName, { shouldDirty: true });
      }
      if (!values.group || values.group === last?.group) {
        form.setValue("group", product.defaultGroup, { shouldDirty: true });
      }
      if (!defaultValues?.id) {
        const stillDefault = !last && values.currency === defaultValues?.currency;
        const stillLast = Boolean(last && values.currency === last.currency);
        if (stillDefault || stillLast) {
          form.setValue("currency", product.defaultCurrency, { shouldDirty: true });
        }
      }
      lastPrefill.current = {
        name: product.suggestedName,
        group: product.defaultGroup,
        currency: product.defaultCurrency,
      };
    },
    [defaultValues?.currency, defaultValues?.id, form],
  );

  const formTitle = defaultValues?.id
    ? t("settings:accounts_form_update_title")
    : t("settings:accounts_form_add_title");
  const formDescription = defaultValues?.id
    ? t("settings:accounts_form_update_description")
    : t("settings:accounts_form_add_description");
  const AccountTypeIcon = accountTypeVisual(currentAccountType).icon;

  return (
    <Form {...form}>
      <form
        data-testid="account-form"
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6 p-5 sm:p-6"
      >
        <DialogHeader className="pr-10 text-left">
          <div className="flex items-start gap-3">
            <div className="bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <AccountTypeIcon className="text-muted-foreground h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle>{formTitle}</DialogTitle>
              <DialogDescription>{formDescription}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
          <input type="hidden" name="id" />
          <section className={formCardClassName}>
            <h3 className={formSectionLabelClassName}>{t("settings:accounts.form_identity")}</h3>
            <div className="mt-4 grid gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings:accounts_form_name_label")}</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="account-name-input"
                        placeholder={t("settings:accounts_form_name_placeholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="group"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings:accounts_form_group_label")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("settings:accounts_form_group_placeholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountType"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t("settings:accounts_form_type_label")}</FormLabel>
                    <FormControl>
                      <AccountTypeCards
                        value={field.value}
                        labels={accountTypeLabels}
                        onChange={(type) => {
                          field.onChange(type);
                          if (type !== AccountType.CASH) {
                            form.setValue(
                              "meta",
                              setCatalogSelectionInMeta(
                                setProductInMeta(form.getValues("meta"), null),
                                null,
                                null,
                              ),
                              { shouldDirty: true },
                            );
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!defaultValues?.id ? (
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>{t("settings:accounts_form_currency_label")}</FormLabel>
                      <FormControl>
                        <CurrencyInput
                          data-testid="account-currency-select"
                          value={field.value}
                          onChange={(value: string) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {isCashAccount && (
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="text-sm font-medium">
                      {t("settings:accounts.form_institution_label")}
                    </label>
                    <p className="text-muted-foreground text-xs">
                      {t("settings:accounts.form_institution_description")}
                    </p>
                  </div>
                  <InstitutionCards
                    value={selectedInstitutionId}
                    customLabel={t("settings:accounts.form_institution_custom")}
                    onChange={(institutionId) => {
                      if (institutionId === CUSTOM_INSTITUTION_ID) {
                        form.setValue(
                          "meta",
                          setCatalogSelectionInMeta(form.getValues("meta"), null, null),
                          { shouldDirty: true },
                        );
                        return;
                      }
                      const firstProduct = getInstitution(institutionId)?.products[0];
                      if (firstProduct) applyCatalog(firstProduct);
                    }}
                  />
                </div>
              )}

              {isCashAccount && catalogInstitution && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">
                      {t("settings:accounts.form_institution_product_label")}
                    </label>
                    <p className="text-muted-foreground text-xs">
                      {t("settings:accounts.form_institution_product_description")}
                    </p>
                  </div>
                  <CatalogProductCards
                    products={catalogInstitution.products}
                    value={parsedCashMeta.productId}
                    onChange={applyCatalog}
                  />
                  {cashProductType && (
                    <CashProductFields
                      meta={cashMeta}
                      productKind={cashProductType}
                      headingOverride={
                        selectedCatalogProduct
                          ? {
                              title: selectedCatalogProduct.name,
                              description: selectedCatalogProduct.description,
                            }
                          : undefined
                      }
                      onMetaChange={(meta) => form.setValue("meta", meta, { shouldDirty: true })}
                    />
                  )}
                </div>
              )}

              {isCashAccount && selectedInstitutionId === CUSTOM_INSTITUTION_ID && (
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="text-sm font-medium">
                      {t("settings:accounts.form_cash_classification_label")}
                    </label>
                    <p className="text-muted-foreground text-xs">
                      {t("settings:accounts.form_cash_classification_description")}
                    </p>
                  </div>
                  <ToggleGroup
                    type="single"
                    aria-label={t("settings:accounts.form_cash_classification_aria")}
                    value={getSelectableCashCategoryFromMeta(form.watch("meta"))}
                    onValueChange={(v) => {
                      if (!v) return;
                      const categoryId = v === CASH_ALLOCATION_DEFAULT_VALUE ? null : v;
                      let updatedMeta = setCashCategoryInMeta(form.getValues("meta"), categoryId);
                      if (!categoryId) {
                        updatedMeta = setProductInMeta(updatedMeta, null);
                      }
                      form.setValue("meta", updatedMeta, { shouldDirty: true });
                    }}
                    className="bg-muted grid h-11 grid-cols-2 rounded-lg p-1"
                  >
                    <ToggleGroupItem
                      value={CASH_ALLOCATION_DEFAULT_VALUE}
                      className={cashClassificationItemClassName}
                    >
                      {t("settings:accounts.form_cash_classification_cash")}
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value={CASH_FIXED_INCOME_CATEGORY_ID}
                      className={cashClassificationItemClassName}
                    >
                      {fixedIncomeCategoryName}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}

              {isCashAccount &&
                selectedInstitutionId === CUSTOM_INSTITUTION_ID &&
                isFixedIncome && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">
                        {t("settings:accounts.form_fixed_income_product_label")}
                      </label>
                      <p className="text-muted-foreground text-xs">
                        {t("settings:accounts.form_fixed_income_product_description")}
                      </p>
                    </div>
                    <ToggleGroup
                      type="single"
                      aria-label={t("settings:accounts.form_fixed_income_product_aria")}
                      value={cashProductType ?? CASH_PRODUCT_NONE}
                      onValueChange={(value) => {
                        if (!value) return;
                        const existing = parseAccountMeta(cashMeta).product;
                        const next =
                          value === CASH_PRODUCT_NONE
                            ? null
                            : existing?.type === value
                              ? existing
                              : defaultCashProduct(value as CashProductType);
                        form.setValue(
                          "meta",
                          setCatalogSelectionInMeta(setProductInMeta(cashMeta, next), null, null),
                          { shouldDirty: true },
                        );
                      }}
                      className="bg-muted grid h-11 grid-cols-4 rounded-lg p-1"
                    >
                      <ToggleGroupItem
                        value={CASH_PRODUCT_NONE}
                        className={cashClassificationItemClassName}
                      >
                        {t("settings:accounts.form_product_none")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="HYSA" className={cashClassificationItemClassName}>
                        {t("settings:accounts.form_product_hysa")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="HYSA_GOAL"
                        className={cashClassificationItemClassName}
                      >
                        {t("settings:accounts.form_product_goal")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="PAGIBIG_MP2"
                        className={cashClassificationItemClassName}
                      >
                        {t("settings:accounts.form_product_mp2")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                    {cashProductType && (
                      <CashProductFields
                        meta={cashMeta}
                        productKind={cashProductType}
                        onMetaChange={(meta) => form.setValue("meta", meta, { shouldDirty: true })}
                      />
                    )}
                  </div>
                )}
            </div>
          </section>

          <div className="grid content-start gap-4">
            <FormField
              control={form.control}
              name="trackingMode"
              render={({ field }) => (
                <FormItem className={cn(formCardClassName, "space-y-4")}>
                  <FormLabel className={formSectionLabelClassName}>
                    {t("settings:accounts.form_tracking_mode_label")}
                  </FormLabel>
                  {needsSetup && !currentTrackingMode && (
                    <Alert
                      variant="warning"
                      className="px-3 py-2.5 [&>svg]:left-3 [&>svg]:top-2.5 [&>svg~*]:pl-6"
                    >
                      <Icons.AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        {t("settings:accounts.form_tracking_setup_hint")}{" "}
                        <a
                          href="https://wealthfolio.app/docs/concepts/activity-types"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground underline"
                        >
                          {t("settings:accounts.form_learn_more")}
                        </a>
                      </AlertDescription>
                    </Alert>
                  )}
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="grid gap-3"
                    >
                      <label
                        data-testid="tracking-mode-transactions"
                        className={cn(
                          trackingOptionClassName,
                          field.value === "TRANSACTIONS"
                            ? "border-primary bg-primary/5 dark:border-foreground/60 dark:bg-secondary/30"
                            : "border-border",
                        )}
                      >
                        <RadioGroupItem value="TRANSACTIONS" className="mt-0.5" />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {t("settings:accounts.form_tracking_transactions_title")}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {t("settings:accounts.form_tracking_transactions_description")}
                          </span>
                        </div>
                      </label>
                      {!isCreditCardAccount && (
                        <label
                          data-testid="tracking-mode-holdings"
                          className={cn(
                            trackingOptionClassName,
                            field.value === "HOLDINGS"
                              ? "border-primary bg-primary/5 dark:border-foreground/60 dark:bg-secondary/30"
                              : "border-border",
                          )}
                        >
                          <RadioGroupItem value="HOLDINGS" className="mt-0.5" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {t("settings:accounts.form_tracking_holdings_title")}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {t("settings:accounts.form_tracking_holdings_description")}
                            </span>
                          </div>
                        </label>
                      )}
                    </RadioGroup>
                  </FormControl>
                  {field.value === "HOLDINGS" && (
                    <Alert
                      variant="warning"
                      className="px-3 py-2.5 [&>svg]:left-3 [&>svg]:top-2.5 [&>svg~*]:pl-6"
                    >
                      <Icons.AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        {t("settings:accounts.form_tracking_holdings_warning")}{" "}
                        <a
                          href="https://wealthfolio.app/docs/concepts/activity-types"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground underline"
                        >
                          {t("settings:accounts.form_learn_more")}
                        </a>
                      </AlertDescription>
                    </Alert>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <section className={formCardClassName}>
              <h3 className={formSectionLabelClassName}>
                {t("settings:accounts.form_visibility")}
              </h3>
              <div className="mt-4 grid gap-4">
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 space-y-0">
                      <div className="min-w-0">
                        <FormLabel className="text-sm font-normal">
                          {t("settings:accounts.form_hide_label")}
                          <span className="text-muted-foreground ml-1 text-xs font-normal">
                            {t("settings:accounts.form_hide_hint")}
                          </span>
                        </FormLabel>
                        <FormMessage />
                      </div>
                      <FormControl>
                        <Switch
                          checked={!field.value}
                          onCheckedChange={(checked) => field.onChange(!checked)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {defaultValues?.id && (
                  <FormField
                    control={form.control}
                    name="isArchived"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-4 space-y-0">
                        <div className="min-w-0">
                          <FormLabel className="text-sm font-normal">
                            {t("settings:accounts.form_archive_label")}
                            <span className="text-muted-foreground ml-1 text-xs font-normal">
                              {t("settings:accounts.form_archive_hint")}
                            </span>
                          </FormLabel>
                          <FormMessage />
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </section>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button data-testid="account-cancel-button" type="button" variant="outline">
              {t("settings:accounts_cancel_button")}
            </Button>
          </DialogClose>
          <Button
            data-testid="account-submit-button"
            type="submit"
            disabled={needsSetup && !currentTrackingMode}
          >
            {defaultValues?.id ? (
              <Icons.Save className="h-4 w-4" />
            ) : (
              <Icons.Plus className="h-4 w-4" />
            )}
            <span>
              {defaultValues?.id
                ? t("settings:accounts_form_update_title")
                : t("settings:accounts_form_add_title")}
            </span>
          </Button>
        </DialogFooter>
      </form>

      {/* Mode Switch Confirmation Dialog */}
      <AlertDialog open={showModeConfirmation} onOpenChange={setShowModeConfirmation}>
        <AlertDialogContent className="max-w-105 gap-0 overflow-hidden p-0">
          <div className="px-5 pb-4 pt-5">
            <AlertDialogHeader className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100/30 dark:bg-orange-100/20">
                  <Icons.ArrowRightLeft className="h-4 w-4 text-orange-500 dark:text-orange-300" />
                </div>
                <AlertDialogTitle className="text-base font-semibold">
                  {t("settings:accounts.mode_switch_title")}
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription>
                {t("settings:accounts.mode_switch_description")}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* Checklist */}
            <div className="mt-4 rounded-lg border border-orange-100/40 bg-orange-100/30 p-3 dark:border-orange-100/20 dark:bg-orange-100/20">
              <p className="mb-2 text-xs font-medium text-orange-600 dark:text-orange-200">
                {t("settings:accounts.mode_switch_checklist_title")}
              </p>
              <ul className="space-y-2 text-[13px]">
                <li className="flex items-start gap-2">
                  <Icons.Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500 dark:text-orange-300" />
                  <span className="text-orange-500 dark:text-orange-200">
                    {t("settings:accounts.mode_switch_checklist_recorded")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Icons.Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500 dark:text-orange-300" />
                  <span className="text-orange-500 dark:text-orange-200">
                    {t("settings:accounts.mode_switch_checklist_accurate")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Icons.AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-300" />
                  <span className="text-orange-500 dark:text-orange-200">
                    {t("settings:accounts.mode_switch_checklist_gaps")}
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <AlertDialogFooter className="bg-muted/30 border-t px-5 py-3">
            <AlertDialogCancel onClick={handleCancelModeSwitch}>
              {t("settings:accounts.mode_switch_keep_holdings")}
            </AlertDialogCancel>
            <Button onClick={handleConfirmModeSwitch}>
              {t("settings:accounts.mode_switch_confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
