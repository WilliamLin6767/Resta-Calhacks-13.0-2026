import LiveValue from "./LiveValue";

const SUB_TONE = { good: "text-green-700", bad: "text-red-700", neutral: "text-gray-500" };

// One headline number with a label and an optional line under it. The number flashes when an
// action changes it (LiveValue).
export default function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  className = "",
}: {
  label?: string;
  value: string;
  sub?: React.ReactNode;
  tone?: keyof typeof SUB_TONE;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <p className="text-sm text-gray-500">{label}</p>}
      <p className="text-3xl font-semibold tracking-tight tabular-nums text-gray-900">
        <LiveValue value={value} />
      </p>
      {sub && <p className={`mt-1 text-sm ${SUB_TONE[tone]}`}>{sub}</p>}
    </div>
  );
}
