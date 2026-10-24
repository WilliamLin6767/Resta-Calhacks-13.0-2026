import type { Metadata } from "next";
import { CheckForCalls } from "@/components/calls/CallControls";
import CallRequests from "@/components/calls/CallRequests";
import SubPageHeader from "@/components/SubPageHeader";

export const metadata: Metadata = { title: "Supplier calls · Suppliers" };

// Every call request, for any record; the Suppliers tab shows the top three.
export default function SupplierCallsPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Suppliers", href: "/suppliers" }}
        title="Supplier calls"
        description="Every call the app or you asked for. Nothing is dialed until you press Approve and call."
      />
      <CallRequests title="Supplier calls" action={<CheckForCalls />} view="full" />
    </div>
  );
}
