type Column = { key: string; label: string };

type Props = {
  columns: Column[];
  rows: Record<string, unknown>[];
};

// A plain bordered table. Each column's `key` picks the value out of each row.
export default function SimpleTable({ columns, rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No rows yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="border-b border-gray-200 px-3 py-2 font-semibold">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2">
                  {String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
