// The operating picture from loaded data (pure): each department's headline numbers and freshness,
// the cross-department discoveries (connect.ts), and what the loop and the owner actually did.
import { MENU_CLASSES } from "@/lib/analytics";
import type { CaseRow } from "@/lib/loop/types";
import { detectSalesDips } from "@/lib/loop/detect";
import { discover } from "./connect";
import { AREA_INFO, AREAS, STAGES, type ActivityItem, type AreaId, type AreaSnapshot, type Fact, type Loaded, type Picture, type Source, type Stage } from "./types";

const DAY = 86400_000;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n}%`);
const change = (cur: number, prev: number | undefined) => (prev && prev > 0 ? ` (${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}% vs the 30 days before)` : "");

// How old data may be before it's called stale: a count older than 3 days, a digest ending 2 days ago.
export const STALE_COUNT_DAYS = 3;
export const STALE_DIGEST_DAYS = 2;

function snapshot(id: AreaId, src: Source<unknown>, facts: Fact[], asOf: string | null, stale = false): AreaSnapshot {
  const info = AREA_INFO[id];
  return {
    id, label: info.label, href: info.href, source: info.source, tools: info.tools,
    available: src.ok, ...(src.ok ? {} : { error: src.error }),
    as_of: src.ok ? asOf ?? src.at : null,
    stale: src.ok && stale,
    facts: src.ok ? facts : [],
  };
}

export function areaSnapshots(l: Loaded, dips: number): AreaSnapshot[] {
  const now = Date.parse(l.now);
  const digest = l.digest.ok ? l.digest.data : null;
  const cur = digest?.kpis.cur;
  const prev = digest?.kpis.prev;
  const digestEnd = digest?.period.end ?? null;
  const digestStale = digestEnd !== null && now - Date.parse(`${digestEnd}T23:59:59`) > STALE_DIGEST_DAYS * DAY;

  const out: Record<AreaId, AreaSnapshot> = {} as Record<AreaId, AreaSnapshot>;

  out.sales = snapshot("sales", l.digest, cur ? [
    { label: "Revenue, 30 days", value: `${money(cur.revenue)}${change(cur.revenue, prev?.revenue)}` },
    { label: "Orders", value: `${cur.orders.toLocaleString("en-US")}${cur.avg_ticket !== null ? `, ${money(cur.avg_ticket)} average ticket` : ""}` },
    { label: "Dayparts down 10%+", value: l.sales.ok ? String(dips) : "unknown (order lines didn't load)" },
  ] : [{ label: "Orders", value: "none in the last 30 days" }], digestEnd, digestStale);

  if (l.inventory.ok) {
    const lines = l.inventory.data.lines;
    const counted = lines.map((x) => x.last_counted).filter((d): d is string => d !== null).sort();
    const newest = counted.at(-1) ?? null;
    const out_ = lines.filter((x) => x.status === "out").length;
    const low = lines.filter((x) => x.status === "low").length;
    out.inventory = snapshot("inventory", l.inventory, [
      { label: "Ingredients tracked", value: String(lines.length) },
      { label: "Out or low", value: `${out_} out, ${low} low` },
      { label: "Waste, last 7 days", value: money(l.inventory.data.wasteWeek) },
      { label: "Last count", value: newest ?? "never" },
    ], newest, newest === null || now - Date.parse(`${newest}T12:00:00`) > STALE_COUNT_DAYS * DAY);
  } else out.inventory = snapshot("inventory", l.inventory, [], null);

  const orders = l.orders.ok ? l.orders.data : [];
  const drafts = orders.filter((o) => o.status === "draft");
  const rises = digest ? digest.price_changes.filter((c) => c.is_current_supplier && c.change_pct >= 5) : [];
  out.purchasing = snapshot("purchasing", l.orders, [
    { label: "Orders waiting for approval", value: drafts.length ? `${drafts.length}, ${money(drafts.reduce((s, o) => s + o.total, 0))}` : "none" },
    { label: "Orders approved or on the way", value: String(orders.length - drafts.length) },
    { label: "Supplier price rises (5%+)", value: digest ? String(rises.length) : "unknown" },
  ], null);

  if (l.money.ok && l.money.data.connected) {
    const m = l.money.data;
    const sum = (b: { total: number }[]) => money(b.reduce((s, x) => s + x.total, 0));
    out.finance = snapshot("finance", l.money, [
      { label: "Bank balance (simulated)", value: m.balance !== null ? money(m.balance) : "n/a" },
      { label: "Lowest day, next 2 weeks", value: m.lowest ? `${money(m.lowest.balance)} on ${m.lowest.date}` : "n/a" },
      { label: "Bills overdue", value: `${m.bills.overdue.length}, ${sum(m.bills.overdue)}` },
      { label: "Bills due soon", value: `${m.bills.due_soon.length}, ${sum(m.bills.due_soon)}` },
    ], null);
  } else if (l.money.ok) {
    out.finance = snapshot("finance", l.money, [{ label: "Bank", value: "not connected" }, { label: "Bills overdue", value: String(l.money.data.bills.overdue.length) }], null);
  } else out.finance = snapshot("finance", l.money, [], null);

  if (l.posts.ok) {
    const posts = l.posts.data;
    const published = posts.filter((p) => p.status === "published" || p.status === "posted");
    const recent = published.filter((p) => now - Date.parse(p.posted_at ?? p.created_at) < 14 * DAY);
    const last = published.map((p) => p.posted_at ?? p.created_at).sort().at(-1) ?? null;
    out.marketing = snapshot("marketing", l.posts, [
      { label: "Drafts waiting", value: String(posts.filter((p) => p.status === "draft").length) },
      { label: "Published, last 14 days", value: String(recent.length) },
      { label: "Last published", value: last ? last.slice(0, 10) : "never" },
    ], last);
  } else out.marketing = snapshot("marketing", l.posts, [], null);

  if (digest) {
    const count = (c: string) => digest.menu.filter((m) => m.class === c).length;
    out.menu = snapshot("menu", l.digest, [
      { label: "Dishes sold", value: String(digest.menu.length) },
      ...MENU_CLASSES.map((c) => ({ label: `${c.label}s`, value: String(count(c.id)) })),
      { label: "Average margin a plate", value: digest.menu_thresholds.margin_threshold !== null ? `$${digest.menu_thresholds.margin_threshold.toFixed(2)}` : "n/a" },
    ], digestEnd, digestStale);
    out.analytics = snapshot("analytics", l.digest, cur ? [
      { label: "Food cost", value: pct(cur.food_cost_pct) },
      { label: "Prime cost", value: pct(cur.prime_cost_pct) },
      { label: "Estimated profit", value: `${money(cur.est_profit)} (${pct(cur.est_profit_pct)})` },
      { label: "Period", value: `${digest.period.start} to ${digest.period.end}` },
    ] : [{ label: "Period", value: `${digest.period.start} to ${digest.period.end}, no orders` }], digestEnd, digestStale);
  } else {
    out.menu = snapshot("menu", l.digest, [], null);
    out.analytics = snapshot("analytics", l.digest, [], null);
  }

  return AREAS.map((id) => out[id]);
}

// ---------- What was actually done: the loop's cases and the action log ----------

const CASE_STAGE: Record<string, Stage | "Turned down" | "Failed"> = {
  detected: "Detected", investigating: "Investigating", proposed: "Proposed", approved: "Executed", running: "Executed",
  measuring: "Measuring", closed: "Completed", dismissed: "Turned down", failed: "Failed",
};
const ACTION_STAGE: Record<string, Stage | "Turned down" | "Failed"> = {
  proposed: "Awaiting approval", approved: "Executed", running: "Executed", done: "Completed",
  rejected: "Turned down", expired: "Turned down", undone: "Turned down", failed: "Failed",
};

const caseTitle = (c: CaseRow) => String(c.facts.title ?? c.playbook.replace(/_/g, " "));

export function activity(l: Loaded): { items: ActivityItem[]; stages: Record<Stage, number> } {
  const cases = l.cases.ok ? l.cases.data : [];
  const actions = l.actions.ok ? l.actions.data : [];
  const waiting = new Set(actions.filter((a) => a.status === "proposed").map((a) => a.id));

  const items: ActivityItem[] = [
    ...cases.map((c): ActivityItem => {
      // A proposed case whose action is on a card is waiting for the owner, not for Resta
      const stage = c.status === "proposed" && c.proposal?.action_ids.some((id) => waiting.has(id)) ? "Awaiting approval" : CASE_STAGE[c.status] ?? "Detected";
      return {
        key: `case:${c.id}`, kind: "case", id: c.id, title: caseTitle(c),
        detail: c.result ? `${c.result.verdict}${c.report ? `: ${c.report}` : ""}` : c.proposal?.recommendation ?? null,
        stage, at: c.updated_at, href: "/actions?tab=cases",
      };
    }),
    // Actions not part of a case (proposed in chat, or done by the owner on a page)
    ...actions.filter((a) => a.case_id === null).map((a): ActivityItem => ({
      key: `action:${a.id}`, kind: "action", id: a.id, title: a.title, detail: a.source === "owner" ? "Done by you on a page" : "Proposed by the assistant",
      stage: ACTION_STAGE[a.status] ?? "Proposed", at: a.done_at ?? a.created_at, href: a.status === "proposed" ? "/actions" : "/actions?tab=history",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const i of items) if (i.stage in stages) stages[i.stage as Stage] += 1;
  return { items: items.slice(0, 12), stages };
}

export function buildPicture(l: Loaded): Picture {
  const discoveries = discover(l);
  const dips = l.sales.ok ? detectSalesDips(l.sales.data.lines, l.sales.data.dishes, l.now).length : 0;
  const { items, stages } = activity(l);
  const actions = l.actions.ok ? l.actions.data : [];
  return {
    generated_at: l.now,
    areas: areaSnapshots(l, dips),
    discoveries,
    findings: l.findings.ok ? l.findings.data : [],
    pending: actions.filter((a) => a.status === "proposed").slice(0, 8).map((a) => ({ id: a.id, title: a.title })),
    activity: items,
    stages,
  };
}
