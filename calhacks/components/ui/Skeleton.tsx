import { tableWrap } from "./table";

// Placeholders shown while a part of the page loads (as Suspense fallbacks). Sized like the real
// content so nothing jumps when it arrives. The shimmer is in globals.css (.skeleton); with
// reduced motion they're still gray blocks.

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  // A span, so it can stand in for text inside a <p> too.
  return <span className={`skeleton block rounded-md ${className}`} style={style} aria-hidden="true" />;
}

// The wrapper every shape uses: announced once as "Loading", the blocks themselves are hidden.
function Loading({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">Loading</span>
      {children}
    </div>
  );
}

// A big number with a small line under it (like Stat).
export function SkeletonStat({ className = "" }: { className?: string }) {
  return (
    <Loading className={className}>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="mt-2 h-4 w-40" />
    </Loading>
  );
}

// A few lines of text; the last one shorter, like a paragraph.
export function SkeletonLines({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <Loading className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </Loading>
  );
}

// A table with the same border and radius as SimpleTable.
export function SkeletonTable({ rows = 4, cols = 4, className = "" }: { rows?: number; cols?: number; className?: string }) {
  return (
    <Loading className={className}>
      <div className={tableWrap}>
        <div className="flex gap-4 border-b border-brand-100 bg-brand-50 px-3 py-2.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3 flex-1 bg-brand-100" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 border-b border-gray-100 px-3 py-3 last:border-0">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? "" : "max-w-24"}`} />
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

// A chart area of the given height.
export function SkeletonChart({ height = 240, className = "" }: { height?: number; className?: string }) {
  return (
    <Loading className={className}>
      <Skeleton className="w-full rounded-xl" style={{ height }} />
    </Loading>
  );
}
