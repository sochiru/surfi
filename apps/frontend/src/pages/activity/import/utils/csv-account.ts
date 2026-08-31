export interface CsvAccountRef {
  id: string;
  name?: string | null;
}

/**
 * Maps a CSV account cell to a destination account id.
 * Order: explicit mapping, then account id, then a unique account name.
 */
export function accountIdFromCsvValue(
  raw: string | null | undefined,
  accounts: readonly CsvAccountRef[],
  accountMappings: Record<string, string> = {},
): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  const mapped = accountMappings[value] ?? accountMappings[value.toLowerCase()];
  if (mapped) return mapped;

  if (accounts.some((account) => account.id === value)) return value;

  const exact = accounts.filter((account) => account.name?.trim() === value);
  if (exact.length === 1) return exact[0].id;

  const lowered = value.toLowerCase();
  const insensitive = accounts.filter((account) => account.name?.trim().toLowerCase() === lowered);
  if (insensitive.length === 1) return insensitive[0].id;

  return undefined;
}
