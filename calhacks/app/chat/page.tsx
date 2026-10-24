"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import MicButton from "@/components/voice/MicButton";

type Order = {
  orderId: number;
  supplier: string;
  total: number;
  lines: { name: string; packs: number; pack: string | null; price: number }[];
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  order?: Order | null;
  approved?: boolean;
};

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
    setError("");
    const sent = [...historyOf(messages).slice(-11), { role: "user" as const, content: text }];
    add({ role: "user", content: text });
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: sent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      add({ role: "assistant", content: data.answer, order: data.order });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function sendClip(blob: Blob) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", blob, blob.type.includes("mp4") ? "clip.m4a" : "clip.webm");
      form.append("history", JSON.stringify(historyOf(messages).slice(-11)));
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
      add({ role: "assistant", content: data.answer, order: data.order });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(messageId: number, orderId: number) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/purchase-orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not approve the order.");
      setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, approved: true } : message)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // On desktop the thread fills the page panel and the composer docks at its bottom.
    <div className="md:flex md:min-h-[calc(100dvh-7rem)] md:flex-col">
      <PageHeader title="Chat" description="Tell me what's low, or hold to talk." />

      <div ref={listRef} className="space-y-3 pb-36 md:flex-1 md:pb-6">
        {messages.length === 0 && !busy && (
          <p className="text-sm text-gray-500">Ask about a food, or hold the button and say it.</p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${message.role === "user" ? "bg-brand-600 text-white" : "border border-brand-100 bg-white text-gray-900"}`}>
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.order && (
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <p className="font-medium">{message.order.supplier}</p>
                  <ul className="mt-1 text-gray-700">
                    {message.order.lines.map((line) => (
                      <li key={line.name}>{line.packs} x {line.name}{line.pack ? ` (${line.pack})` : ""} · {money(line.price)}</li>
                    ))}
                  </ul>
                  <p className="mt-1">About {money(message.order.total)}. Waiting for your approval.</p>
                  {message.approved ? (
                    <p className="mt-2 font-medium">Approved. Open Invoices to text the order.</p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => approve(message.id, message.order!.orderId)}
                      className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-gray-500">Working...</p>}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-gray-200 bg-white md:sticky md:bottom-6 md:rounded-2xl md:border md:border-brand-100 md:shadow-lg">
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
