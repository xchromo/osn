/**
 * Format an event price for display.
 *
 * Events store price in minor units (cents/pence/yen). Free events have
 * both fields null. The rule: null OR 0 → "Free". Otherwise format via
 * Intl with the stored ISO currency.
 *
 * Kept deliberately permissive on the currency arg — the API restricts
 * to the SUPPORTED_CURRENCIES allowlist, but this helper accepts any
 * string so legacy / future codes don't crash the UI.
 */
const EXPONENT: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
};

export function formatPrice(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale?: string,
): string {
  if (amount == null || amount === 0 || !currency) return "Free";
  const exp = EXPONENT[currency] ?? 2;
  const major = amount / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(exp)}`;
  }
}
