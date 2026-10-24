import { beforeEach, describe, expect, it, vi } from "vitest";
import { CallError, decideCall, isStillCalling, isWaitingForOwner, pollCall, recheckCall, type CallAi, type CallStore, type DialInfo } from "../calls/service";
import { BUSY_STATUSES, type CallRow, type CallStatus } from "../calls/types";
import type { FoReply, WajoApi } from "../wajo/client";

// No real Claude calls in tests.
vi.mock("../calls/ai", () => ({
  answerCaller: vi.fn(),
  readCallResult: vi.fn(),
  judgeCandidates: vi.fn(),
  specialRequest: vi.fn(),
}));

const NOW = new Date("2026-10-23T18:00:00Z");

function row(over: Partial<CallRow> = {}): CallRow {
  return {
    id: 1, restaurant_id: 1, supplier_id: 2, context_type: "invoice", context_id: 7, purpose: "dispute",
    title: "Dispute $42 on BAM-20633", reason: "Tendon billed above the last price.",
    brief: {
      goal: "Get a $42 credit.", ask_for: "", facts: ["BAM-20633: tendon at $70, expected $59.50"], questions: [], wanted_by: "",
      limits: { min_credit: 42, max_packs: 0, max_total: 0, notes: "" }, refs: { invoice_id: 7, flag_ids: [100] },
    },
    status: "pending", proposed_by: "ai", wajo_call_id: null, dialed_number: null, progress: null, question: null,
    last_polled_at: null, outcome: null, result: null, transcript: null,
    created_at: "2026-10-23T17:00:00Z", decided_at: null, completed_at: null, error: null,
    ...over,
  };
}

// An in-memory store with the same conditional-update rule as the Supabase one.
function memoryStore(rows: CallRow[], info: Partial<DialInfo> = {}) {
  const data = new Map(rows.map((r) => [r.id, { ...r }]));
  const store: CallStore = {
    get: async (id) => data.get(id) ?? null,
    activeCount: async () => [...data.values()].filter((r) => BUSY_STATUSES.includes(r.status)).length,
    dialInfo: async () => ({
      supplier: { name: "Bay Area Meat Co.", contact_name: "Tony", phone: "510-555-0102" },
      restaurantName: "Pho Berkeley",
      restaurantEmail: null,
      ...info,
    }),
    update: async (id, from, patch) => {
      const r = data.get(id);
      if (!r || !from.includes(r.status)) return null;
      Object.assign(r, patch);
      return { ...r };
    },
  };
  return { store, data };
}

function fakeWajo(over: Partial<WajoApi> = {}): WajoApi & { started: string[]; answers: string[] } {
  const started: string[] = [];
  const answers: string[] = [];
  return {
    started,
    answers,
    startCall: async (message) => {
      started.push(message);
      return { status: "working", conversationId: "conv-1", progress: "Dialing" };
    },
    answer: async (_id, text) => {
      answers.push(text);
      return { status: "working", conversationId: "conv-1" };
    },
    getCallStatus: async () => ({ status: "working", conversationId: "conv-1", progress: "On the call" }),
    getTranscript: async () => [],
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv("DEMO_CALL_OVERRIDE_NUMBER", "");
});

describe("decideCall", () => {
  it.each(["approved", "rejected", "calling", "completed", "failed"] as CallStatus[])("refuses a %s request", async (status) => {
    const { store } = memoryStore([row({ status })]);
    const wajo = fakeWajo();
    await expect(decideCall(store, wajo, 1, { approve: true }, NOW)).rejects.toMatchObject({ status: 409 });
    expect(wajo.started).toHaveLength(0);
  });

  it("404s an unknown request", async () => {
    const { store } = memoryStore([]);
    await expect(decideCall(store, fakeWajo(), 9, { approve: false }, NOW)).rejects.toBeInstanceOf(CallError);
  });

  it("rejects without calling", async () => {
    const { store, data } = memoryStore([row()]);
    const wajo = fakeWajo();
    await decideCall(store, wajo, 1, { approve: false }, NOW);
    expect(data.get(1)!.status).toBe("rejected");
    expect(wajo.started).toHaveLength(0);
  });

  it("approves, dials the supplier's number and saves Wajo's id", async () => {
    const { store, data } = memoryStore([row()]);
    const wajo = fakeWajo();
    await decideCall(store, wajo, 1, { approve: true }, NOW);
    expect(data.get(1)).toMatchObject({ status: "calling", wajo_call_id: "conv-1", dialed_number: "+15105550102" });
    expect(wajo.started[0]).toContain("Call exactly +15105550102");
    expect(wajo.started[0]).toContain("AI assistant calling on behalf of Pho Berkeley");
  });

  it("dials the demo override and records both numbers", async () => {
    vi.stubEnv("DEMO_CALL_OVERRIDE_NUMBER", "415-335-1037");
    const { store, data } = memoryStore([row()]);
    const wajo = fakeWajo();
    await decideCall(store, wajo, 1, { approve: true }, NOW);
    expect(data.get(1)!.dialed_number).toBe("+14153351037");
    expect(data.get(1)!.result?.dial).toEqual({ dial: "+14153351037", supplier_number: "+15105550102", override: true });
    expect(wajo.started[0]).toContain("+14153351037");
    expect(wajo.started[0]).not.toContain("+15105550102");
  });

  it("uses the owner's edited brief", async () => {
    const { store, data } = memoryStore([row()]);
    const wajo = fakeWajo();
    const edited = { ...row().brief, goal: "Get a $50 credit.", limits: { ...row().brief.limits, min_credit: 50 } };
    await decideCall(store, wajo, 1, { approve: true, brief: edited }, NOW);
    expect(wajo.started[0]).toContain("at least $50.00");
    expect(data.get(1)!.brief.refs).toEqual({ invoice_id: 7, flag_ids: [100] }); // refs survive an edit
  });

  it.each(["calling", "approved"] as CallStatus[])("refuses while another call is %s", async (status) => {
    // "approved": the other call is still starting with Wajo (this once let two calls run at once).
    const { store } = memoryStore([row(), row({ id: 2, status, wajo_call_id: status === "calling" ? "conv-0" : null })]);
    const wajo = fakeWajo();
    await expect(decideCall(store, wajo, 1, { approve: true }, NOW)).rejects.toMatchObject({ status: 409 });
    expect(wajo.started).toHaveLength(0);
  });

  it("marks the request failed when Wajo errors", async () => {
    const { store, data } = memoryStore([row()]);
    const wajo = fakeWajo({ startCall: async () => { throw new Error("Wajo is down"); } });
    await decideCall(store, wajo, 1, { approve: true }, NOW);
    expect(data.get(1)).toMatchObject({ status: "failed", error: "Wajo is down" });
  });

  it("can't decide twice when two approvals race", async () => {
    const { store, data } = memoryStore([row()]);
    data.get(1)!.status = "pending";
    const racing: CallStore = { ...store, update: async (id, from, patch) => (from.includes("pending") && patch.status === "approved" ? null : store.update(id, from, patch)) };
    await expect(decideCall(racing, fakeWajo(), 1, { approve: true }, NOW)).rejects.toMatchObject({ status: 409 });
  });
});

describe("pollCall", () => {
  const calling = (over: Partial<CallRow> = {}) =>
    row({ status: "calling", wajo_call_id: "conv-1", dialed_number: "+15105550102", decided_at: "2026-10-23T17:55:00Z", ...over });
  const ai = (over: Partial<CallAi> = {}): CallAi => ({
    answerCaller: vi.fn(async () => ({ kind: "question" as const, answer: "Yes, go ahead and place it." })),
    readCallResult: vi.fn(async () => ({
      reached_person: true, supply_problem: false, outcome: "resolved" as const, credit_amount: 42, new_price: null, effective_date: "",
      delivery_eta: "", order_confirmed: false, follow_up: "", summary: "Tony agreed to a $42 credit. He'll email a corrected invoice.",
    })),
    ...over,
  });
  const status = (reply: Partial<FoReply>) => async () => ({ status: "working" as const, conversationId: "conv-1", ...reply });

  it("checks Wajo at most every 5 seconds", async () => {
    const { store } = memoryStore([calling({ last_polled_at: "2026-10-23T17:59:57Z" })]);
    const getCallStatus = vi.fn(status({}));
    await pollCall(store, fakeWajo({ getCallStatus }), 1, NOW, ai());
    expect(getCallStatus).not.toHaveBeenCalled();
  });

  it("answers Fo's go-ahead question on the owner's behalf", async () => {
    expect(isWaitingForOwner("call to +14153351037 is staged and waiting on your go-ahead before it dials")).toBe(true);
    const { store, data } = memoryStore([calling()]);
    const wajo = fakeWajo({ getCallStatus: status({ progress: "Working for 41s: call is staged and waiting on your go-ahead before it dials" }) });
    await pollCall(store, wajo, 1, NOW, ai());
    expect(wajo.answers).toEqual(["Yes, go ahead and place it."]);
    expect(data.get(1)!.result?.qa).toHaveLength(1);
    expect(data.get(1)!.status).toBe("calling");
  });

  it("says no to a different number without asking Claude", async () => {
    const { store } = memoryStore([calling()]);
    const answerCaller = vi.fn();
    const wajo = fakeWajo({ getCallStatus: status({ progress: "Waiting on your go-ahead: should I call (510) 555-0199 instead?" }) });
    await pollCall(store, wajo, 1, NOW, ai({ answerCaller }));
    expect(answerCaller).not.toHaveBeenCalled();
    expect(wajo.answers[0]).toBe("No. Only call +15105550102. Don't call +15105550199.");
  });

  it("shows Summarizing while Claude reads the finished call, then clears it", async () => {
    const { store, data } = memoryStore([calling()]);
    const stages: (string | undefined)[] = [];
    const watching: CallStore = { ...store, update: async (id, from, patch) => (patch.result && stages.push(patch.result.stage), store.update(id, from, patch)) };
    const wajo = fakeWajo({ getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: "Reached Tony. He agreed to a $42 credit." }) });
    await pollCall(watching, wajo, 1, NOW, ai({ answerCaller: vi.fn(async () => ({ kind: "report" as const, answer: "" })) }));
    expect(stages).toEqual(["summarizing", undefined]);
    expect(data.get(1)!.status).toBe("completed");
  });

  it("reads the result when the call is done", async () => {
    const { store, data } = memoryStore([calling()]);
    const wajo = fakeWajo({
      getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: "Reached Tony. He agreed to a $42 credit." }),
      getTranscript: async () => [{ role: "assistant", text: "Reached Tony. He agreed to a $42 credit." }],
    });
    await pollCall(store, wajo, 1, NOW, ai({ answerCaller: vi.fn(async () => ({ kind: "report" as const, answer: "" })) }));
    expect(data.get(1)).toMatchObject({ status: "completed", outcome: "Tony agreed to a $42 credit. He'll email a corrected invoice." });
    expect(data.get(1)!.result?.credit_amount).toBe(42);
    expect(data.get(1)!.transcript).toContain("Calling agent: Reached Tony");
  });

  it("gives up after answering 3 questions, without answering a 4th", async () => {
    const qa = [1, 2, 3].map((n) => ({ question: `Question ${n}`, answer: "Yes.", at: "2026-10-23T17:58:00Z" }));
    const { store, data } = memoryStore([calling({ result: { qa } })]);
    const answerCaller = vi.fn();
    const wajo = fakeWajo({ getCallStatus: status({ progress: "Still waiting on your confirmation" }) });
    await pollCall(store, wajo, 1, NOW, ai({ answerCaller }));
    expect(answerCaller).not.toHaveBeenCalled();
    expect(wajo.answers).toEqual([]);
    expect(data.get(1)).toMatchObject({ status: "failed" });
    expect(data.get(1)!.error).toMatch(/Wajo/);
  });

  it("finishes the call, not answers it, when Fo ends without a reply", async () => {
    const { store, data } = memoryStore([calling()]);
    const readCallResult = vi.fn(async () => ({
      reached_person: false, supply_problem: false, outcome: "callback_needed" as const, credit_amount: null, new_price: null, effective_date: "",
      delivery_eta: "", order_confirmed: false, follow_up: "Check the call in Wajo.", summary: "The caller didn't report what happened. Check Wajo.",
    }));
    const answerCaller = vi.fn();
    const wajo = fakeWajo({ getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: "The run finished without a textual reply." }) });
    await pollCall(store, wajo, 1, NOW, ai({ answerCaller, readCallResult }));
    expect(answerCaller).not.toHaveBeenCalled(); // not treated as a question
    expect(readCallResult).toHaveBeenCalledWith(expect.any(String), "(no record)");
    expect(data.get(1)).toMatchObject({ status: "completed" });
    expect(data.get(1)!.result?.outcome).toBe("callback_needed");
  });

  it("times out a call after 30 minutes", async () => {
    const { store, data } = memoryStore([calling({ decided_at: "2026-10-23T17:00:00Z" })]);
    const getCallStatus = vi.fn(status({}));
    await pollCall(store, fakeWajo({ getCallStatus }), 1, NOW, ai());
    expect(getCallStatus).not.toHaveBeenCalled();
    expect(data.get(1)).toMatchObject({ status: "failed" });
  });

  // From a real call: Fo ended a turn with this while the phone call was still going,
  // and posted the report about 90 seconds later.
  const ON_IT = "On it, the call is going out to Bay Area Meat Co. now. I'll report back as soon as it wraps up.";
  const REPORT =
    "Got through to someone at Bay Area Meat Co. They said there's a ground pork shortage for two weeks. Soonest delivery is next Friday. Want me to call back to confirm the date?";

  it("spots a short 'I'm on it' without asking Claude, but not a report or a question", () => {
    expect(isStillCalling(ON_IT)).toBe(true);
    expect(isStillCalling("On it, placing the call to Golden Lotus Asian Foods now.")).toBe(true);
    expect(isStillCalling(REPORT)).toBe(false);
    expect(isStillCalling(`${ON_IT}\n\n${REPORT}`)).toBe(false); // Wajo's reply joins every turn since our last message
    expect(isStillCalling("It's 12:46 AM where they are. Want me to call anyway?")).toBe(false);
  });

  it("keeps polling when a turn ends with 'I'm on it', then reads the later report", async () => {
    const { store, data } = memoryStore([calling()]);
    const readCallResult = ai().readCallResult;
    const answerCaller = vi.fn(async () => ({ kind: "report" as const, answer: "" }));
    let response = ON_IT;
    const wajo = fakeWajo({
      getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response }),
      getTranscript: async () => [
        { role: "assistant", text: ON_IT },
        { role: "assistant", text: REPORT },
      ],
    });
    const tools = ai({ answerCaller, readCallResult });

    await pollCall(store, wajo, 1, NOW, tools);
    expect(data.get(1)).toMatchObject({ status: "calling", progress: ON_IT });
    expect(answerCaller).not.toHaveBeenCalled();
    expect(readCallResult).not.toHaveBeenCalled();

    // Same message on the next poll: still waiting, still no Claude call.
    await pollCall(store, wajo, 1, new Date(NOW.getTime() + 6000), tools);
    expect(data.get(1)!.status).toBe("calling");
    expect(answerCaller).not.toHaveBeenCalled();

    response = `${ON_IT}\n\n${REPORT}`;
    await pollCall(store, wajo, 1, new Date(NOW.getTime() + 12000), tools);
    expect(data.get(1)!.status).toBe("completed");
    expect(readCallResult).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("ground pork shortage"));
    expect(data.get(1)!.result?.waiting_on).toBeUndefined();
  });

  it("waits when Claude says the caller is still on it", async () => {
    const { store, data } = memoryStore([calling()]);
    const wajo = fakeWajo({ getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: "Ringing Golden Lotus, hang tight." }) });
    await pollCall(store, wajo, 1, NOW, ai({ answerCaller: vi.fn(async () => ({ kind: "in_progress" as const, answer: "" })) }));
    expect(data.get(1)).toMatchObject({ status: "calling", progress: "Ringing Golden Lotus, hang tight." });
  });

  it("reads the last message from the conversation when the reply has no text, and answers its question", async () => {
    const question = "The call didn't go out yet: it's 12:46 AM where Golden Lotus is. Want me to call anyway, or wait?";
    const { store, data } = memoryStore([calling()]);
    const wajo = fakeWajo({
      getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: "The run finished without a textual reply." }),
      getTranscript: async () => [
        { role: "assistant", text: "On it, placing the call now." },
        { role: "assistant", text: question },
      ],
    });
    const answerCaller = vi.fn(async () => ({ kind: "question" as const, answer: "Yes, call now." }));
    await pollCall(store, wajo, 1, NOW, ai({ answerCaller }));
    expect(answerCaller).toHaveBeenCalledWith(expect.any(String), question);
    expect(wajo.answers).toEqual(["Yes, call now."]);
    expect(data.get(1)!.status).toBe("calling");
  });

  it("keeps waiting when the caller hasn't replied to our answer yet", async () => {
    const { store, data } = memoryStore([calling()]);
    const readCallResult = vi.fn();
    const wajo = fakeWajo({
      getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: "The run finished without a textual reply." }),
      getTranscript: async () => [
        { role: "assistant", text: "Call anyway?" },
        { role: "user", text: "Yes, call now." },
      ],
    });
    await pollCall(store, wajo, 1, NOW, ai({ readCallResult }));
    expect(data.get(1)!.status).toBe("calling");
    expect(readCallResult).not.toHaveBeenCalled();
  });

  it("reads what there is after 10 minutes of 'I'm on it'", async () => {
    const { store, data } = memoryStore([calling({ result: { waiting_on: ON_IT, waiting_since: "2026-10-23T17:49:00Z" } })]);
    const wajo = fakeWajo({ getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: ON_IT }) });
    await pollCall(store, wajo, 1, NOW, ai());
    expect(data.get(1)!.status).toBe("completed");
  });

  it("re-reads a finished call's late report, without dialing", async () => {
    const done = row({ status: "completed", wajo_call_id: "conv-1", result: { outcome: "callback_needed", qa: [] } });
    const { store, data } = memoryStore([done]);
    const wajo = fakeWajo({
      getCallStatus: async () => ({ status: "complete", conversationId: "conv-1", response: `${ON_IT}\n\n${REPORT}` }),
      getTranscript: async () => [
        { role: "assistant", text: ON_IT },
        { role: "assistant", text: REPORT },
      ],
    });
    const readCallResult = vi.fn(async () => ({
      reached_person: true, supply_problem: false, outcome: "partial" as const, credit_amount: null, new_price: null, effective_date: "",
      delivery_eta: "next Friday", order_confirmed: false, follow_up: "", summary: "Someone at Bay Area Meat said pork is short. Delivery next Friday.",
    }));
    await recheckCall(store, wajo, 1, NOW, ai({ readCallResult }));
    expect(readCallResult).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("ground pork shortage"));
    expect(data.get(1)).toMatchObject({ status: "completed", outcome: "Someone at Bay Area Meat said pork is short. Delivery next Friday." });
    expect(data.get(1)!.result?.outcome).toBe("partial");
    expect(wajo.started).toHaveLength(0);
    expect(wajo.answers).toHaveLength(0);
  });

  it("won't re-read a pending or running call", async () => {
    const { store } = memoryStore([row(), calling({ id: 2 })]);
    await expect(recheckCall(store, fakeWajo(), 1, NOW, ai())).rejects.toMatchObject({ status: 409 });
    await expect(recheckCall(store, fakeWajo(), 2, NOW, ai())).rejects.toMatchObject({ status: 409 });
  });

  it("leaves requests that aren't calling alone", async () => {
    const { store } = memoryStore([row()]);
    const getCallStatus = vi.fn(status({}));
    await pollCall(store, fakeWajo({ getCallStatus }), 1, NOW, ai());
    expect(getCallStatus).not.toHaveBeenCalled();
  });
});
