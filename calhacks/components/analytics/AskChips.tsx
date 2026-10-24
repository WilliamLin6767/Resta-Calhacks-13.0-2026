"use client";

import { useAssistant } from "@/components/assistant/AssistantProvider";

// Ready-made questions: one tap opens the assistant and asks it.
export default function AskChips({ questions }: { questions: string[] }) {
  const { send, setOpen, loading } = useAssistant();
  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          disabled={loading}
          onClick={() => {
            setOpen(true);
            send(q);
          }}
          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          ✦ {q}
        </button>
      ))}
    </div>
  );
}
