import type { Metadata } from "next";
import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import SubPageHeader from "@/components/SubPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { loadPricing } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { ChangeRow, copyFirst } from "../parts";

export const metadata: Metadata = { title: "Copy price changes · Menu and pricing" };

async function Changes() {
  let data;
  try {
    data = await loadPricing(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  if (data.changes.length === 0) return <EmptyState title="No price changes yet." hint="Approve a suggested price on Menu and pricing." icon="tag" />;
  return (
    <div className="grid gap-2">
      {copyFirst(data.changes).map((c) => <ChangeRow key={c.id} c={c} />)}
    </div>
  );
}

// Every approved price change and where it still has to be copied; the Menu tab shows three.
export default function PriceChangesPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Menu and pricing", href: "/menu" }}
        title="Copy price changes to your other systems"
        description="This app can't change the POS or delivery apps by itself yet. Tick each one once it's done. Ones still to copy come first."
      />
      <Suspense fallback={<Skeleton className="h-60 rounded-2xl" />}>
        <Changes />
      </Suspense>
    </div>
  );
}
