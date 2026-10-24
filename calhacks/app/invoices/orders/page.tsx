import type { Metadata } from "next";
import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import SubPageHeader from "@/components/SubPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { loadOrders, sortOrders } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { PurchaseOrderCard } from "../OrderActions";

export const metadata: Metadata = { title: "Purchase orders · Invoices and buying" };

async function Orders() {
  let orders;
  try {
    orders = await loadOrders(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  if (!orders.length) return <EmptyState title="No open purchase orders." hint="Plan orders from Inventory or Prep when something runs low." icon="receipt" />;
  return (
    <div className="grid gap-3">
      {sortOrders(orders).map((order) => <PurchaseOrderCard key={order.id} order={order} />)}
    </div>
  );
}

// Every open order (waiting for approval, approved, on the way); the Invoices tab shows the top three.
export default function OrdersPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Invoices and buying", href: "/invoices" }}
        title="Purchase orders"
        description="Orders waiting for your OK come first, then ones approved but not sent, then ones on the way."
      />
      <Suspense fallback={<Skeleton className="h-60 rounded-2xl" />}>
        <Orders />
      </Suspense>
    </div>
  );
}
