"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge, { type BadgeTone } from "@/components/Badge";
import { ActionButton } from "@/components/attention/AttentionList";
import { isApprovalAction, itemSection } from "@/lib/approvals/sections";
import type { Confidence, Item } from "@/lib/attention/types";

const CONFIDENCE: Record<Confidence, { label: string; tone: BadgeTone }> = {
  high: { label: "High confidence", tone: "green" },
  medium: { label: "Medium confidence", tone: "amber" },
  low: { label: "Low confidence", tone: "gray" },
  demo: { label: "Demo data", tone: "gray" },
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// The top findings for the Overview's Today card: what each is worth a week (the basis on
// hover), how sure the app is, and two ways to act: ask Resta about it, or its main button.
export default function TodayList({ items }: { items: Item[] }) {
  const router = useRouter();
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((item) => {
        const c = CONFIDENCE[item.confidence ?? "low"];
        const main = item.actions[0];
        return (
          <li key={item.key} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-gray-900">{item.title}</p>
              {item.impact_usd_week !== null && item.impact_usd_week !== undefined && (
                <p className="text-sm font-semibold whitespace-nowrap text-gray-900" title={item.basis}>
                  {money(item.impact_usd_week)}
                  <span className="font-normal text-gray-500">{item.impact_once ? " once" : " a week"}</span>
                </p>
              )}
            </div>
            {item.basis && <p className="mt-0.5 text-xs text-gray-500">{item.basis}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Badge tone={c.tone}>{c.label}</Badge>
              <Link href={`/chat?ask=${encodeURIComponent(`Tell me about: ${item.key}`)}`} className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
                Ask Resta
              </Link>
              {main && isApprovalAction(main) ? (
                <Link href={`/actions#${itemSection(item)}`} className="text-sm font-medium text-gray-700 underline-offset-2 hover:underline">Decide in Actions</Link>
              ) : (
                main && <ActionButton action={main} main={false} onDone={() => router.refresh()} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
