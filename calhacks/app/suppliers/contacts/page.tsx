import type { Metadata } from "next";
import { Suspense } from "react";
import LiveRefresh from "@/components/live/LiveRefresh";
import SubPageHeader from "@/components/SubPageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import SuppliersTable from "../SuppliersTable";

export const metadata: Metadata = { title: "Contacts on file · Suppliers" };

// Every supplier on file; the Suppliers tab shows three.
export default function SupplierContactsPage() {
  return (
    <div>
      <SubPageHeader
        parent={{ label: "Suppliers", href: "/suppliers" }}
        title="Contacts on file"
        description="Who you buy from, how to reach them, and when they deliver."
      />
      <Suspense fallback={<SkeletonTable rows={6} cols={7} />}>
        <SuppliersTable />
      </Suspense>
      <LiveRefresh topics={["suppliers"]} />
    </div>
  );
}
