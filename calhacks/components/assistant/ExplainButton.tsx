"use client";

import type { ExplainTarget } from "@/lib/assistant";
import { useAssistant } from "./AssistantProvider";

// "Explain" on a chart: opens the assistant and asks it about this chart.
export default function ExplainButton({ target, title }: { target: ExplainTarget; title: string }) {
  const { explain, loading } = useAssistant();
  return (
    <button
      type="button"
      onClick={() => explain(target, title)}
      disabled={loading}
      aria-label={`Explain ${title}`}
      className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:opacity-50"
    >
      ✦ Explain
    </button>
  );
}
