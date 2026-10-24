const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// formatMoney(1234.5) -> "$1,234.50". Empty values show as "$0.00".
export function formatMoney(value: number | string | null | undefined): string {
  return money.format(Number(value ?? 0));
}
