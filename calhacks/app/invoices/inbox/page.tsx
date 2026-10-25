import { redirect } from "next/navigation";

// The inbox moved to /inbox (it holds catering requests too, not only invoices)
export default function OldInboxPage() {
  redirect("/inbox");
}
