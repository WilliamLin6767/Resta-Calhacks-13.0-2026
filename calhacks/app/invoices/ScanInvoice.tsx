"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import AiThinking from "@/components/ui/AiThinking";
import { ALREADY_SCANNED, JUST_SCANNED } from "./[id]/ScannedLines";

// Upload a photo or PDF of a supplier invoice (or try the demo one). The server reads it
// with AI, matches and checks every line, then we open the invoice to show what it found.
export default function ScanInvoice() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(""); // the photo being read, shown while the AI works

  async function scan(file: Blob, name: string) {
    setLoading(true);
    setError("");
    const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    setPreview(url);
    try {
      const form = new FormData();
      form.append("file", file, name);
      const res = await fetch("/api/invoices/scan", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      // The invoice page plays its lines in when it opens straight after a scan. If this invoice was
      // already in the system (often emailed first), nothing was added twice and the original opens
      // with a note saying so.
      try {
        sessionStorage.setItem(JUST_SCANNED, String(body.id));
        if (body.duplicate) sessionStorage.setItem(ALREADY_SCANNED, String(body.id));
      } catch {
        // storage blocked: the lines just appear
      }
      router.push(`/invoices/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
      setPreview("");
      if (url) URL.revokeObjectURL(url);
    }
  }

  async function trySample() {
    const res = await fetch("/samples/bay-area-meat-invoice.png");
    await scan(await res.blob(), "bay-area-meat-invoice.png");
  }

  return (
    <div className="mb-8 rounded-2xl border border-brand-100 bg-white p-5">
      <h2 className="font-semibold">Scan a supplier invoice</h2>
      <p className="mb-4 text-sm text-gray-600">
        Take a photo or upload a PDF. The AI reads every line, then we match it to your ingredients, check the math
        and prices, add the delivery to stock, and update your food costs.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`cursor-pointer rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 ${loading ? "pointer-events-none opacity-50" : ""}`}>
          Upload or take a photo
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) scan(file, file.name);
              e.target.value = "";
            }}
          />
        </label>
        <button
          onClick={trySample}
          disabled={loading}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50"
        >
          Try the sample invoice
        </button>
        <a href="/samples/bay-area-meat-invoice.png" target="_blank" className="text-sm text-gray-500 underline">
          See the sample
        </a>
      </div>
      {loading && (
        <div className="mt-4 flex items-start gap-4">
          {/* The photo, with a slow line passing down it while it's read (still with reduced motion) */}
          {preview && (
            <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL) */}
              <img src={preview} alt="The invoice being read" className="h-full w-full object-cover object-top" />
              <span className="scan-line absolute inset-x-0 top-0 h-0.5 bg-brand-500/70 shadow-[0_0_8px_var(--color-brand-500)]" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <AiThinking label="Reading the invoice... (about 20 seconds)" />
            {/* A thin bar that keeps moving, so a 20-second wait doesn't look stuck */}
            <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
              <div className="nav-progress h-full w-1/3 rounded-full bg-brand-500" />
            </div>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
