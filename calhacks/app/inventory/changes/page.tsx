import type { Metadata } from "next";
import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import LiveRefresh from "@/components/live/LiveRefresh";
import SubPageHeader from "@/components/SubPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { loadInventory } from "@/lib/inventory/service";
import { getSupabase } from "@/lib/supabase";
import StockEvents from "../StockEvents";

export const metadata: Metadata = { title: "Recent changes · Inventory" };

async function Changes() {
  let data;
  try {
    data = await loadInventory(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  if (data.events.length === 0) {
    return <EmptyState title="No deliveries, counts or waste logged yet." hint="Scan an invoice, count a shelf or log waste on Inventory." icon="box" />;
  }
  return <StockEvents events={data.events} unitCost={data.unitCost} />;
}

// Every recent delivery, count and waste entry; the Inventory tab shows the latest three.
export default function InventoryChangesPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Inventory", href: "/inventory" }}
        title="Recent changes"
        description="Deliveries from scanned invoices, shelf counts and waste, newest first."
      />
      <Suspense fallback={<SkeletonLines lines={8} className="rounded-2xl border border-brand-100 bg-white p-4" />}>
        <Changes />
      </Suspense>
      <LiveRefresh topics={["inventory"]} />
    </div>
  );
}
