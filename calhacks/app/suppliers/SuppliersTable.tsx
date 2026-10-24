import { CallBadge } from "@/components/calls/CallControls";
import ErrorMessage from "@/components/ErrorMessage";
import SimpleTable from "@/components/SimpleTable";
import EmptyState from "@/components/ui/EmptyState";
import PreviewSection from "@/components/ui/Preview";
import { formatPhone, normalizePhone } from "@/lib/calls/phone";
import { pendingCounts } from "@/lib/calls/service";
import { telHref } from "@/lib/market/leads";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

const PREVIEW = 3;

// Suppliers on file. `preview` (the Suppliers tab): the first three, ones with calls waiting
// first, and a link to /suppliers/contacts with them all.
export default async function SuppliersTable({ preview = false }: { preview?: boolean }) {
  const supabase = await getSupabase();
  const [{ data, error }, counts] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, category, contact_name, phone, preferred_channel, lead_time_days, delivery_days")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("name"),
    pendingCounts(supabase).catch(() => null),
  ]);
  if (error) return <ErrorMessage message={error.message} />;

  const waiting = (id: number) => counts?.bySupplier[id] ?? 0;
  const all = data ?? [];
  const rows = preview ? [...all].sort((a, b) => waiting(b.id) - waiting(a.id)).slice(0, PREVIEW) : all;
  const table = (
    <SimpleTable
      empty={<EmptyState title="No suppliers on file yet." icon="truck" />}
      columns={[
        { key: "name", label: "Supplier" },
        { key: "category", label: "Category" },
        { key: "contact_name", label: "Contact" },
        { key: "phone", label: "Phone" },
        { key: "preferred_channel", label: "Order by" },
        { key: "lead_time_days", label: "Lead time (days)" },
        { key: "delivery_days", label: "Delivers" },
      ]}
      rows={rows.map((row) => {
        const phone = normalizePhone(row.phone);
        return {
          ...row,
          name: (
            <>
              {row.name}
              <CallBadge count={counts?.bySupplier[row.id]} />
            </>
          ),
          phone: phone ? (
            <a href={telHref(phone)} className="font-medium text-gray-900 underline">
              {formatPhone(phone)}
            </a>
          ) : (
            <span className="text-gray-400">none on file</span>
          ),
        };
      })}
    />
  );
  if (!preview) return table;
  return (
    <PreviewSection title="Contacts on file" href="/suppliers/contacts" total={all.length} shown={rows.length}>
      {table}
    </PreviewSection>
  );
}
