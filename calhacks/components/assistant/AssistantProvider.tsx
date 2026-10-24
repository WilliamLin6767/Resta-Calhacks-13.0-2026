"use client";

// Holds the assistant chat and tracks which charts are on screen.
// The browser only sends chart ids (targets); the server looks up the numbers itself.

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { parseDays } from "@/lib/analytics";
import type { AssistantChart, AssistantResponse, AssistantView, ExplainTarget } from "@/lib/assistant";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  about?: string; // the chart the question was asked about, shown under it later
  charts?: AssistantChart[];
};

export type VisibleChart = { key: string; target: ExplainTarget; title: string; ratio: number };

type ScreenState = { visible: VisibleChart[]; focus: VisibleChart | null };

type AssistantContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  explain: (target: ExplainTarget, title: string) => Promise<void>;
  newChat: () => void;
  visible: VisibleChart[];
  focus: VisibleChart | null;
  clearFocus: () => void;
  // Used by <ChartView>:
  reportVisibility: (key: string, target: ExplainTarget, title: string, ratio: number) => void;
  unregister: (key: string) => void;
  pin: (key: string) => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}

// One stable string per chart, used as its key everywhere.
export function targetKey(target: ExplainTarget): string {
  return "chart" in target ? `chart:${target.chart}` : `compare:${target.compare.metric}:${target.compare.breakdown}`;
}

const UPDATE_EVERY_MS = 200; // at most one screen-state update per 200ms while scrolling
const FOCUS_MIN = 0.25; // a pinned chart stays the focus while at least 25% visible
const AUTO_FOCUS_MIN = 0.5; // otherwise the most visible chart, if at least 50% visible
const MAX_SENT_MESSAGES = 12;
const MAX_VISIBLE_SENT = 8;

export default function AssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<ScreenState>({ visible: [], focus: null });

  // Live chart visibility, kept in refs so scrolling doesn't re-render the app.
  const charts = useRef(new Map<string, { target: ExplainTarget; title: string; ratio: number }>());
  const pinned = useRef<string | null>(null); // last chart explained, clicked or hovered
  const suppressed = useRef(false); // the owner pressed "x": no focus for the next question
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignature = useRef("");
  const nextId = useRef(1);

  // Works out the visible list and the focus from the refs.
  const computeScreen = useCallback((): ScreenState => {
    const visible = [...charts.current.entries()]
      .filter(([, c]) => c.ratio > 0)
      .map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => b.ratio - a.ratio);
    let focus: VisibleChart | null = null;
    if (!suppressed.current) {
      const pinnedChart = visible.find((c) => c.key === pinned.current);
      if (pinnedChart && pinnedChart.ratio >= FOCUS_MIN) focus = pinnedChart;
      else if (visible[0] && visible[0].ratio >= AUTO_FOCUS_MIN) focus = visible[0];
    }
    return { visible, focus };
  }, []);

  // Updates state only when the ordered list or the focus actually changed.
  const flush = useCallback(() => {
    timer.current = null;
    const next = computeScreen();
    const signature = `${next.visible.map((c) => c.key).join("|")}#${next.focus?.key ?? ""}`;
    if (signature !== lastSignature.current) {
      lastSignature.current = signature;
      setScreen(next);
    }
  }, [computeScreen]);

  const scheduleFlush = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(flush, UPDATE_EVERY_MS);
  }, [flush]);

  const reportVisibility = useCallback(
    (key: string, target: ExplainTarget, title: string, ratio: number) => {
      charts.current.set(key, { target, title, ratio });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const unregister = useCallback(
    (key: string) => {
      charts.current.delete(key);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const pin = useCallback(
    (key: string) => {
      pinned.current = key;
      suppressed.current = false;
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const clearFocus = useCallback(() => {
    pinned.current = null;
    suppressed.current = true;
    flush();
  }, [flush]);

  // A new page: forget the pinned chart.
  useEffect(() => {
    pinned.current = null;
    suppressed.current = false;
    scheduleFlush();
  }, [pathname, scheduleFlush]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The view sent with each request, built from the live refs at send time.
  const buildView = useCallback(
    (forcedFocus?: ExplainTarget): AssistantView => {
      const now = computeScreen();
      return {
        focus: forcedFocus ?? now.focus?.target,
        visible: now.visible.slice(0, MAX_VISIBLE_SENT).map((c) => c.target),
      };
    },
    [computeScreen],
  );

  // Sends the chat to the server and adds the answer.
  const request = useCallback(
    async (history: ChatMessage[], extra: { explain?: ExplainTarget; view: AssistantView }) => {
      setLoading(true);
      setError(null);
      // The API takes the last 12 messages and must start with a question.
      let sent = history.slice(-MAX_SENT_MESSAGES).map(({ role, content }) => ({ role, content }));
      while (sent.length > 0 && sent[0].role !== "user") sent = sent.slice(1);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            days: parseDays(new URLSearchParams(window.location.search).get("days")),
            messages: sent,
            page: window.location.pathname.slice(0, 100),
            ...extra,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        const { answer, charts: answerCharts } = body as AssistantResponse;
        setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", content: answer, charts: answerCharts }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || loading) return;
      const view = buildView();
      const about = computeScreen().focus?.title;
      const history = [...messages, { id: nextId.current++, role: "user" as const, content: question, about }];
      setMessages(history);
      suppressed.current = false; // "x" only applied to this one question
      await request(history, { view });
      scheduleFlush();
    },
    [loading, messages, buildView, computeScreen, request, scheduleFlush],
  );

  const explain = useCallback(
    async (target: ExplainTarget, title: string) => {
      if (loading) return;
      pin(targetKey(target));
      setOpen(true);
      const history = [...messages, { id: nextId.current++, role: "user" as const, content: `Explain "${title}"`, about: title }];
      setMessages(history);
      await request(history, { explain: target, view: buildView(target) });
    },
    [loading, messages, pin, buildView, request],
  );

  const newChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const value = useMemo<AssistantContextValue>(
    () => ({
      open,
      setOpen,
      messages,
      loading,
      error,
      send,
      explain,
      newChat,
      visible: screen.visible,
      focus: screen.focus,
      clearFocus,
      reportVisibility,
      unregister,
      pin,
    }),
    [open, messages, loading, error, send, explain, newChat, screen, clearFocus, reportVisibility, unregister, pin],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
