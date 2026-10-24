import { describe, expect, it } from "vitest";
import { buildCallMessage, defaultAskFor } from "../calls/brief";
import { dialTarget, formatPhone, normalizePhone, otherNumberIn } from "../calls/phone";
import { CALL_STEPS, callStep, finishedPriority, sortFinished, suggestedActions, type Brief } from "../calls/types";

const dispute: Brief = {
  goal: "Get a credit for the tendon overcharge on invoice BAM-20633.",
  ask_for: "",
  facts: ["Invoice BAM-20633, Oct 20: BF TENDON, 4 cases at $70.00, expected $59.50. Difference $42.00."],
  questions: [],
  wanted_by: "",
  limits: { min_credit: 42, max_packs: 0, max_total: 0, notes: "" },
};

const message = (brief: Brief, email: string | null = null) =>
  buildCallMessage({
    brief,
    purpose: "dispute",
    restaurantName: "Pho Berkeley",
    restaurantEmail: email,
    supplier: { name: "Bay Area Meat Co.", contact_name: null },
    dial: "+15105550102",
  });

describe("buildCallMessage", () => {
  it("says it's an AI, at the start and when asked", () => {
    const text = message(dispute);
    expect(text).toContain('Open the call with "Hi, this is an AI assistant calling on behalf of Pho Berkeley."');
    expect(text).toContain("say you're an AI assistant");
  });

  it("states the limits and refuses card details and new terms", () => {
    const text = message(dispute);
    expect(text).toContain("credit or a corrected invoice for at least $42.00");
    expect(text).toContain("Never give payment card or bank details");
    expect(text).toContain("Don't agree to new contract terms");
  });

  it("adds order limits only when set", () => {
    expect(message(dispute)).not.toContain("packs");
    const order = message({ ...dispute, limits: { min_credit: 0, max_packs: 3, max_total: 277.2, notes: "" } });
    expect(order).toContain("Order at most 3 packs, at most $277.20 total");
  });

  it("dials only the given number, and asks for written confirmation", () => {
    const text = message(dispute, "owner@example.com");
    expect(text).toContain("Call exactly +15105550102 and no other number");
    expect(text).toContain("confirm what was agreed by email to owner@example.com");
    expect(message(dispute)).toContain("confirm what was agreed in writing");
  });

  it("asks for the contact, or accounts / orders", () => {
    expect(message(dispute)).toContain("Who to ask for: accounts (billing).");
    expect(defaultAskFor("buy", null)).toBe("orders");
    expect(defaultAskFor("buy", " Maria ")).toBe("Maria");
  });

  it("asks for every result field back", () => {
    const text = message(dispute);
    for (const words of ["reached a person", "credit amount", "new price", "delivery date", "order was confirmed", "transcript"]) {
      expect(text).toContain(words);
    }
  });
});

describe("phone numbers", () => {
  it("normalizes US numbers to E.164", () => {
    expect(normalizePhone("510-555-0103")).toBe("+15105550103");
    expect(normalizePhone("(415) 335-1037")).toBe("+14153351037");
    expect(normalizePhone("1 415 335 1037")).toBe("+14153351037");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0103")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(formatPhone("+14153351037")).toBe("(415) 335-1037");
  });

  it("dials the supplier, or the demo override and keeps both", () => {
    expect(dialTarget("510-555-0103", undefined)).toEqual({ dial: "+15105550103", supplier_number: "+15105550103", override: false });
    expect(dialTarget("510-555-0103", "415-335-1037")).toEqual({ dial: "+14153351037", supplier_number: "+15105550103", override: true });
    // An unusable override is ignored; a supplier without a number can't be called at all.
    expect(dialTarget("510-555-0103", "nope")?.override).toBe(false);
    expect(dialTarget(null, "415-335-1037")).toBeNull();
  });

  it("spots a different number in the caller's question", () => {
    expect(otherNumberIn("Should I call (510) 555-0199 instead?", "+15105550103")).toBe("+15105550199");
    expect(otherNumberIn("The call to +14153351037 is staged", "+14153351037")).toBeNull();
  });
});

describe("suggestedActions", () => {
  const base = { status: "completed" as const, brief: { ...dispute, refs: { flag_ids: [100], ingredient_id: 11 } } };
  const result = { reached_person: true, supply_problem: false, outcome: "resolved" as const, credit_amount: 42, new_price: null, effective_date: "", delivery_eta: "", order_confirmed: false, follow_up: "", summary: "" };

  it("offers to resolve the flag after a dispute is settled", () => {
    expect(suggestedActions({ ...base, purpose: "dispute", result }).map((a) => a.id)).toEqual(["resolve_flags"]);
  });

  it("offers to record a new price, and hides actions already done", () => {
    const withPrice = { ...result, outcome: "partial" as const, credit_amount: null, new_price: 65, effective_date: "2026-11-01" };
    expect(suggestedActions({ ...base, purpose: "info", result: withPrice })[0]).toMatchObject({ id: "record_price", label: "Record new price $65.00 from 2026-11-01" });
    expect(suggestedActions({ ...base, purpose: "info", result: { ...withPrice, applied: ["record_price"] } })).toEqual([]);
  });

  it("offers nothing before the call is done", () => {
    expect(suggestedActions({ ...base, status: "calling", purpose: "dispute", result })).toEqual([]);
  });
});

describe("callStep", () => {
  it("walks the progress bar: starting, on the phone, summarizing, done", () => {
    expect(CALL_STEPS).toEqual(["Starting the call", "On the phone", "Summarizing", "Done"]);
    expect(callStep({ status: "approved", result: null })).toBe(0);
    expect(callStep({ status: "calling", result: { qa: [] } })).toBe(1);
    // Claude answering the caller's questions happens in the background: still "On the phone".
    expect(callStep({ status: "needs_input", result: null })).toBe(1);
    expect(callStep({ status: "calling", result: { stage: "summarizing" } })).toBe(2);
    expect(callStep({ status: "completed", result: { outcome: "resolved" } })).toBe(3);
  });

  it("shows no progress for requests that aren't under way", () => {
    for (const status of ["pending", "rejected", "failed"] as const) expect(callStep({ status, result: null })).toBeNull();
  });
});

describe("finished calls order", () => {
  const NOW = new Date("2026-10-24T12:00:00Z");
  const result = { reached_person: true, supply_problem: false, credit_amount: null, new_price: null, effective_date: "", delivery_eta: "", order_confirmed: false, summary: "" };
  const done = (id: number, at: string, over: Record<string, unknown> = {}) => ({
    id,
    status: "completed" as const,
    purpose: "info" as const,
    brief: { ...dispute, refs: { ingredient_id: 11 } },
    result: { ...result, outcome: "resolved" as const, follow_up: "" },
    completed_at: at,
    decided_at: at,
    created_at: at,
    ...over,
  });

  const settledNew = done(1, "2026-10-24T11:00:00Z");
  const settledOld = done(2, "2026-10-23T09:00:00Z");
  const followUp = done(3, "2026-10-22T09:00:00Z", { result: { ...result, outcome: "partial", follow_up: "Confirm the delivery date." } });
  const toDo = done(4, "2026-10-20T09:00:00Z", { result: { ...result, outcome: "resolved", follow_up: "", new_price: 65, effective_date: "2026-11-01" } });
  const failed = done(5, "2026-10-23T10:00:00Z", { status: "failed" as const, result: null });
  const monthOld = done(6, "2026-09-20T09:00:00Z", { result: { ...result, outcome: "partial", follow_up: "Call back." } });

  it("ranks: something to click, then follow-ups and failures, then settled calls", () => {
    expect(finishedPriority(toDo)).toBe(0);
    expect(finishedPriority(followUp)).toBe(1);
    expect(finishedPriority(failed)).toBe(1);
    expect(finishedPriority(settledNew)).toBe(2);
  });

  it("puts the most important first, newest first within each, and old calls at the bottom", () => {
    const order = sortFinished([settledOld, monthOld, settledNew, followUp, failed, toDo], NOW).map((c) => c.id);
    expect(order).toEqual([4, 5, 3, 1, 2, 6]);
  });

  it("drops a call once its suggested action is done", () => {
    const applied = { ...toDo, result: { ...toDo.result, applied: ["record_price"] } };
    expect(finishedPriority(applied)).toBe(2);
  });
});
