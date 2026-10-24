// Supplier calls on top of Supabase and Wajo (server only).
//
//   scanForCalls        detect candidates, let Claude judge them, save pending requests
//   createOwnerRequest  the owner's own request ("ask if they can deliver Saturday") -> pending
//   listCalls           requests for one record (or a supplier, or all), for the panel
//   pendingCounts       pending requests per record, for badges
//   decideCall          approve (and dial) or reject; only from pending
//   pollCall            while a call runs: check Wajo at most every 5s, answer the
//                       caller's questions, and read the result when it's done
//   applyAction         a suggested action after the call, clicked by the owner
//
// Nothing dials unless the owner approved that request: decideCall is the only
// place a call starts, and it only runs on a pending request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { setOrderStatus } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { WajoApi } from "@/lib/wajo/client";
import { answerCaller, judgeCandidates, readCallResult, specialRequest } from "./ai";
import { buildCallMessage } from "./brief";
import { findCandidates, type Facts, type FactFlag, type NoPhone } from "./detect";
import { dialTarget, otherNumberIn, type DialTarget } from "./phone";
import {
  ACTIVE_STATUSES,
  BUSY_STATUSES,
  BriefSchema,
  suggestedActions,
  type Brief,
  type CallQA,
  type CallResult,
  type CallRow,
  type CallStatus,
  type ContextType,
  type StoredResult,
} from "./types";

type Db = SupabaseClient;

export class CallError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const POLL_EVERY_MS = 5000; // Wajo is asked at most this often per request
const MAX_ANSWERS = 3; // questions we answer for the caller before giving up
const CALL_TIMEOUT_MS = 30 * 60 * 1000;
const QUIET_MS = 10 * 60 * 1000; // a "still on it" with no news for this long: read what there is

// Today in the restaurant's time zone, YYYY-MM-DD.
export function today(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data;
}

// Like must(), for a row that has to exist.
function one<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = must(res, what);
  if (data === null || data === undefined) throw new Error(`Could not ${what}: not found.`);
  return data;
}

const isMissingTable = (msg: string) => /does not exist|could not find the table|schema cache/i.test(msg);

// ---------------------------------------------------------------------
// Detection: load the facts, find candidates, judge, save
// ---------------------------------------------------------------------

export async function loadFacts(db: Db, day = today()): Promise<Facts> {
  const [sup, ing, orders, existing] = await Promise.all([
    db.from("suppliers").select("id, name, contact_name, phone, preferred_channel, lead_time_days, delivery_days").eq("restaurant_id", RESTAURANT_ID),
    db.from("ingredients").select("id, name, unit, current_qty, reorder_point, par_level, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID),
    db.from("purchase_orders").select("id, supplier_id, purchase_order_lines(ingredient_id, qty)").eq("restaurant_id", RESTAURANT_ID).eq("status", "draft"),
    db.from("call_requests").select("context_type, context_id, status, created_at").eq("restaurant_id", RESTAURANT_ID),
  ]);
  const suppliers = must(sup, "load suppliers") ?? [];
  const ingredients = (must(ing, "load ingredients") ?? []).map((i) => ({
    ...i,
    current_qty: Number(i.current_qty),
    reorder_point: i.reorder_point === null ? null : Number(i.reorder_point),
    par_level: i.par_level === null ? null : Number(i.par_level),
  }));
  const ids = ingredients.map((i) => i.id);
  const prices = (must(
    await db.from("supplier_prices").select("supplier_id, ingredient_id, pack_qty, pack_desc, price, effective_date").in("ingredient_id", ids.length ? ids : [0]),
    "load supplier prices"
  ) ?? []).map((p) => ({ ...p, pack_qty: Number(p.pack_qty), price: Number(p.price) }));

  // invoice_flags comes from 04_purchasing.sql; without it, detect.ts compares invoice lines with past prices.
  type FlagJoin = {
    id: number; invoice_id: number; kind: string; message: string; money_impact: number | null;
    invoices: { invoice_number: string | null; invoice_date: string; supplier_id: number | null };
    invoice_lines: { description: string; qty: number; unit_price: number } | null;
  };
  let flags: FactFlag[] | null = null;
  let invoiceLines: Facts["invoiceLines"] = [];
  const flagRes = await db
    .from("invoice_flags")
    .select("id, invoice_id, kind, message, money_impact, invoices!inner(invoice_number, invoice_date, supplier_id, restaurant_id), invoice_lines(description, qty, unit_price)")
    .eq("resolved", false)
    .eq("invoices.restaurant_id", RESTAURANT_ID);
  if (flagRes.error && !isMissingTable(flagRes.error.message)) throw new Error(`Could not load invoice problems: ${flagRes.error.message}`);
  if (!flagRes.error) {
    flags = ((flagRes.data ?? []) as unknown as FlagJoin[]).map((f) => ({
      id: f.id,
      invoice_id: f.invoice_id,
      invoice_number: f.invoices.invoice_number,
      invoice_date: f.invoices.invoice_date,
      supplier_id: f.invoices.supplier_id,
      kind: f.kind,
      message: f.message,
      money_impact: f.money_impact === null ? null : Number(f.money_impact),
      line: f.invoice_lines ? { description: f.invoice_lines.description, qty: Number(f.invoice_lines.qty), unit_price: Number(f.invoice_lines.unit_price) } : null,
    }));
  } else {
    type LineJoin = { invoice_id: number; ingredient_id: number | null; description: string; qty: number; unit_price: number; invoices: { invoice_number: string | null; invoice_date: string; supplier_id: number | null } };
    const lines = must(
      await db
        .from("invoice_lines")
        .select("invoice_id, ingredient_id, description, qty, unit_price, invoices!inner(invoice_number, invoice_date, supplier_id, restaurant_id)")
        .not("ingredient_id", "is", null)
        .eq("invoices.restaurant_id", RESTAURANT_ID),
      "load invoice lines"
    ) as unknown as LineJoin[];
    invoiceLines = (lines ?? []).map((l) => ({
      invoice_id: l.invoice_id,
      invoice_number: l.invoices.invoice_number,
      invoice_date: l.invoices.invoice_date,
      supplier_id: l.invoices.supplier_id,
      ingredient_id: l.ingredient_id,
      description: l.description,
      qty: Number(l.qty),
      unit_price: Number(l.unit_price),
    }));
  }

  type OrderJoin = { id: number; supplier_id: number | null; purchase_order_lines: { ingredient_id: number; qty: number }[] };
  return {
    today: day,
    suppliers,
    ingredients,
    prices,
    flags,
    invoiceLines,
    draftOrders: ((must(orders, "load purchase orders") ?? []) as OrderJoin[]).map((o) => ({ id: o.id, supplier_id: o.supplier_id, lines: o.purchase_order_lines })),
    existing: must(existing, "load call requests") ?? [],
  };
}

export type ScanResult = { created: { id: number; title: string }[]; considered: number; noPhone: NoPhone[] };

export async function scanForCalls(db: Db): Promise<ScanResult> {
  const facts = await loadFacts(db);
  const { candidates, noPhone } = findCandidates(facts);
  const judged = await judgeCandidates(candidates);
  if (!judged.length) return { created: [], considered: candidates.length, noPhone };

  const rows = judged.map(({ candidate: c, title, reason, brief }) => ({
    restaurant_id: RESTAURANT_ID,
    supplier_id: c.supplier_id,
    context_type: c.context_type,
    context_id: c.context_id,
    purpose: c.purpose,
    title,
    reason,
    brief: { ...brief, refs: c.refs },
    proposed_by: "ai",
  }));
  const created = must(await db.from("call_requests").insert(rows).select("id, title"), "save call requests") ?? [];
  return { created, considered: candidates.length, noPhone };
}

// ---------------------------------------------------------------------
// The owner's own request (also used by the assistant's propose_call tool)
// ---------------------------------------------------------------------

export async function createOwnerRequest(
  db: Db,
  input: { supplier_id: number; text: string; context_type?: ContextType; context_id?: number },
  proposedBy: "owner" | "ai" = "owner"
): Promise<{ id: number; title: string }> {
  const supplier = must(
    await db.from("suppliers").select("id, name, contact_name, phone").eq("id", input.supplier_id).eq("restaurant_id", RESTAURANT_ID).maybeSingle(),
    "find that supplier"
  );
  if (!supplier) throw new CallError("Unknown supplier.", 404);
  if (!dialTarget(supplier.phone)) throw new CallError(`${supplier.name} has no phone number on file.`, 400);
  const { title, reason, brief } = await specialRequest(supplier, input.text);
  const row = one(
    await db
      .from("call_requests")
      .insert({
        restaurant_id: RESTAURANT_ID,
        supplier_id: supplier.id,
        context_type: input.context_type ?? "supplier",
        context_id: input.context_id ?? supplier.id,
        purpose: "special_request",
        title,
        reason,
        brief: { ...brief, refs: {} },
        proposed_by: proposedBy,
      })
      .select("id, title")
      .single(),
    "save the call request"
  );
  return row;
}

// ---------------------------------------------------------------------
// Reading requests for the panel and the badges
// ---------------------------------------------------------------------

export type CallView = CallRow & {
  supplier: { name: string; contact_name: string | null; phone: string | null };
  dial: DialTarget | null; // where an approved call goes (or went)
  actions: ReturnType<typeof suggestedActions>;
};

export async function listCalls(
  db: Db,
  filter: { context_type?: ContextType; context_id?: number; supplier_id?: number }
): Promise<CallView[]> {
  let q = db
    .from("call_requests")
    .select("*, suppliers(name, contact_name, phone)")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("created_at", { ascending: false })
    .limit(50);
  if (filter.context_type) q = q.eq("context_type", filter.context_type);
  if (filter.context_id !== undefined) q = q.eq("context_id", filter.context_id);
  if (filter.supplier_id !== undefined) q = q.eq("supplier_id", filter.supplier_id);
  const rows = (must(await q, "load call requests") ?? []) as (CallRow & { suppliers: CallView["supplier"] })[];
  return rows.map(({ suppliers, ...row }) => ({
    ...row,
    supplier: suppliers,
    dial: dialTarget(suppliers.phone),
    actions: suggestedActions(row),
  }));
}

export type PendingCounts = {
  byContext: Record<string, number>; // "invoice:12" -> 1
  bySupplier: Record<string, number>;
  total: number;
  sections: { invoices: number; inventory: number; suppliers: number }; // for the sidebar
};

export async function pendingCounts(db: Db): Promise<PendingCounts> {
  const res = await db.from("call_requests").select("context_type, context_id, supplier_id").eq("restaurant_id", RESTAURANT_ID).eq("status", "pending");
  // Before 13_calls.sql is run, show no badges instead of breaking the page.
  if (res.error && isMissingTable(res.error.message)) return { byContext: {}, bySupplier: {}, total: 0, sections: { invoices: 0, inventory: 0, suppliers: 0 } };
  const rows = must(res, "count call requests") ?? [];
  const counts: PendingCounts = { byContext: {}, bySupplier: {}, total: rows.length, sections: { invoices: 0, inventory: 0, suppliers: rows.length } };
  for (const r of rows) {
    const key = `${r.context_type}:${r.context_id}`;
    counts.byContext[key] = (counts.byContext[key] ?? 0) + 1;
    counts.bySupplier[r.supplier_id] = (counts.bySupplier[r.supplier_id] ?? 0) + 1;
    if (r.context_type === "invoice" || r.context_type === "purchase_order") counts.sections.invoices += 1;
    if (r.context_type === "ingredient") counts.sections.inventory += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------
// Deciding and following a call. These go through a small store so they can
// be tested without a database.
// ---------------------------------------------------------------------

export type DialInfo = {
  supplier: { name: string; contact_name: string | null; phone: string | null };
  restaurantName: string;
  restaurantEmail: string | null;
};

export type CallStore = {
  get(id: number): Promise<CallRow | null>;
  activeCount(): Promise<number>; // requests starting or calling right now (BUSY_STATUSES)
  dialInfo(row: CallRow): Promise<DialInfo>;
  // Updates only if the row's status is still one of `from`; returns null otherwise.
  update(id: number, from: CallStatus[], patch: Partial<CallRow>): Promise<CallRow | null>;
};

export function supabaseStore(db: Db): CallStore {
  return {
    async get(id) {
      return must(await db.from("call_requests").select("*").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle(), "load the call request");
    },
    async activeCount() {
      const res = await db.from("call_requests").select("id", { count: "exact", head: true }).eq("restaurant_id", RESTAURANT_ID).in("status", BUSY_STATUSES);
      if (res.error) throw new Error(`Could not check calls in progress: ${res.error.message}`);
      return res.count ?? 0;
    },
    async dialInfo(row) {
      const [sup, rest] = await Promise.all([
        db.from("suppliers").select("name, contact_name, phone").eq("id", row.supplier_id).single(),
        db.from("restaurants").select("name").eq("id", row.restaurant_id).single(),
      ]);
      return {
        supplier: one(sup, "load the supplier"),
        restaurantName: one(rest, "load the restaurant").name,
        restaurantEmail: process.env.RESTAURANT_EMAIL || null,
      };
    },
    async update(id, from, patch) {
      return must(await db.from("call_requests").update(patch).eq("id", id).in("status", from).select("*").maybeSingle(), "update the call request");
    },
  };
}

export type CallAi = { answerCaller: typeof answerCaller; readCallResult: typeof readCallResult };
const defaultAi: CallAi = { answerCaller, readCallResult };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The message the calling agent gets, rebuilt from the stored brief and fresh data.
function messageFor(row: CallRow, info: DialInfo, target: DialTarget) {
  return buildCallMessage({
    brief: row.brief,
    purpose: row.purpose,
    restaurantName: info.restaurantName,
    restaurantEmail: info.restaurantEmail,
    supplier: info.supplier,
    dial: target.dial,
  });
}

// Approve (and dial) or reject. Only a pending request can be decided.
export async function decideCall(
  store: CallStore,
  wajo: WajoApi,
  id: number,
  input: { approve: boolean; brief?: Brief },
  now = new Date()
): Promise<CallRow> {
  const row = await store.get(id);
  if (!row) throw new CallError("Unknown call request.", 404);
  if (row.status !== "pending") throw new CallError(`This request is already ${row.status}.`, 409);
  const decidedAt = now.toISOString();

  if (!input.approve) {
    const rejected = await store.update(id, ["pending"], { status: "rejected", decided_at: decidedAt });
    if (!rejected) throw new CallError("This request was decided in the meantime.", 409);
    return rejected;
  }

  const brief = input.brief ? BriefSchema.parse(input.brief) : row.brief;
  // One call at a time: Wajo's agent works one task at a time.
  if ((await store.activeCount()) > 0) throw new CallError("Another call is in progress. Approve this one when it's done.", 409);

  const info = await store.dialInfo(row);
  const target = dialTarget(info.supplier.phone);
  if (!target) throw new CallError(`${info.supplier.name} has no usable phone number on file.`, 400);

  const approvedRow = { ...row, brief: { ...brief, refs: row.brief.refs ?? {} } };
  const approved = await store.update(id, ["pending"], {
    status: "approved",
    decided_at: decidedAt,
    brief: approvedRow.brief,
    dialed_number: target.dial,
    result: { dial: target } as StoredResult,
  });
  if (!approved) throw new CallError("This request was decided in the meantime.", 409);

  let reply;
  try {
    reply = await wajo.startCall(messageFor(approvedRow, info, target));
  } catch (err) {
    return (await store.update(id, ["approved"], { status: "failed", error: errorText(err) })) ?? approved;
  }
  if (reply.status === "failed") {
    return (await store.update(id, ["approved"], { status: "failed", wajo_call_id: reply.conversationId, error: reply.response ?? "Wajo couldn't start the call." })) ?? approved;
  }
  return (
    (await store.update(id, ["approved"], {
      status: "calling",
      wajo_call_id: reply.conversationId,
      progress: reply.progress ?? "Starting the call",
    })) ?? approved
  );
}

// Fo says it's waiting for the account owner (a go-ahead or an answer) while still "working".
export function isWaitingForOwner(progress: string): boolean {
  return /go-?ahead|waiting (on|for) (your|you)|needs your|your (answer|reply|confirmation|approval)|before it (dials|goes out)/i.test(progress);
}

function transcriptText(turns: { role: string; text: string; at?: string }[]): string {
  return turns.map((t) => `${t.role === "user" ? "Restaurant app" : "Calling agent"}: ${t.text}`).join("\n\n");
}

// While a call runs: ask Wajo how it's going (at most every 5 seconds), answer the
// caller's questions within the approved brief, and read the result when it's done.
export async function pollCall(store: CallStore, wajo: WajoApi, id: number, now = new Date(), ai: CallAi = defaultAi): Promise<CallRow> {
  const row = await store.get(id);
  if (!row) throw new CallError("Unknown call request.", 404);
  if (!ACTIVE_STATUSES.includes(row.status) || !row.wajo_call_id) return row;
  if (row.last_polled_at && now.getTime() - new Date(row.last_polled_at).getTime() < POLL_EVERY_MS) return row;

  const active = row.status as CallStatus;
  const claimed = await store.update(id, [active], { last_polled_at: now.toISOString() });
  if (!claimed) return (await store.get(id)) ?? row;
  const conversationId = row.wajo_call_id;
  const result: StoredResult = row.result ?? {};
  const qa = result.qa ?? [];

  if (row.decided_at && now.getTime() - new Date(row.decided_at).getTime() > CALL_TIMEOUT_MS) {
    return (await store.update(id, ACTIVE_STATUSES, { status: "failed", error: "The call didn't finish within 30 minutes. Check Wajo." })) ?? claimed;
  }

  let reply;
  try {
    reply = await wajo.getCallStatus(conversationId);
  } catch (err) {
    // A failed status check isn't a failed call: keep it running and try again next poll.
    return (await store.update(id, ACTIVE_STATUSES, { progress: `Couldn't check on the call: ${errorText(err)}` })) ?? claimed;
  }

  if (reply.status === "failed") {
    return (await store.update(id, ACTIVE_STATUSES, { status: "failed", error: reply.response ?? "The call failed.", completed_at: now.toISOString() })) ?? claimed;
  }

  const info = await store.dialInfo(row);
  const target = result.dial ?? dialTarget(info.supplier.phone);
  const callMessage = target ? messageFor(row, info, target) : "";

  // Answer a question from the caller, on the owner's behalf, within the approved brief.
  const answer = async (question: string): Promise<CallRow> => {
    if (qa.at(-1)?.question === question) {
      return (await store.update(id, ACTIVE_STATUSES, { status: "calling", progress: "Waiting for the caller after our answer" })) ?? claimed;
    }
    if (qa.length >= MAX_ANSWERS) {
      return (await store.update(id, ACTIVE_STATUSES, { status: "failed", question, error: "The caller kept asking questions. Check the conversation in Wajo." })) ?? claimed;
    }
    const other = row.dialed_number ? otherNumberIn(question, row.dialed_number) : null;
    let text: string;
    if (other) {
      text = `No. Only call ${row.dialed_number}. Don't call ${other}.`;
    } else {
      try {
        const out = await ai.answerCaller(callMessage, question);
        if (out.kind === "in_progress") return keepWaiting(question);
        if (out.kind === "report") return finish(question);
        text = out.answer;
      } catch (err) {
        return (await store.update(id, ACTIVE_STATUSES, { status: "needs_input", question, error: `Couldn't answer the caller: ${errorText(err)}` })) ?? claimed;
      }
    }
    try {
      await wajo.answer(conversationId, text);
    } catch (err) {
      return (await store.update(id, ACTIVE_STATUSES, { status: "needs_input", question, error: errorText(err) })) ?? claimed;
    }
    const entry: CallQA = { question, answer: text, at: now.toISOString() };
    return (
      (await store.update(id, ACTIVE_STATUSES, {
        status: "calling",
        question: null,
        error: null,
        progress: "Answered the caller's question",
        result: { ...result, qa: [...qa, entry], waiting_on: undefined, waiting_since: undefined },
      })) ?? claimed
    );
  };

  // The caller says it's still on it ("the call is going out now, I'll report back"):
  // keep polling. If it says the same thing for 10 minutes, read what there is.
  const keepWaiting = async (said: string): Promise<CallRow> => {
    const since = result.waiting_on === said && result.waiting_since ? result.waiting_since : now.toISOString();
    if (now.getTime() - new Date(since).getTime() > QUIET_MS) return finish(said);
    return (
      (await store.update(id, ACTIVE_STATUSES, {
        status: "calling",
        progress: said.length > 200 ? `${said.slice(0, 197)}...` : said,
        result: { ...result, waiting_on: said, waiting_since: since },
      })) ?? claimed
    );
  };

  // The call is over: keep the transcript and read the result.
  const finish = async (finalText: string): Promise<CallRow> => {
    let turns: Awaited<ReturnType<WajoApi["getTranscript"]>> = [];
    try {
      turns = await wajo.getTranscript(conversationId);
    } catch {
      // The final reply alone is still worth reading.
    }
    const transcript = transcriptText(turns);
    const record = [transcript, finalText && `Final reply: ${finalText}`].filter(Boolean).join("\n\n");
    // Show "Summarizing" on the progress bar while Claude reads the call.
    await store.update(id, ACTIVE_STATUSES, { status: "calling", result: { ...result, stage: "summarizing" } });
    let read: CallResult | null = null;
    let readError: string | null = null;
    try {
      read = await ai.readCallResult(callMessage, record || "(no record)");
    } catch (err) {
      readError = `Couldn't read the call result: ${errorText(err)}`;
    }
    return (
      (await store.update(id, ACTIVE_STATUSES, {
        status: "completed",
        completed_at: now.toISOString(),
        transcript: transcript || null,
        outcome: read?.summary ?? (finalText || "The call finished, but the caller didn't report what happened."),
        result: { ...result, ...(read ?? {}), qa, waiting_on: undefined, waiting_since: undefined, stage: undefined },
        question: null,
        progress: null,
        error: readError,
      })) ?? claimed
    );
  };

  if (reply.status === "working") {
    const progress = reply.progress ?? "";
    if (isWaitingForOwner(progress)) return answer(progress);
    return (await store.update(id, ACTIVE_STATUSES, { status: "calling", progress: progress || "On the call" })) ?? claimed;
  }

  // "complete" ends the caller's turn, not necessarily the phone call. The turn can end with
  // a question, a "placing the call now, I'll report back" (the report comes as a later turn),
  // or the report itself.
  const text = (reply.response ?? "").trim();
  let said = text && !/finished without a textual reply/i.test(text) ? text : "";
  if (!said) {
    // No text in the reply: the caller's latest message is in the conversation, unless
    // it hasn't said anything since our last message.
    let turns: Awaited<ReturnType<WajoApi["getTranscript"]>> = [];
    try {
      turns = await wajo.getTranscript(conversationId);
    } catch {
      // Treated like an empty conversation below.
    }
    const last = turns.at(-1);
    if (last?.role === "user") return keepWaiting(result.waiting_on ?? "Waiting for the caller after our answer");
    said = last?.role === "assistant" ? last.text.trim() : "";
    if (!said) return finish("");
  }
  if (said === result.waiting_on || isStillCalling(said)) return keepWaiting(said);
  return answer(said); // a question gets answered; Claude hands a report to finish()
}

// A finished call whose report came in late (or was missed): read Wajo's latest reply
// and conversation again and redo the result. Read-only on Wajo's side: never dials.
export async function recheckCall(store: CallStore, wajo: WajoApi, id: number, now = new Date(), ai: CallAi = defaultAi): Promise<CallRow> {
  const row = await store.get(id);
  if (!row) throw new CallError("Unknown call request.", 404);
  if (!["completed", "failed"].includes(row.status) || !row.wajo_call_id) {
    throw new CallError("Only a finished call that reached Wajo can be checked again.", 409);
  }
  const reply = await wajo.getCallStatus(row.wajo_call_id);
  if (reply.status === "working") throw new CallError("Wajo is still working on this call. Try again in a minute.", 409);
  const turns = await wajo.getTranscript(row.wajo_call_id);
  const transcript = transcriptText(turns);
  const finalText = (reply.response ?? "").trim();
  const record = [transcript, finalText && !/finished without a textual reply/i.test(finalText) && `Final reply: ${finalText}`].filter(Boolean).join("\n\n");

  const info = await store.dialInfo(row);
  const result: StoredResult = row.result ?? {};
  const target = result.dial ?? dialTarget(info.supplier.phone);
  const read = await ai.readCallResult(target ? messageFor(row, info, target) : "", record || "(no record)");
  const updated = await store.update(id, ["completed", "failed"], {
    status: "completed",
    completed_at: row.completed_at ?? now.toISOString(),
    transcript: transcript || null,
    outcome: read.summary,
    result: { ...result, ...read, waiting_on: undefined, waiting_since: undefined, stage: undefined },
    question: null,
    progress: null,
    error: null,
  });
  if (!updated) throw new CallError("This call changed in the meantime. Reload and try again.", 409);
  return updated;
}

// A short "I'm on it" from the caller that doesn't yet say how the call went, e.g.
// "On it, the call is going out to Bay Area Meat Co. now. I'll report back as soon as it wraps up."
// Long messages and questions go to Claude instead: a report often starts with the same words.
export function isStillCalling(text: string): boolean {
  if (text.length > 250 || text.includes("?")) return false;
  return /report back|i'll (let you know|update you|get back to you)|(placing|making|dialing|starting) the call|call is (going out|under way|underway|ringing|in progress)|calling (them|.{1,60}) now/i.test(text);
}

// ---------------------------------------------------------------------
// After the call: actions the owner clicks
// ---------------------------------------------------------------------

export async function applyAction(db: Db, id: number, actionId: string): Promise<void> {
  const row = await supabaseStore(db).get(id);
  if (!row) throw new CallError("Unknown call request.", 404);
  const action = suggestedActions(row).find((a) => a.id === actionId);
  if (!action) throw new CallError("That action isn't available for this call.", 400);
  const refs = row.brief.refs ?? {};

  if (action.id === "resolve_flags") {
    must(await db.from("invoice_flags").update({ resolved: true }).in("id", refs.flag_ids ?? []), "resolve the invoice problems");
  } else if (action.id === "record_price") {
    const ingredientId = refs.ingredient_id ?? refs.ingredient_ids?.[0];
    const last = must(
      await db.from("supplier_prices").select("pack_qty, pack_desc").eq("supplier_id", row.supplier_id).eq("ingredient_id", ingredientId!).order("effective_date", { ascending: false }).limit(1).maybeSingle(),
      "find the current pack size"
    );
    if (!last) throw new CallError("No earlier price for this item, so the pack size is unknown. Record it from an invoice instead.", 400);
    must(
      await db.from("supplier_prices").insert({
        supplier_id: row.supplier_id,
        ingredient_id: ingredientId,
        pack_qty: last.pack_qty,
        pack_desc: last.pack_desc,
        price: action.price,
        effective_date: action.effective_date || today(),
        source: "quote",
      }),
      "record the new price"
    );
  } else if (action.id === "mark_po_sent") {
    const po = one(await db.from("purchase_orders").select("status").eq("id", refs.purchase_order_id!).single(), "find the order");
    if (po.status === "draft") await setOrderStatus(db, refs.purchase_order_id!, "approved");
    await setOrderStatus(db, refs.purchase_order_id!, "sent");
  }

  const result = row.result ?? {};
  must(
    await db.from("call_requests").update({ result: { ...result, applied: [...(result.applied ?? []), action.id] } }).eq("id", id),
    "save what was done"
  );
}
