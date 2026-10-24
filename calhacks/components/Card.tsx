// A white card with a soft border tinted in the section's color. Used for every box on every page.
export default function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode; // optional thing on the right of the title, e.g. a link
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-brand-100 bg-white p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              {/* A short bar in the section's color */}
              <span className="h-4 w-1 rounded-full bg-brand-500" aria-hidden="true" />
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
