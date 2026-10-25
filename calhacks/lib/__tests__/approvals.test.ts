// Filing approvals on the Actions page (lib/approvals/sections.ts): a single-department approval
// goes under its department, one whose evidence spans departments goes under Mixed with the
// reason, and only the buttons that agree to something count as approvals.
import { describe, expect, it } from "vitest";
import { discoveryFrom } from "@/lib/agent/run";
import type { Item } from "@/lib/attention/types";
import type { Discovery } from "@/lib/intelligence/types";
import { discoveryKeyOf, hrefArea, isApprovalItem, itemOrderId, itemSection, placeAction, sectionOfTool, type BoardContext } from "@/lib/approvals/sections";

const discovery = (over: Partial<Discovery> = {}): Discovery => ({
  key: "cost-squeeze:limes", kind: "cost_squeeze", status: "verified", severity: "medium", title: "Limes up 25% across 4 dishes", noticed: "", why: "",
  areas: ["purchasing", "menu", "inventory"], impact: null, evidence: [], next: { label: "", ask: "", tools: [], href: "/suppliers", hrefLabel: "" }, ...over,
});

const ctx = (over: Partial<BoardContext> = {}): BoardContext => ({ casePlaybook: new Map(), caseDiscovery: new Map(), discoveries: new Map(), ...over });

describe("placeAction", () => {
  it("files a single-department approval under its department", () => {
    expect(placeAction({ tool: "set_menu_price", case_id: null, evidence: [{ href: "/menu" }] }, ctx())).toEqual({ section: "menu", areas: ["menu"], reason: null });
    expect(placeAction({ tool: "place_call", case_id: 4, evidence: [{ href: "/suppliers" }] }, ctx({ casePlaybook: new Map([[4, "supplier_price_rise"]]) })).section).toBe("purchasing");
    expect(placeAction({ tool: "bank_savings", case_id: null, evidence: [] }, ctx()).section).toBe("finance");
  });

  it("files it under Mixed when it came from a cross-department discovery, by its case or by the chat that opened it", () => {
    const d = discovery();
    const viaCase = placeAction({ tool: "place_call", case_id: 2, evidence: [] }, ctx({ caseDiscovery: new Map([[2, d]]) }));
    expect(viaCase).toEqual({ section: "mixed", areas: ["purchasing", "menu", "inventory"], reason: 'From the discovery "Limes up 25% across 4 dishes"' });
    const viaChat = placeAction({ tool: "send_dispute", case_id: null, evidence: [{ href: "/intelligence#cost-squeeze:limes" }] }, ctx({ discoveries: new Map([[d.key, d]]) }));
    expect(viaChat.section).toBe("mixed");
  });

  it("files it under Mixed when its playbook or its evidence spans departments", () => {
    const promo = placeAction({ tool: "start_promotion", case_id: 5, evidence: [] }, ctx({ casePlaybook: new Map([[5, "sales_dip"]]) }));
    expect(promo).toMatchObject({ section: "mixed", areas: ["marketing", "sales"] });
    expect(placeAction({ tool: "approve_purchase_order", case_id: 7, evidence: [] }, ctx({ casePlaybook: new Map([[7, "stockout_risk"]]) })).section).toBe("mixed");
    expect(placeAction({ tool: "set_menu_price", case_id: null, evidence: [{ href: "/menu" }, { href: "/suppliers/3" }] }, ctx()).reason).toBe("Draws on menu and purchasing");
  });

  it("ignores a discovery link to a discovery that no longer exists", () => {
    expect(placeAction({ tool: "send_dispute", case_id: null, evidence: [{ href: "/intelligence#gone" }] }, ctx()).section).toBe("purchasing");
  });
});

describe("links and keys", () => {
  it("maps page links to departments", () => {
    expect(["/prep", "/invoices/12", "/suppliers?x=1", "/menu/changes", "/accounting", "/marketing", "/trends", "/chat"].map(hrefArea)).toEqual(["inventory", "purchasing", "purchasing", "menu", "finance", "marketing", "sales", null]);
    expect(discoveryKeyOf([{ href: "/menu" }, { href: "/intelligence#cash-pressure" }])).toBe("cash-pressure");
    expect(sectionOfTool("publish_post")).toBe("marketing");
  });

  it("recognizes a chat opened from a discovery, even after a follow-up, and only for a real key", () => {
    const keys = ["cost-squeeze:limes", "cash-pressure"];
    expect(discoveryFrom([{ role: "user", content: "Why are limes up? [cost-squeeze:limes]" }, { role: "assistant", content: "..." }, { role: "user", content: "ok, do it" }], keys)).toBe("cost-squeeze:limes");
    expect(discoveryFrom([{ role: "user", content: "What is [this] about?" }], keys)).toBeUndefined();
    expect(discoveryFrom([{ role: "user", content: "Plain question" }], keys)).toBeUndefined();
  });
});

describe("which Needs-you items are approvals", () => {
  const item = (actions: Item["actions"], tab: Item["tab"] = "invoices") => ({ actions, tab });
  it("counts agreeing to an order, a price, the delivery prices, savings and emailed orders", () => {
    expect(isApprovalItem(item([{ kind: "post", label: "Approve", path: "/api/purchase-orders/30/status", body: { status: "approved" } }]))).toBe(true);
    expect(isApprovalItem(item([{ kind: "posts", label: "Approve all 2", calls: [{ path: "/api/menu-items/4/price", body: { price: 17 } }] }]))).toBe(true);
    expect(isApprovalItem(item([{ kind: "post", label: "Approve", path: "/api/menu/delivery-prices" }]))).toBe(true);
    expect(isApprovalItem(item([{ kind: "post", label: "Move $500 to savings", path: "/api/bank/savings", body: { amount: 500 } }]))).toBe(true);
    expect(isApprovalItem(item([{ kind: "post", label: "Accept the order", path: "/api/inbound/3/confirm" }]))).toBe(true);
  });
  it("leaves recording what already happened on its page", () => {
    expect(isApprovalItem(item([{ kind: "post", label: "Mark as sent", path: "/api/purchase-orders/30/status", body: { status: "sent" } }]))).toBe(false);
    expect(isApprovalItem(item([{ kind: "post", label: "Mark paid", path: "/api/invoices/12/paid" }]))).toBe(false);
    expect(isApprovalItem(item([{ kind: "post", label: "Picked up and paid", path: "/api/inbound/3/picked-up" }]))).toBe(false);
    expect(isApprovalItem(item([{ kind: "link", label: "Open", href: "/invoices" }]))).toBe(false);
  });
  it("knows the order an item approves and the section its tab belongs to", () => {
    expect(itemOrderId(item([{ kind: "post", label: "Approve", path: "/api/purchase-orders/30/status", body: { status: "approved" } }]))).toBe(30);
    expect(["inventory", "prep", "invoices", "menu", "accounting"].map((tab) => itemSection({ tab: tab as Item["tab"] }))).toEqual(["inventory", "inventory", "purchasing", "menu", "finance"]);
    // An order approval is purchasing even when the inventory tab listed it (a restock draft)
    expect(itemSection(item([{ kind: "post", label: "Approve", path: "/api/purchase-orders/30/status", body: { status: "approved" } }], "inventory"))).toBe("purchasing");
  });
});
