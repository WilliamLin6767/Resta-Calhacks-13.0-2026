"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAnimateOnce } from "@/components/ui/useAnimateOnce";

// USDA average price over the dates already stored for one series.
export default function MarketSeriesChart({ rows }: { rows: { date: string; price: number }[] }) {
  const animate = useAnimateOnce(); // draws once; a refresh updates it in place
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--chart-axis)" }} tickFormatter={(date: string) => date.slice(5)} minTickGap={24} />
        <YAxis tick={{ fontSize: 12, fill: "var(--chart-axis)" }} width={48} />
        <Tooltip />
        <Line type="monotone" dataKey="price" name="USDA price" stroke="#2a78d6" strokeWidth={2} dot={false} isAnimationActive={animate} />
      </LineChart>
    </ResponsiveContainer>
  );
}
