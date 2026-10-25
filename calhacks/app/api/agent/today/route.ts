import { loadBar } from "@/lib/attention/service";
import { TAB_LABELS, TABS } from "@/lib/attention/types";
import { loadInventory } from "@/lib/inventory/service";
import { handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// GET /api/agent/today
// What needs the owner on every tab, plus low stock, as plain data for the Fetch.ai agents
// (calhacks/agents). Read only. Uses each tab's saved AI headline; never writes a new one.
export async function GET() {
  try {
    const db = await getSupabase();
    const [bars, inventory] = await Promise.all([
      Promise.allSettled(TABS.map((tab) => loadBar(db, tab))),
      loadInventory(db),
    ]);
    const tabs = TABS.map((tab, i) => {
      const r = bars[i];
      if (r.status === "rejected") return { tab: TAB_LABELS[tab].label, error: String(r.reason?.message ?? r.reason) };
      return {
        tab: TAB_LABELS[tab].label,
        headline: r.value.summary?.headline ?? null,
        items: r.value.items.map((i) => ({ level: i.level, title: i.title, detail: i.detail ?? null })),
      };
    });
    const low = inventory.lines
      .filter((l) => l.status !== "ok")
      .sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99))
      .map((l) => ({ name: l.name, status: l.status, left: `${l.estimated} ${l.unit}`, par: `${l.par_level} ${l.unit}`, days_left: l.days_left }));
    return Response.json({ today: inventory.today, tabs, low_stock: low });
  } catch (err) {
    return handleError(err);
  }
}
