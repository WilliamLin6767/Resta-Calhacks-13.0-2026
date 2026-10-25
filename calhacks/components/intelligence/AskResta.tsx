"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { askHref } from "./areaStyle";

const GENERAL = [
  "What should I prioritize today?",
  "What is our biggest opportunity to save money?",
  "Which inventory issues affect our menu?",
  "What should we promote this week?",
  "Why has dinner profitability changed?",
];

// The way into the one chat (app/chat), with the operating picture already in its prompt.
// suggestions: questions about the discoveries on this page first.
export default function AskResta({ suggestions }: { suggestions: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const chips = [...new Set([...suggestions.slice(0, 2), ...GENERAL])].slice(0, 6);
  return (
    <div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(askHref(q.trim()));
        }}
      >
        <label htmlFor="ask-resta" className="sr-only">Ask Resta</label>
        <input
          id="ask-resta"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          placeholder="Ask about anything across the restaurant..."
          className="min-h-11 flex-1 rounded-full border border-gray-300 bg-white px-4 text-base focus:border-gray-900 focus:outline-none md:text-sm"
        />
        <button type="submit" disabled={!q.trim()} className="min-h-11 rounded-full bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          Ask Resta
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => router.push(askHref(c))}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-left text-sm text-gray-700 hover:border-brand-200 hover:bg-brand-50"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
