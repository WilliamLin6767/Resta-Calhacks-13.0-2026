"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Upload a photo or PDF of a supplier invoice (or try the demo one). The server reads it
// with AI, matches and checks every line, then we open the invoice to show what it found.
export default function ScanInvoice() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function scan(file: Blob, name: string) {
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file, name);
      const res = await fetch("/api/invoices/scan", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      router.push(`/invoices/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function trySample() {
    const res = await fetch("/samples/bay-area-meat-invoice.png");
    await scan(await res.blob(), "bay-area-meat-invoice.png");
  }

  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Scan a supplier invoice</h2>
      <p className="mb-4 text-sm text-gray-600">
        Take a photo or upload a PDF. The AI reads every line, then we match it to your ingredients, check the math
        and prices, and update your food costs.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`cursor-pointer rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 ${loading ? "pointer-events-none opacity-50" : ""}`}>
          {loading ? "Reading the invoice... (about 20 seconds)" : "Upload or take a photo"}
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
