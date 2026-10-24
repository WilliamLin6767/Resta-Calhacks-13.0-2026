"use client";

import { useState } from "react";
import { MENU_CLASSES, type MenuRow } from "@/lib/analytics";
import { formatMoney } from "@/lib/format";

type SortKey = "name" | "class" | "units" | "price" | "unit_margin" | "food_cost_pct" | "gross_profit";

const COLUMNS: { key: SortKey; label: string; money?: boolean; suffix?: string }[] = [
  { key: "name", label: "Dish" },
  { key: "class", label: "Class" },
  { key: "units", label: "Units sold" },
  { key: "price", label: "Price", money: true },
  { key: "unit_margin", label: "Margin per plate", money: true },
  { key: "food_cost_pct", label: "Food cost", suffix: "%" },
  { key: "gross_profit", label: "Gross profit", money: true },
];

// Menu table you can sort by clicking a column header (click again to flip the order).
export default function MenuTable({ menu }: { menu: MenuRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("gross_profit");
  const [ascending, setAscending] = useState(false);

  const sorted = [...menu].sort((a, b) => {
    const x = a[sortKey];
    const y = b[sortKey];
    const result = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return ascending ? result : -result;
  });

  function sortBy(key: SortKey) {
    if (key === sortKey) setAscending(!ascending);
    else {
      setSortKey(key);
      setAscending(key === "name" || key === "class");
    }
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-50 text-brand-700">
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className="border-b border-gray-200 px-3 py-2 font-semibold">
                <button onClick={() => sortBy(col.key)} className="hover:underline">
                  {col.label}
                  {sortKey === col.key && (ascending ? " ▲" : " ▼")}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((dish) => (
            <tr key={dish.name} className="border-b border-gray-100 last:border-0">
              {COLUMNS.map((col) => (
                <td key={col.key} className="px-3 py-2">
                  {col.key === "class" ? (
                    <ClassLabel id={dish.class} />
                  ) : col.money ? (
                    formatMoney(dish[col.key])
                  ) : (
                    `${dish[col.key]}${col.suffix ?? ""}`
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassLabel({ id }: { id: MenuRow["class"] }) {
  const c = MENU_CLASSES.find((m) => m.id === id);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c?.color }} />
      {c?.label ?? id}
    </span>
  );
}
