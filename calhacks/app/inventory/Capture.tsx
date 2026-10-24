"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Ref = { id: number; name: string; unit: string };
type Row = { key: number; ingredient_id: number; qty: string; confidence: number; seen: string; note: string; reason?: string };
type Proposal = { ingredient_id: number; name: string; qty: number; confidence: number; seen: string; note: string; reason?: string };

const REASONS = ["spoiled", "expired", "dropped", "overcooked", "returned", "other"];
const primary = "rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const secondary = "rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

// The browser's own speech recognition (Chrome, Edge, Safari). Not in every browser, so the mic button
// only shows when it exists; typing (or the phone keyboard's dictation) always works.
type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };
function getRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return R ? new R() : null;
}

let nextKey = 1;
function toRows(items: Proposal[]): Row[] {
  return items.map((p) => ({ key: nextKey++, ingredient_id: p.ingredient_id, qty: String(p.qty), confidence: p.confidence, seen: p.seen || p.name, note: p.note, reason: p.reason }));
}

export default function Capture({ ingredients }: { ingredients: Ref[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState<Recognition | null>(null);
  const [counts, setCounts] = useState<Row[]>([]);
  const [waste, setWaste] = useState<Row[]>([]);
  const [source, setSource] = useState<"photo" | "voice" | "manual">("manual");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  async function call(path: string, init: RequestInit) {
    setError("");
    setDone("");
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  }

  async function readPhoto(file: File) {
    setBusy("Reading the photo...");
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await call("/api/inventory/photo", { method: "POST", body: form });
      setCounts(toRows(data.items));
      setWaste([]);
      setNotes(data.notes ?? "");
      setSource("photo");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function readNote() {
    setBusy("Reading the note...");
    try {
      const data = await call("/api/inventory/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      setCounts(toRows(data.counts));
      setWaste(toRows(data.waste));
      setNotes("");
      setSource("voice");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function toggleMic() {
    if (listening) return listening.stop();
    const r = getRecognition();
    if (!r) return setError("This browser can't listen. Type the note, or use your keyboard's dictation.");
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => setText((t) => `${t} ${Array.from(e.results).map((x) => x[0].transcript).join(" ")}`.trim());
    r.onend = () => setListening(null);
    setListening(r);
    r.start();
  }

  async function save(kind: "counts" | "waste") {
    const rows = kind === "counts" ? counts : waste;
    const items = rows.filter((r) => r.ingredient_id && r.qty !== "").map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty), reason: r.reason }));
    setBusy("Saving...");
    try {
      const data = await call(`/api/inventory/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, source }) });
      if (kind === "counts") setCounts([]);
      else setWaste([]);
      setDone(`${data.saved} ${kind === "counts" ? "counts saved" : "waste entries logged"}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function table(rows: Row[], setRows: (r: Row[]) => void, kind: "counts" | "waste") {
    const update = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-600">
            <tr>
              <th className="py-1 pr-3 font-medium">Seen or heard</th>
              <th className="py-1 pr-3 font-medium">Ingredient</th>
              <th className="py-1 pr-3 font-medium">{kind === "counts" ? "On hand" : "Thrown out"}</th>
              {kind === "waste" && <th className="py-1 pr-3 font-medium">Why</th>}
              <th className="py-1 pr-3 font-medium">Sure?</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100 align-top">
                <td className="py-2 pr-3 text-gray-600">
                  {r.seen}
                  {r.note && <span className="block text-xs text-gray-400">{r.note}</span>}
                </td>
                <td className="py-2 pr-3">
                  <select value={r.ingredient_id} onChange={(e) => update(r.key, { ingredient_id: Number(e.target.value) })} aria-label="Ingredient"
                    className={`rounded-md border px-2 py-1 ${r.ingredient_id ? "border-gray-300" : "border-red-300"}`}>
                    <option value={0}>Not on the list</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <input value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} inputMode="decimal" aria-label="Quantity"
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 tabular-nums" /> <span className="text-gray-500">{byId.get(r.ingredient_id)?.unit}</span>
                </td>
                {kind === "waste" && (
                  <td className="py-2 pr-3">
                    <select value={r.reason} onChange={(e) => update(r.key, { reason: e.target.value })} aria-label="Reason" className="rounded-md border border-gray-300 px-2 py-1">
                      {REASONS.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </td>
                )}
                <td className={`py-2 pr-3 ${r.confidence >= 0.85 ? "text-green-700" : r.confidence >= 0.5 ? "text-amber-700" : "text-red-700"}`}>
                  {r.confidence >= 0.85 ? "Yes" : r.confidence >= 0.5 ? "Estimate: check it" : "Not sure: check it"}
                </td>
                <td className="py-2">
                  <button onClick={() => setRows(rows.filter((x) => x.key !== r.key))} className="text-xs text-gray-500 underline">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setRows([...rows, { key: nextKey++, ingredient_id: 0, qty: "", confidence: 1, seen: "added by hand", note: "", reason: kind === "waste" ? "spoiled" : undefined }])} className={secondary}>
            Add a line
          </button>
          <button disabled={!!busy || !rows.some((r) => r.ingredient_id && r.qty !== "")} onClick={() => save(kind)} className={primary}>
            {kind === "counts" ? "Save counts" : "Log waste"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="mb-8 rounded-2xl border border-brand-100 bg-white p-4">
      <h2 className="text-lg font-semibold">Count stock or log waste</h2>
      <p className="mb-3 text-sm text-gray-600">
        Take a photo of a shelf, or say what you see (&quot;40 pounds of bones, two cases of limes, tossed 3 pounds of sprouts&quot;). The AI proposes
        the numbers; nothing is saved until you check them.
      </p>
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && readPhoto(e.target.files[0])} />
        <button disabled={!!busy} onClick={() => fileRef.current?.click()} className={primary}>Photo of a shelf</button>
        <button disabled={!!busy} onClick={() => { setWaste([]); setSource("manual"); setCounts([{ key: nextKey++, ingredient_id: 0, qty: "", confidence: 1, seen: "added by hand", note: "" }]); }} className={secondary}>
          Count by hand
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say or type a count or waste note" maxLength={2000}
          aria-label="Count or waste note" className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button disabled={!!busy && !listening} onClick={toggleMic} className={secondary}>{listening ? "Stop" : "Speak"}</button>
        <button disabled={!!busy || !text.trim()} onClick={readNote} className={primary}>Read note</button>
      </div>
      {busy && <p className="mt-3 text-sm text-gray-500">{busy}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {done && <p className="mt-3 text-sm text-green-700">{done}</p>}
      {notes && <p className="mt-3 text-sm text-gray-600">AI note on the photo: {notes}</p>}
      {counts.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Counts to check</h3>
          {table(counts, setCounts, "counts")}
        </div>
      )}
      {waste.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Waste to check</h3>
          {table(waste, setWaste, "waste")}
        </div>
      )}
    </section>
  );
}
