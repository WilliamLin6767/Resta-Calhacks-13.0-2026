// Collapsed by default so sent posts don't sit in the way of this week's drafts.
export default function PastPosts({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <details className="group mt-10 rounded-2xl border border-brand-100 bg-white">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-gray-900 [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block text-gray-400 transition-transform group-open:rotate-90" aria-hidden="true">
          ▸
        </span>
        Past posts ({count})
      </summary>
      <div className="grid gap-4 border-t border-brand-100 p-4 lg:grid-cols-3">{children}</div>
    </details>
  );
}
