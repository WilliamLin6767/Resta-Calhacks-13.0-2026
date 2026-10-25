import type { Metadata } from "next";
import { Suspense } from "react";
import LiveRefresh from "@/components/live/LiveRefresh";
import SubPageHeader from "@/components/SubPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { FullInbox } from "../EmailInbox";

export const metadata: Metadata = { title: "Email inbox · Invoices and buying" };

// Every email the restaurant received, with what the app did; the Invoices tab shows the top three.
export default function InboxPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Invoices and buying", href: "/invoices" }}
        title="Email inbox"
        description="Supplier invoices and customer orders that came in by email. The ones waiting for you come first."
      />
      <Suspense fallback={<Skeleton className="h-60 rounded-2xl" />}>
        <FullInbox />
      </Suspense>
      <LiveRefresh topics={["invoices"]} />
    </div>
  );
}
