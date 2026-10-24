import { isValidElement } from "react";

type Column = { key: string; label: string };

type Props = {
  columns: Column[];
  rows: Record<string, unknown>[];
};

// A plain bordered table. Each column's `key` picks the value out of each row.
// A value can be text, a number, or a React element such as a <Badge>.
export default function SimpleTable({ columns, rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No rows yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-brand-100 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-b border-brand-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-brand-700"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-brand-50/60">
              {columns.map((col) => {
                const value = row[col.key];
                return (
                  <td key={col.key} className="px-3 py-2 text-gray-800">
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
