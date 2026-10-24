const TONES = {
  green: "bg-green-50 text-green-700 ring-green-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  gray: "bg-gray-50 text-gray-600 ring-gray-500/20",
};

export type BadgeTone = keyof typeof TONES;

// A small colored label, e.g. "Low" or "+12%". Always has text, so it never relies on color alone.
export default function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}
