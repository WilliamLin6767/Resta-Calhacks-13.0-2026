import type { Metadata } from "next";
import { Suspense } from "react";
import LiveRefresh from "@/components/live/LiveRefresh";
import SubPageHeader from "@/components/SubPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { FullInbox } from "../invoices/EmailInbox";

export const metadata: Metadata = { title: "Email inbox" };

// Every email the restaurant received, of every kind, with what the app did. Invoices and buying shows
// the supplier ones, Prep the catering requests; this is the one full list.
export default function InboxPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Overview", href: "/" }}
        title="Email inbox"
        description="Supplier invoices and catering requests that came in by email. The ones waiting for you come first."
      />
      <Suspense fallback={<Skeleton className="h-60 rounded-2xl" />}>
        <FullInbox />
      </Suspense>
      <LiveRefresh topics={["invoices", "prep"]} />
    </div>
  );
}
