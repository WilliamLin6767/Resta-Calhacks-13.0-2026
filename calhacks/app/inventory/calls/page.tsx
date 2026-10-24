import type { Metadata } from "next";
import CallRequests from "@/components/calls/CallRequests";
import SubPageHeader from "@/components/SubPageHeader";

export const metadata: Metadata = { title: "Supplier calls about stock · Inventory" };

// Every call about an ingredient (orders, price questions); the Inventory tab shows the top three.
export default function InventoryCallsPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Inventory", href: "/inventory" }}
        title="Supplier calls about stock"
        description="Calls about ingredients: orders and price questions. Nothing is dialed until you press Approve and call."
      />
      <CallRequests contextType="ingredient" title="Calls" view="full" />
    </div>
  );
}
