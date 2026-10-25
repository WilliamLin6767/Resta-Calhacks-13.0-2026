"use client";

// Charts for the Analytics page. They only draw what they're given:
// the server component fetches the digest and passes pieces of it in as props.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useAnimateOnce } from "@/components/ui/useAnimateOnce";
import { MENU_CLASSES, SERIES_COLORS as SERIES, type ChannelRow, type Digest, type MenuRow } from "@/lib/analytics";
import { formatMoney } from "@/lib/format";
const GRID = "var(--chart-grid)";
const AXIS = { fontSize: 12, fill: "var(--chart-axis)" };

const money = (value: unknown) => formatMoney(Number(value));
const shortMoney = (value: unknown) => `$${Math.round(Number(value)).toLocaleString("en-US")}`;

// Revenue per day (line). Closed days show as 0.
export function DailyRevenueChart({ daily }: { daily: Digest["daily"] }) {
  const animate = useAnimateOnce();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={daily} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis tick={AXIS} tickFormatter={shortMoney} width={64} />
        <Tooltip formatter={money} labelFormatter={(d) => `Date: ${d}`} />
        <Line type="monotone" dataKey="revenue" name="Revenue" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={animate} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Average revenue by weekday (bar).
export function WeekdayChart({ rows }: { rows: Digest["by_weekday"] }) {
  const animate = useAnimateOnce();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="weekday" tick={AXIS} tickFormatter={(d: string) => d.slice(0, 3)} />
        <YAxis tick={AXIS} tickFormatter={shortMoney} width={64} />
        <Tooltip formatter={money} cursor={{ fill: "var(--chart-cursor)" }} />
        <Bar dataKey="avg_revenue" name="Avg revenue" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={animate} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Average orders by hour of the day (bar).
export function HourChart({ rows }: { rows: Digest["by_hour"] }) {
  const animate = useAnimateOnce();
  const data = rows.map((r) => ({ ...r, label: hourLabel(r.hour) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} />
        <YAxis tick={AXIS} width={40} />
        <Tooltip cursor={{ fill: "var(--chart-cursor)" }} />
        <Bar dataKey="avg_orders" name="Avg orders" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={animate} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function hourLabel(hour: number) {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

// Revenue by channel (donut), with each channel's platform fees listed beside it.
export function ChannelDonut({ channels }: { channels: ChannelRow[] }) {
  const animate = useAnimateOnce();
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={channels}
              dataKey="revenue"
              nameKey="channel"
              innerRadius="60%"
              outerRadius="100%"
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={animate}
            >
              {channels.map((c, i) => (
                <Cell key={c.channel} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip formatter={money} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {channels.map((c, i) => (
          <li key={c.channel} className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
            <span>
              <span className="font-medium">{channelName(c.channel)}</span>: {formatMoney(c.revenue)} (
              {c.revenue_share_pct}%)
              {c.platform_fees > 0 && (
                <span className="block text-gray-500">
                  {formatMoney(c.platform_fees)} in platform fees ({c.fee_rate_pct}%), keeps{" "}
                  {formatMoney(c.net_revenue)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function channelName(channel: string) {
  const names: Record<string, string> = {
    dine_in: "Dine-in",
    takeout: "Takeout",
    doordash: "DoorDash",
    ubereats: "Uber Eats",
  };
  return names[channel] ?? channel;
}

// Menu engineering: each dish by popularity (x) and profit per plate (y).
// Each class gets its own color AND marker shape, so it doesn't rely on color alone.
export function MenuScatter({ menu, thresholds }: { menu: MenuRow[]; thresholds: Digest["menu_thresholds"] }) {
  const animate = useAnimateOnce();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 8, right: 24, bottom: 16, left: 8 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="units" name="Units sold" tick={AXIS} label={{ value: "Units sold", position: "insideBottom", offset: -8, fontSize: 12 }} />
        <YAxis type="number" dataKey="unit_margin" name="Margin per plate" tick={AXIS} tickFormatter={shortMoney} width={56} />
        <ZAxis range={[90, 90]} />
        {/* Dashed lines mark the cut-offs the database used to sort dishes into classes */}
        <ReferenceLine x={thresholds.popularity_threshold ?? undefined} stroke="#9ca3af" strokeDasharray="4 4" />
        <ReferenceLine y={thresholds.margin_threshold ?? undefined} stroke="#9ca3af" strokeDasharray="4 4" />
        <Tooltip content={<MenuTooltip />} />
        <Legend verticalAlign="top" height={28} />
        {MENU_CLASSES.map((c) => (
          <Scatter
            key={c.id}
            name={c.label}
            data={menu.filter((m) => m.class === c.id)}
            fill={c.color}
            shape={c.shape}
            stroke="#ffffff"
            strokeWidth={2}
            isAnimationActive={animate}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function MenuTooltip({ active, payload }: { active?: boolean; payload?: { payload: MenuRow }[] }) {
  if (!active || !payload?.length) return null;
  const dish = payload[0].payload;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-sm shadow">
      <p className="font-medium">{dish.name}</p>
      <p>{dish.units} sold</p>
      <p>{formatMoney(dish.unit_margin)} margin per plate</p>
    </div>
  );
}

// Where the money goes: food, platform fees and each fixed cost (horizontal bars).
export function CostBreakdownChart({ costs }: { costs: Digest["costs"] }) {
  const animate = useAnimateOnce();
  const rows = [
    { name: "Food", amount: costs.food },
    { name: "Platform fees", amount: costs.platform_fees },
    ...Object.entries(costs.fixed).map(([name, amount]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      amount,
    })),
  ].sort((a, b) => b.amount - a.amount);

  return (
    <ResponsiveContainer width="100%" height={40 * rows.length + 30}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={shortMoney} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={96} />
        <Tooltip formatter={money} cursor={{ fill: "var(--chart-cursor)" }} />
        <Bar
          dataKey="amount"
          name="Amount"
          fill={SERIES[0]}
          radius={[0, 4, 4, 0]}
          label={{ position: "right", fontSize: 12, fill: "var(--chart-axis)", formatter: shortMoney }}
          isAnimationActive={animate}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
