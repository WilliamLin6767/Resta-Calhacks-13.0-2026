import NavIcon from "@/components/NavIcon";
import type { ICONS } from "@/lib/nav";

// What a card or table shows when there's nothing in it: a calm sentence, maybe a hint and a button.
export default function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: keyof typeof ICONS;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      {icon && (
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-500">
          <NavIcon icon={icon} size={20} />
        </span>
      )}
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-gray-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
