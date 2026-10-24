import Link from "next/link";
import type { ReactNode } from "react";

// The first few items of a longer list, with a link to the page that has them all
// (the same idea as "What changed" on Analytics). The caller passes only the items to show.
export default function PreviewSection({
  id,
  title,
  description,
  href,
  total,
  shown,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  href: string;
  total: number;
  shown: number;
  action?: ReactNode; // a button next to the heading
  children: ReactNode;
}) {
  const more = total - shown;
  return (
    <section id={id} className="mb-8 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-gray-600">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {more > 0 && (
            <Link href={href} className="text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline">
              See all {total} →
            </Link>
          )}
          {action}
        </div>
      </div>
      {children}
      {more > 0 && (
        <Link href={href} className="mt-3 inline-block text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline">
          {more} more →
        </Link>
      )}
    </section>
  );
}
