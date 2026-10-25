"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import Badge, { type BadgeTone } from "@/components/Badge";
import { LIVE_RESTAURANT_ID, useLiveOn, useLiveQuery } from "@/components/live/useLiveQuery";
import type { ActionRow, ActionStatus } from "@/lib/agent/actions";

// One Commit action waiting for the owner, or what became of it. Approve and Reject are the
// only way it runs: the server checks the owner's session, re-checks the limits, and runs it
// exactly once. A spoken yes never approves anything.
//
// `action` can be the full row (the Actions page) or just { id, title, summary } from a chat
// reply; the card loads the rest. With Convex on, it follows status changes made elsewhere.

type Partial = { id: number; title: string; summary: string } & Record<string, unknown>;

const STATUS: Record<ActionStatus, { label: string; tone: BadgeTone }> = {
  proposed: { label: "Waiting for you", tone: "amber" },
  approved: { label: "Approved", tone: "gray" },
  running: { label: "Running", tone: "gray" },
  done: { label: "Done", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  rejected: { label: "Turned down", tone: "gray" },
  undone: { label: "Undone", tone: "gray" },
  expired: { label: "Expired", tone: "gray" },
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function isFull(a: ActionRow | Partial): a is ActionRow {
  return typeof (a as ActionRow).status === "string" && "args" in a;
}

export default function ActionCard({ action: initial }: { action: ActionRow | Partial }) {
  const [action, setAction] = useState<ActionRow | Partial>(initial);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const id = action.id;

  const live = useLiveOn();
  const statuses = useLiveQuery(api.live.actionStatuses, live ? { restaurantId: LIVE_RESTAURANT_ID, actionIds: [id] } : "skip");
  const liveStatus = statuses?.[String(id)];
  const full = isFull(action) ? action : null;

  // Load the full row once, and again when the live status says it changed.
  useEffect(() => {
    if (full && (!liveStatus || liveStatus === full.status)) return;
    let stop = false;
    fetch(`/api/actions/${id}`)
      .then((res) => res.json())
      .then((body) => {
        if (!stop && body.action) setAction(body.action);
        if (!stop && body.error) setError(body.error);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [id, liveStatus, full]);

  async function decide(kind: "approve" | "reject") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/actions/${id}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not ${kind} it.`);
      setAction(body.action);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${kind} it.`);
    } finally {
      setBusy(null);
    }
  }

  const status = full?.status ?? "proposed";
  const shown = STATUS[status];
  const impact = full?.impact;
  const result = full?.result as { href?: string; message?: string; contact?: { label: string; href: string | null }; mailto?: string | null; externalLink?: string | null; checklist?: string[] } | null | undefined;

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-4 text-sm text-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-gray-900">{action.title}</p>
        <Badge tone={shown.tone}>{status === "running" || busy === "approve" ? "Running" : shown.label}</Badge>
      </div>
      <p className="mt-1 text-gray-600">{action.summary}</p>

      {impact && impact.amount_usd !== null && (
        <p className="mt-2">
          <span className="font-medium">{money(impact.amount_usd)}</span> {impact.per === "week" ? "a week" : "once"}
          <span className="block text-xs text-gray-500">
            {impact.basis}
            {impact.assumptions?.length ? ` Assumes: ${impact.assumptions.join(" ")}` : ""}
          </span>
        </p>
      )}

      {full && full.evidence?.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">Evidence</summary>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
            {full.evidence.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.label}:</span> {e.href ? <Link href={e.href} className="underline">{e.value}</Link> : e.value}
              </li>
            ))}
          </ul>
        </details>
      )}

      {status === "proposed" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => decide("approve")}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === "approve" ? "Approving..." : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => decide("reject")}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "reject" ? "Turning down..." : "Reject"}
          </button>
        </div>
      )}

      {status === "failed" && full?.error && <p className="mt-2 text-sm text-red-600">{full.error}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {status === "done" && (result?.checklist?.length ?? 0) > 0 && (
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Still to do by hand:</p>
          <ul className="list-disc pl-5">
            {result!.checklist!.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {status === "done" && result && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {result.message && (
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(result.message!);
                setCopied(true);
              }}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {copied ? "Copied" : "Copy the order message"}
            </button>
          )}
          {result.contact?.href && (
            <a href={result.contact.href} className="text-xs font-medium underline">
              Open {result.contact.label}
            </a>
          )}
          {result.mailto && (
            <a href={result.mailto} className="text-xs font-medium underline">
              Open the email
            </a>
          )}
          {result.externalLink && (
            <a href={result.externalLink} target="_blank" rel="noreferrer" className="text-xs font-medium underline">
              See the post
            </a>
          )}
          {result.href && (
            <Link href={result.href} className="text-xs font-medium underline">
              Open the record
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
