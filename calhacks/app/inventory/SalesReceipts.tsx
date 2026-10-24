"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import AiThinking from "@/components/ui/AiThinking";
import Reveal from "@/components/ui/Reveal";
import { table, tableWrap, td, th, thead, tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/Toaster";

type Menu = { id: number; name: string; price: number };
type Line = { key: number; printed: string; menu_item_id: number; qty: string; unit_price: string; confidence: number };
type Receipt = { receipt_number: string; date: string; time: string; channel: "dine_in" | "takeout"; tax: number; tip: number; total: number };
type Impact = {
  ingredient_id: number; name: string; unit: string; before: number; after: number; used: number;
  status_before: string; status_after: string; days_left: number | null;
};

const primary = "rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const secondary = "rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";
const STATUS: Record<string, string> = { out: "bg-red-50 text-red-700", low: "bg-amber-50 text-amber-800", ok: "text-gray-500" };

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// Scan a customer receipt, check what was read, add it to sales, and see what it used from stock
export default function SalesReceipts() {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Menu[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ impact: Impact[]; alerts: Impact[] } | null>(null);

  async function scan(file: Blob, name = "receipt.png") {
    setBusy("Reading the receipt...");
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file, name);
      const res = await fetch("/api/sales/scan", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not read the receipt.");
      const r = data.receipt;
      setMenu(data.menu);
      setNotes(data.notes);
      setReceipt({
        receipt_number: r.receipt_number, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayLocal(), time: /^\d{2}:\d{2}$/.test(r.time) ? r.time : "12:00",
        channel: r.channel === "takeout" ? "takeout" : "dine_in", tax: r.tax, tip: r.tip, total: r.total,
      });
      setLines(r.lines.map((l: { printed: string; menu_item_id: number; qty: number; unit_price: number; confidence: number }, i: number) => ({
        key: i, printed: l.printed, menu_item_id: l.menu_item_id, qty: String(l.qty), unit_price: l.unit_price.toFixed(2), confidence: l.confidence,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast({ message: e instanceof Error ? e.message : String(e), tone: "error" });
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function trySample() {
    const res = await fetch("/samples/pho-berkeley-receipt.png");
    await scan(await res.blob(), "pho-berkeley-receipt.png");
  }

  async function save() {
    if (!receipt) return;
    setBusy("Adding to sales...");
    setError("");
    try {
      const res = await fetch("/api/sales/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...receipt, lines: lines.map((l) => ({ menu_item_id: l.menu_item_id, qty: Number(l.qty), unit_price: Number(l.unit_price) })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the receipt.");
      setResult(data);
      setReceipt(null);
      setLines([]);
      router.refresh();
      toast({ message: `Receipt added to sales${data.alerts?.length ? `; ${data.alerts.length} now running low` : ""}`, tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast({ message: e instanceof Error ? e.message : String(e), tone: "error" });
    } finally {
      setBusy("");
    }
  }

  const update = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const ready = lines.length > 0 && lines.every((l) => l.menu_item_id && Number.isInteger(Number(l.qty)) && Number(l.qty) > 0);

  return (
    <section className="mb-8 rounded-2xl border border-brand-100 bg-white p-4">
      <h2 className="text-lg font-semibold">Customer receipts</h2>
      <p className="mb-3 text-sm text-gray-600">
        Scan a receipt and its dishes come off stock right away, using each dish&apos;s recipe. The AI reads it; you check the dishes before it&apos;s added.
      </p>
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && scan(e.target.files[0], e.target.files[0].name)} />
        <button disabled={!!busy} onClick={() => fileRef.current?.click()} className={primary}>Scan a receipt</button>
        <button disabled={!!busy} onClick={trySample} className={secondary}>Try the sample receipt</button>
        <a href="/samples/pho-berkeley-receipt.png" target="_blank" className="self-center text-sm text-gray-600 underline">See the sample</a>
      </div>
      {busy && (busy.startsWith("Reading") ? <AiThinking label={busy} className="mt-3" /> : <p className="mt-3 text-sm text-gray-500">{busy}</p>)}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {receipt && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Receipt {receipt.receipt_number || "(no number)"}</span>
            <input type="date" value={receipt.date} onChange={(e) => setReceipt({ ...receipt, date: e.target.value })} aria-label="Date" className="rounded-md border border-gray-300 px-2 py-1" />
            <input type="time" value={receipt.time} onChange={(e) => setReceipt({ ...receipt, time: e.target.value })} aria-label="Time" className="rounded-md border border-gray-300 px-2 py-1" />
            <select value={receipt.channel} onChange={(e) => setReceipt({ ...receipt, channel: e.target.value as Receipt["channel"] })} aria-label="Dine in or takeout" className="rounded-md border border-gray-300 px-2 py-1">
              <option value="dine_in">Dine in</option>
              <option value="takeout">Takeout</option>
            </select>
          </div>
          <div className={`mt-3 ${tableWrap}`}>
            <table className={table}>
              <thead className={thead}>
                <tr>
                  <th className={th}>As printed</th>
                  <th className={th}>Dish</th>
                  <th className={th}>Qty</th>
                  <th className={th}>Price each</th>
                  <th className={th} />
                </tr>
              </thead>
              {/* The lines the AI read rise in one after another */}
              <Reveal as="tbody" initial>
                {lines.map((l) => (
                  <tr key={l.key} className={tr}>
                    <td className={`${td} font-mono text-xs text-gray-600`}>{l.printed}</td>
                    <td className={td}>
                      <select value={l.menu_item_id} onChange={(e) => update(l.key, { menu_item_id: Number(e.target.value) })} aria-label="Dish"
                        className={`rounded-md border px-2 py-1 ${l.menu_item_id ? "border-gray-300" : "border-red-300"}`}>
                        <option value={0}>Pick a dish</option>
                        {menu.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      {l.menu_item_id > 0 && l.confidence < 0.85 && <span className="ml-2 text-xs text-amber-700">check this</span>}
                    </td>
                    <td className={td}><input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} inputMode="numeric" aria-label="Quantity" className="w-14 rounded-md border border-gray-300 px-2 py-1 tabular-nums" /></td>
                    <td className={td}><input value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} inputMode="decimal" aria-label="Price each" className="w-20 rounded-md border border-gray-300 px-2 py-1 tabular-nums" /></td>
                    <td className={td}><button onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="text-xs text-gray-500 underline">Remove</button></td>
                  </tr>
                ))}
              </Reveal>
            </table>
          </div>
          <p className="mt-2 text-sm text-gray-600 tabular-nums">Tax ${receipt.tax.toFixed(2)} · Tip ${receipt.tip.toFixed(2)} · Total ${receipt.total.toFixed(2)}</p>
          {notes.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
          <div className="mt-3 flex gap-2">
            <button disabled={!!busy || !ready} onClick={save} className={primary}>Add to sales</button>
            <button disabled={!!busy} onClick={() => { setReceipt(null); setLines([]); }} className={secondary}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
          <p className="font-medium">Added to sales. Stock used:</p>
          {result.alerts.length > 0 && (
            <p className="mt-1 text-red-700">
              Now running low: {result.alerts.map((a) => `${a.name} (${fmt(a.after)} ${a.unit} left${a.days_left !== null ? `, about ${fmt(a.days_left)} days` : ""})`).join(", ")}
            </p>
          )}
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {result.impact.map((i) => (
              <li key={i.ingredient_id} className="flex justify-between gap-2 tabular-nums">
                <span>{i.name}</span>
                <span>
                  {fmt(i.before)} → {fmt(i.after)} {i.unit}
                  {i.status_after !== "ok" && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS[i.status_after]}`}>{i.status_after === "out" ? "Out" : "Low"}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
