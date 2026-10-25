"use client";

import Link from "next/link";
import { LIVE_RESTAURANT_ID, useLiveOn, useLiveQuery } from "@/components/live/useLiveQuery";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { sectionOfTool } from "@/lib/approvals/sections";
import { useToast } from "@/components/ui/Toaster";
import TypingDots from "@/components/ui/TypingDots";
import MicButton from "@/components/voice/MicButton";
import { chatText } from "@/components/ChatText";

// When this browser last showed the loop's messages (localStorage)
const LOOP_SEEN = "resta-loop-seen";

type Order = {
  orderId: number;
  supplier: string;
  total: number;
  lines: { name: string; packs: number; pack: string | null; price: number }[];
};

// What the agent changed (lib/agent/types.ts), and pages it linked to.
type Change = { kind: string; label: string; before: string | number | null; after: string | number | null; undo?: Record<string, unknown> };
type PageLink = { href: string; label: string; reason: string };
type Proposal = { action_id: number; tool: string; title: string; summary: string };

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  order?: Order | null;
  changes?: Change[];
  links?: PageLink[];
  proposals?: Proposal[]; // actions waiting for the owner tap (cards)
  undone?: number[]; // indexes of changes undone here
};

// The app's secondary link style
const secondary = "text-sm text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50";

// The changes made so far, sent back so the agent can undo one ("undo that").
function changesOf(messages: Message[]) {
  return messages.flatMap((message) => message.changes ?? []).slice(-30);
}

function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function historyOf(messages: Message[]) {
  return messages.slice(-12).map((message) => ({ role: message.role, content: message.content }));
}

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function playable(audio: string, audioType: string) {
  const bytes = Uint8Array.from(atob(audio), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: audioType || "audio/mpeg" }));
}

// A thread for the visit. Typed replies stay on screen. Spoken replies are also played.
export default function ChatPage() {
  const router = useRouter();
  const toast = useToast();
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const urls = useRef<string[]>([]);
  const player = useRef<HTMLAudioElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [spoken, setSpoken] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    const created = urls.current;
    return () => {
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function armPlayback() {
    const el = player.current;
    if (!el) return;
    el.loop = true;
    el.src = SILENT_WAV;
    const pending = el.play();
    if (pending) pending.catch(() => null);
  }

  function add(message: Omit<Message, "id">) {
    setMessages((current) => [...current, { ...message, id: nextId.current++ }]);
  }

  async function sendText(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await ask(text);
  }

  async function ask(text: string) {
    setError("");
    const sent = [...historyOf(messages).slice(-11), { role: "user" as const, content: text }];
    add({ role: "user", content: text });
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: sent, changes: changesOf(messages) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      add({ role: "assistant", content: data.answer, order: data.order, changes: data.changes, links: data.links, proposals: data.proposals });
      if (data.changes?.length) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // "Ask Resta" on the Overview opens /chat?ask=...: send that question once, then tidy the URL.
  const askedFromLink = useRef(false);
  useEffect(() => {
    if (askedFromLink.current) return;
    askedFromLink.current = true;
    const question = new URLSearchParams(window.location.search).get("ask")?.trim().slice(0, 500);
    if (!question) return;
    window.history.replaceState(null, "", "/chat");
    void Promise.resolve().then(() => ask(question));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // What the loop found on its own: when a case reaches "proposed" or "closed", Resta posts one
  // message here ("I noticed ...; I propose ..." with the cards, or "Results for ..."). Checked on
  // load, and again whenever the actions topic changes (Convex); remembered per browser.
  const live = useLiveOn();
  const versions = useLiveQuery(api.live.topicVersions, live ? { restaurantId: LIVE_RESTAURANT_ID, topics: ["actions"] } : "skip");
  const actionsVersion = versions?.actions ?? 0;
  useEffect(() => {
    let stop = false;
    let since = new Date(Date.now() - 24 * 3600_000).toISOString();
    try {
      since = localStorage.getItem(LOOP_SEEN) ?? since;
    } catch {}
    fetch(`/api/loop/updates?since=${encodeURIComponent(since)}`)
      .then((res) => res.json())
      .then((body: { updates?: { case_id: number; text: string; is_demo: boolean; action_ids: number[] }[]; now?: string }) => {
        if (stop || !body.updates) return;
        for (const u of body.updates) {
          add({
            role: "assistant",
            content: `${u.text}${u.is_demo ? " (Demo data)" : ""}`,
            proposals: u.action_ids.map((id) => ({ action_id: id, tool: "", title: "Loading...", summary: "" })),
          });
        }
        try {
          if (body.now) localStorage.setItem(LOOP_SEEN, body.now);
        } catch {}
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [actionsVersion]);

  async function sendClip(blob: Blob) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", blob, blob.type.includes("mp4") ? "clip.m4a" : "clip.webm");
      form.append("history", JSON.stringify(historyOf(messages).slice(-11)));
      form.append("changes", JSON.stringify(changesOf(messages)));
      const res = await fetch("/api/voice", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      if (data.audio) {
        const audioUrl = playable(data.audio, data.audioType);
        urls.current.push(audioUrl);
        const el = player.current;
        if (el) {
          el.loop = false;
          el.src = audioUrl;
          const pending = el.play();
          if (pending) await pending.catch(() => null);
        }
        setSpoken(true);
      }
      add({ role: "user", content: data.transcript });
      add({ role: "assistant", content: data.answer, order: data.order, changes: data.changes, links: data.links, proposals: data.proposals });
      if (data.changes?.length) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // The Undo button under a change: the same code as the agent's undo_change.
  async function undo(messageId: number, index: number, change: Change) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not undo that.");
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? { ...message, undone: [...(message.undone ?? []), index] } : message)),
      );
      router.refresh();
      toast({ message: data.change?.label ?? "Undone", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // On desktop the thread fills the page panel and the composer docks at its bottom.
    <div className="md:flex md:min-h-[calc(100dvh-7rem)] md:flex-col">
      <PageHeader title="Chat" description="Tell me what's low, or hold to talk." />

      <div ref={listRef} className="space-y-3 pb-36 md:flex-1 md:pb-6">
        {messages.length === 0 && !busy && <EmptyState title="Ask about a food, or hold the button and say it." icon="chat" />}
        {messages.map((message) => (
          // Each bubble rises in when it's added; the ones already on screen stay put
          <div key={message.id} className={`reveal-in ${message.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${message.role === "user" ? "bg-brand-600 text-white" : "border border-brand-100 bg-white text-gray-900"}`}>
              <p className="whitespace-pre-wrap">{message.role === "user" ? message.content : chatText(message.content)}</p>
              {/* What the agent changed, one line each, with Undo where it can be undone */}
              {(message.changes?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1 border-t border-gray-200 pt-2">
                  {message.changes!.map((change, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-sm text-gray-700">
                      <span>{change.label}</span>
                      {change.undo &&
                        (message.undone?.includes(i) ? (
                          <span className="text-sm text-gray-500">Undone</span>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => undo(message.id, i, change)} className={secondary}>
                            Undo
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
              )}
              {(message.links?.length ?? 0) > 0 && (
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {message.links!.map((link) => (
                    <Link key={link.href} href={link.href} title={link.reason} className={secondary}>
                      {link.label} →
                    </Link>
                  ))}
                </p>
              )}
              {/* Actions the agent proposed: they wait on the Actions page, the one place approvals are decided */}
              {(message.proposals?.length ?? 0) > 0 && (
                <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
                  {message.proposals!.map((p) => (
                    <p key={p.action_id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-gray-900">{p.title}</span>
                      <Link href={`/actions#${sectionOfTool(p.tool)}`} className="text-sm font-medium text-brand-700 hover:underline">Waiting for you in Actions</Link>
                    </p>
                  ))}
                </div>
              )}
              {message.order && (
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <p className="font-medium">{message.order.supplier}</p>
                  <ul className="mt-1 text-gray-700">
                    {message.order.lines.map((line) => (
                      <li key={line.name}>{line.packs} x {line.name}{line.pack ? ` (${line.pack})` : ""} · {money(line.price)}</li>
                    ))}
                  </ul>
                  <p className="mt-1">About {money(message.order.total)}. Waiting for your approval.</p>
                  <Link
                    href="/actions#purchasing"
                    className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    Approve in Actions
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="reveal-in flex justify-start">
            <div className="rounded-2xl border border-brand-100 bg-white px-4 py-3">
              <TypingDots />
            </div>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:sticky md:bottom-6 md:pb-0 md:rounded-2xl md:border md:border-brand-100 md:shadow-lg">
        {error && <p className="px-4 pt-2 text-sm text-red-600">{error}</p>}
        <audio
          ref={player}
          autoPlay
          playsInline
          controls={spoken}
          className={spoken ? "mx-3 mt-2 w-[calc(100%-1.5rem)]" : "absolute h-px w-px opacity-0"}
        />
        <form onSubmit={sendText} className="flex items-center gap-2 px-3 py-2" suppressHydrationWarning>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Tell me what's low"
            enterKeyHint="send"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-gray-300 px-4 text-base"
            suppressHydrationWarning
          />
          <MicButton disabled={busy} onArm={armPlayback} onClip={(blob) => void sendClip(blob)} onError={setError} />
          <button type="submit" disabled={busy || !draft.trim()} className="flex h-11 shrink-0 items-center justify-center rounded-full bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
