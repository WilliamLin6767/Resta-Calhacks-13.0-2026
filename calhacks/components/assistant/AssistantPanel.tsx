"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AiThinking from "@/components/ui/AiThinking";
import { useToast } from "@/components/ui/Toaster";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import { useAssistant } from "./AssistantProvider";
import CompareChart from "./CompareChart";
import { chatText } from "@/components/ChatText";

const CLOSE_MS = 300; // the slide-out's length in globals.css (.assistant-panel[data-closing])

const SUGGESTIONS =["Which weekday is slowest?", "What changed this period?", "Which dishes make the most profit?"];

// The assistant: a floating "Ask AI" button that opens a chat panel on the right. On wide
// screens the panel floats in the dark shell like the page panel (same gap, same corners).
export default function AssistantPanel() {
  const { open, setOpen, messages, loading, error, send, newChat, focus, visible, clearFocus } = useAssistant();
  const [draft, setDraft] = useState("");
  // Closing: the panel stays up while it slides out to the right (globals.css .assistant-panel),
  // then a timer removes it, so it always goes even if the browser skips the transition.
  const [closing, setClosing] = useState(false);
  const reduced = useReducedMotion();
  if (!open && closing) setClosing(false); // closed some other way mid-slide: start fresh next time
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const toast = useToast();

  // Keep the newest message in view, and focus the box when the panel opens.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, loading, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Problems show as a toast too, so they're seen even with the panel closed. An answer that
  // arrives after the panel was closed gets a toast with a way back to it.
  useEffect(() => {
    if (error) toast({ message: error, tone: "error" });
  }, [error, toast]);
  const lastId = messages.at(-1)?.id;
  const lastRole = messages.at(-1)?.role;
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    if (lastRole === "assistant" && !openRef.current) {
      toast({ message: "The assistant answered.", tone: "info", action: { label: "Open", onClick: () => setOpen(true) } });
    }
  }, [lastId, lastRole, toast, setOpen]);

  // With reduced motion there's no slide, so the panel just goes.
  const close = useCallback(() => {
    if (reduced) setOpen(false);
    else setClosing(true);
  }, [reduced, setOpen]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closing, setOpen]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function submit(text: string) {
    if (!text.trim() || loading) return;
    setDraft("");
    await send(text);
  }

  if (!open) {
    // The Chat page is its own assistant, and its composer sits where this button would.
    if (pathname === "/chat" || pathname === "/login") return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-8 bottom-8 z-40 hidden rounded-full bg-brand-600 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-brand-700 md:inline-flex"
      >
        ✦ Ask AI
      </button>
    );
  }

  return (
    <aside
      aria-label="AI assistant"
      data-closing={closing || undefined}
      className={`assistant-panel fixed inset-y-0 right-0 z-[60] flex w-full flex-col overflow-hidden bg-white shadow-2xl shadow-black/40 sm:w-[400px] md:inset-y-4 md:right-4 md:rounded-[30px] ${closing ? "pointer-events-none" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 pt-5 pb-3">
        <h2 className="text-base font-semibold text-gray-900">✦ Assistant</h2>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button type="button" onClick={newChat} className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900">
              New chat
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close assistant"
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            ×
          </button>
        </div>
      </div>

      {/* What the assistant will use as "this" */}
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-2 text-xs text-gray-500">
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
                className="ml-auto rounded-full px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                ×
              </button>
            </>
          )}
        </p>
        {!focus && <p className="truncate">{visible.length > 0 ? `On screen: ${visible.map((c) => c.title).join(", ")}` : "Ask about your sales, menu or costs."}</p>}
      </div>

      {/* Conversation */}
      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
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
                className="block w-full rounded-2xl border border-gray-200 px-4 py-2.5 text-left text-sm text-gray-700 hover:border-brand-200 hover:bg-brand-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 text-right">
              <p className="inline-block rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-left text-sm whitespace-pre-wrap text-white">
                {m.content}
              </p>
              {m.about && <p className="mt-0.5 text-[11px] text-gray-400">about: {m.about}</p>}
            </div>
          ) : (
            <div key={m.id} className="mr-4 space-y-3">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">{chatText(m.content)}</p>
              {m.charts?.map((chart, i) => (
                <figure key={i} className="rounded-2xl border border-gray-200 p-3">
                  <figcaption className="mb-2 text-xs font-medium text-gray-600">{chart.title}</figcaption>
                  <CompareChart result={chart} height={chart.rows.length > 8 && chart.breakdown !== "day" ? undefined : 200} />
                </figure>
              ))}
            </div>
          ),
        )}

        {loading && <AiThinking label="Thinking..." />}
        {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {/* Question box: Enter sends, Shift+Enter adds a line */}
      <form
        className="border-t border-gray-100 px-4 pt-3 pb-4"
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
            className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="h-10 rounded-full bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
