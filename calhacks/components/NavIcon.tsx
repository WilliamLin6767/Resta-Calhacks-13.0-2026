import { ICONS } from "@/lib/nav";

// One of the section icons from lib/nav.ts, drawn with the text color.
export default function NavIcon({ icon, size = 24 }: { icon: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={ICONS[icon]} />
    </svg>
  );
}
