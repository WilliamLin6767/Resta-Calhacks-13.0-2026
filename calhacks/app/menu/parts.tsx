import type { Suggestion } from "@/lib/pricing/pricing";
import { formatMoney } from "@/lib/format";
import { SYSTEMS, type PriceChange, type System } from "@/lib/pricing/service";
import { ApprovePrice, MarkUpdated } from "./MenuActions";

// The suggested-price card and the copy-to-other-systems row, used on the Menu tab (the top
// three of each) and on their own pages (all of them).

// 1234.5 -> "$1,235", for estimates where cents are noise
export function formatWholeMoney(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const CLASS_LABELS: Record<string, string> = {
  star: "Star: popular and profitable",
  plowhorse: "Plowhorse: popular, lower margin",
  puzzle: "Puzzle: profitable, sells little",
  dog: "Dog: sells little, lower margin",
};

// Systems a change still has to be copied to. A change to the in-house price only also shows on
// the apps when the dish has no separate app price.
export function pending(c: PriceChange): System[] {
  const appsChanged = c.new_delivery_price !== c.old_delivery_price || (c.new_delivery_price === null && c.new_price !== c.old_price);
  return (Object.keys(SYSTEMS) as System[]).filter((s) => {
    if (s === "pos" && c.new_price === c.old_price) return false;
    if (s !== "pos" && !appsChanged) return false;
    return !c[`${s}_updated`];
  });
}

// Changes still to copy first, then the done ones; newest first within each (as loaded).
export function copyFirst(changes: PriceChange[]): PriceChange[] {
  return [...changes].sort((a, b) => Number(pending(a).length === 0) - Number(pending(b).length === 0));
}

export function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {s.dish.name}
          {s.dish.class && <span className="ml-2 text-xs font-normal text-gray-500">{CLASS_LABELS[s.dish.class]}</span>}
        </p>
        <p className="tabular-nums">
          <span className="text-gray-500">{formatMoney(s.dish.price)}</span> → <span className="text-lg font-semibold">{formatMoney(s.new_price)}</span>
        </p>
      </div>
      <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
        {s.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {s.action === "review" ? "Your call: this one needs a look first." : `About ${formatWholeMoney(s.extra_profit)} more a month if the same number sell.`}
        </p>
        <ApprovePrice menuItemId={s.dish.id} suggested={s.new_price ?? s.dish.price} reason={s.reasons[0] ?? ""} />
      </div>
    </div>
  );
}

export function ChangeRow({ c }: { c: PriceChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-100 bg-white px-4 py-2 text-sm">
      <p>
        <span className="font-medium">{c.menu_items?.name}</span>{" "}
        {c.new_price !== c.old_price && <span className="tabular-nums">{formatMoney(c.old_price)} → {formatMoney(c.new_price)}</span>}
        {c.new_delivery_price !== c.old_delivery_price && (
          <span className="tabular-nums"> apps: {formatMoney(c.old_delivery_price ?? c.old_price)} → {formatMoney(c.new_delivery_price)}</span>
        )}
        <span className="ml-2 text-xs text-gray-400">{new Date(c.changed_at).toLocaleDateString("en-US")}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(SYSTEMS) as System[]).map((s) =>
          pending(c).includes(s) || c[`${s}_updated`] ? (
            <MarkUpdated key={s} changeId={c.id} system={s} label={SYSTEMS[s]} done={c[`${s}_updated`]} />
          ) : null,
        )}
      </div>
    </div>
  );
}
