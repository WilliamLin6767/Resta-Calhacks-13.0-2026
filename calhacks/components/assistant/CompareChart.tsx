"use client";

// A bar chart of one analytics_compare result. Used on the Compare page and in assistant answers.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SERIES_COLORS } from "@/lib/analytics";
import { chartLayout, compareSummary, formatMetricValue, rowLabel, type CompareResult } from "@/lib/compare";

const GRID = "#e5e7eb";
const AXIS = { fontSize: 11, fill: "#52514e" };

export default function CompareChart({ result, height }: { result: CompareResult; height?: number }) {
  const fmt = (v: unknown) => formatMetricValue(result.metric, v === null || v === undefined ? null : Number(v));
  const data = result.rows.map((r) => ({
    label: rowLabel(result.breakdown, r),
    value: r.value,
    prev: r.prev_value,
  }));
  const ranked = chartLayout(result.breakdown) === "ranked";

  if (data.length === 0) return <p className="text-sm text-gray-500">No data for this period.</p>;

  return (
    // The summary is the screen-reader version of the chart.
    <div role="img" aria-label={compareSummary(result)}>
      <ResponsiveContainer width="100%" height={height ?? (ranked ? Math.max(120, 34 * data.length + 30) : 240)}>
        {ranked ? (
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickFormatter={fmt} />
            <YAxis type="category" dataKey="label" tick={AXIS} width={110} />
            <Tooltip formatter={fmt} cursor={{ fill: "#f3f4f6" }} />
            <Bar dataKey="value" name="This period" fill={SERIES_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} minTickGap={8} />
            <YAxis tick={AXIS} tickFormatter={fmt} width={56} />
            <Tooltip formatter={fmt} cursor={{ fill: "#f3f4f6" }} />
            <Bar dataKey="value" name="This period" fill={SERIES_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
