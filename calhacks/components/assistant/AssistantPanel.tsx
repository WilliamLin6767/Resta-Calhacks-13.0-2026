"use client";

import { useEffect, useRef, useState } from "react";
import { useAssistant } from "./AssistantProvider";
import CompareChart from "./CompareChart";

const SUGGESTIONS = ["Which weekday is slowest?", "What changed this period?", "Which dishes make the most profit?"];

// The assistant: a floating "Ask AI" button that opens a chat panel on the right.
export default function AssistantPanel() {
  const { open, setOpen, messages, loading, error, send, newChat, focus, visible, clearFocus } = useAssistant();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest message in view, and focus the box when the panel opens.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, loading, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  async function submit(text: string) {
    if (!text.trim() || loading) return;
    setDraft("");
    await send(text);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 rounded-full bg-brand-600 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
      >
        ✦ Ask AI
      </button>
    );
  }

  return (
    <aside
      aria-label="AI assistant"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-gray-200 bg-white shadow-xl sm:w-[400px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">✦ Assistant</h2>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button type="button" onClick={newChat} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900">
              New chat
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="rounded px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            ×
          </button>
        </div>
      </div>

      {/* What the assistant will use as "this" */}
      <div className="border-b border-gray-100 px-4 py-1.5 text-xs text-gray-500">
        {/* Only the focus is announced, so scrolling doesn't spam screen readers. */}
        <p aria-live="polite" className={focus ? "flex items-center gap-1" : "sr-only"}>
          {focus && (
            <>
              <span className="truncate">
                Looking at: <span className="font-medium text-gray-700">{focus.title}</span>
              </span>
              <button
                type="button"
                onClick={clearFocus}
                aria-label="Stop using this chart"
                className="ml-auto rounded px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                ×
              </button>
            </>
          )}
        </p>
        {!focus && <p className="truncate">{visible.length > 0 ? `On screen: ${visible.map((c) => c.title).join(", ")}` : "Ask about your sales, menu or costs."}</p>}
      </div>

      {/* Conversation */}
      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Ask a question about your restaurant&apos;s numbers, or press Explain on any chart.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:border-gray-400"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 text-right">
              <p className="inline-block rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-left text-sm whitespace-pre-wrap text-white">
                {m.content}
              </p>
              {m.about && <p className="mt-0.5 text-[11px] text-gray-400">about: {m.about}</p>}
            </div>
          ) : (
            <div key={m.id} className="mr-4 space-y-3">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">{m.content}</p>
              {m.charts?.map((chart, i) => (
                <figure key={i} className="rounded-lg border border-gray-200 p-3">
                  <figcaption className="mb-2 text-xs font-medium text-gray-600">{chart.title}</figcaption>
                  <CompareChart result={chart} height={chart.rows.length > 8 && chart.breakdown !== "day" ? undefined : 200} />
                </figure>
              ))}
            </div>
          ),
        )}

        {loading && <p className="text-sm text-gray-500">Thinking...</p>}
        {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {/* Question box: Enter sends, Shift+Enter adds a line */}
      <form
        className="border-t border-gray-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-question" className="sr-only">
            Ask a question
          </label>
          <textarea
            id="assistant-question"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder="Ask about sales, dishes, costs..."
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
