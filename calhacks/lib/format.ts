const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// formatMoney(1234.5) -> "$1,234.50". Empty values show as "$0.00".
export function formatMoney(value: number | string | null | undefined): string {
  return money.format(Number(value ?? 0));
}

// formatWholeMoney(1234.5) -> "$1,235". For headlines where cents are noise.
export function formatWholeMoney(value: number | string | null | undefined): string {
  return wholeMoney.format(Number(value ?? 0));
}
