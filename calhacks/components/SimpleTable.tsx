import { isValidElement } from "react";
import { table, tableWrap, td, th, thead, tr } from "@/components/ui/table";

type Column = { key: string; label: string };

type Props = {
  columns: Column[];
  rows: Record<string, unknown>[];
  empty?: React.ReactNode; // shown instead of "No rows yet." (e.g. an <EmptyState>)
};

// A plain bordered table. Each column's `key` picks the value out of each row.
// A value can be text, a number, or a React element such as a <Badge>.
export default function SimpleTable({ columns, rows, empty }: Props) {
  if (rows.length === 0) {
    return empty ?? <p className="text-sm text-gray-500">No rows yet.</p>;
  }

  return (
    <div className={tableWrap}>
      <table className={table}>
        <thead className={thead}>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={th}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={tr}>
              {columns.map((col) => {
                const value = row[col.key];
                return (
                  <td key={col.key} className={td}>
                    {isValidElement(value) ? value : String(value ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
