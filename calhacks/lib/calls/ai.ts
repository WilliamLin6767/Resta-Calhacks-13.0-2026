// What Claude does for supplier calls (server only). Same model, structured
// output and error handling as purchasing (lib/purchasing/ai.ts `ask`).
//
//   judgeCandidates   which detected calls are worth making, with title, reason and brief
//   specialRequest    the owner's own words -> a brief
//   answerCaller      answer the calling agent's question during an approved call
//   readCallResult    the finished call -> structured result + two-sentence summary
//
// None of these can place a call. Claude never sees or chooses the number dialed.

import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";
import type { Candidate } from "./detect";
import { CallResultSchema, type Brief, type CallResult } from "./types";

// Structured outputs keep every field required; limits are added by our code afterwards.
const BriefOutSchema = z.object({
  goal: z.string(),
  ask_for: z.string(),
  facts: z.array(z.string()),
  questions: z.array(z.string()),
  wanted_by: z.string(),
  limit_notes: z.string(),
});
type BriefOut = z.infer<typeof BriefOutSchema>;

function toBrief(out: BriefOut, limits: Brief["limits"]): Brief {
  return {
    goal: out.goal.slice(0, 500),
    ask_for: out.ask_for.slice(0, 100),
    facts: out.facts.slice(0, 20).map((s) => s.slice(0, 500)),
    questions: out.questions.slice(0, 10).map((s) => s.slice(0, 300)),
    wanted_by: out.wanted_by.slice(0, 40),
    limits: { ...limits, notes: out.limit_notes.slice(0, 500) },
  };
}

const BRIEF_RULES =
  "The brief is read by an AI phone agent calling the supplier on the restaurant's behalf. " +
  "goal: one sentence. ask_for: the contact's name if known, else 'accounts' for billing or 'orders' for ordering. " +
  "facts: short lines with exact numbers from the data (invoice number and date, line, quantity, charged vs expected price, dollar difference; or item, packs and delivery date). " +
  "questions: what to ask, if any. wanted_by: a delivery date (YYYY-MM-DD) for orders, else empty. " +
  "limit_notes: anything else the caller may or may not agree to, or empty. Money and pack limits are set separately; don't restate them. " +
  "Use only numbers present in the data. Never invent a number.";

// ---------------------------------------------------------------------

const JudgeSchema = z.object({
  calls: z.array(
    z.object({
      index: z.number().int(),
      make_call: z.boolean(),
      title: z.string(), // e.g. "Dispute $42 overcharge on invoice 10293"
      reason: z.string(), // why the call is worth making, for the owner
      brief: BriefOutSchema,
    })
  ),
});

const JUDGE_SYSTEM =
  "You help the owner of a small restaurant decide which supplier phone calls are worth making. " +
  "You get candidates found by fixed rules, each with its facts. For every candidate return make_call, a short title, a reason and a brief. " +
  "Set make_call to false when a call isn't worth it: tiny amounts (a few dollars), information the owner already has, or anything a call can't fix. " +
  "title: under 70 characters, with the dollar amount or item. reason: one or two plain sentences for the owner. " +
  "Each candidate is its own separate call: never mention other candidates in a brief or suggest combining calls. " +
  BRIEF_RULES;

export type Judged = { candidate: Candidate; title: string; reason: string; brief: Brief };

// One Claude call for all candidates of a scan.
export async function judgeCandidates(candidates: Candidate[]): Promise<Judged[]> {
  if (!candidates.length) return [];
  const input = candidates.map((c, index) => ({
    index,
    purpose: c.purpose,
    supplier: c.supplier_name,
    contact_name: c.contact_name,
    facts: c.facts,
    limits_set_by_the_app: c.limits,
    wanted_by: c.wanted_by,
  }));
  const out = await ask(JUDGE_SYSTEM, "Candidates:\n" + JSON.stringify(input, null, 1), JudgeSchema, "low");
  const judged: Judged[] = [];
  for (const call of out.calls) {
    const candidate = candidates[call.index];
    if (!candidate || !call.make_call) continue;
    const brief = toBrief(call.brief, { ...candidate.limits, notes: "" });
    if (!brief.wanted_by) brief.wanted_by = candidate.wanted_by;
    judged.push({ candidate, title: call.title.slice(0, 120), reason: call.reason.slice(0, 600), brief });
  }
  return judged;
}

// ---------------------------------------------------------------------

const SpecialSchema = z.object({
  title: z.string(),
  reason: z.string(),
  brief: BriefOutSchema,
  max_packs: z.number(),
  max_total: z.number(),
});

const SPECIAL_SYSTEM =
  "The owner of a small restaurant typed what they want an AI phone agent to ask a supplier. Turn it into a call brief. " +
  "title: under 70 characters. reason: one sentence, in the owner's terms. " +
  "max_packs and max_total: only if the owner asked to order something and gave or clearly implied a quantity or budget; otherwise 0. " +
  "If the request is to order something without a quantity, put a question about it in questions instead of ordering. " +
  BRIEF_RULES;

export async function specialRequest(
  supplier: { name: string; contact_name: string | null },
  ownerText: string
): Promise<{ title: string; reason: string; brief: Brief }> {
  const out = await ask(
    SPECIAL_SYSTEM,
    `Supplier: ${supplier.name}${supplier.contact_name ? ` (contact: ${supplier.contact_name})` : ""}\nThe owner's request: ${ownerText}`,
    SpecialSchema,
    "low"
  );
  return {
    title: out.title.slice(0, 120),
    reason: out.reason.slice(0, 600),
    brief: toBrief(out.brief, {
      min_credit: 0,
      max_packs: Math.max(0, Math.floor(out.max_packs)),
      max_total: Math.max(0, out.max_total),
      notes: "",
    }),
  };
}

// ---------------------------------------------------------------------

// question     the agent is asking the owner something: answer it
// in_progress  the agent is still on it ("placing the call now, I'll report back"): wait
// report       the agent is reporting how the finished call went: read the result
export const CALLER_MESSAGE_KINDS = ["question", "in_progress", "report"] as const;
const AnswerSchema = z.object({
  kind: z.enum(CALLER_MESSAGE_KINDS),
  answer: z.string(), // only for a question; otherwise empty
});
export type CallerReply = z.infer<typeof AnswerSchema>;

const ANSWER_SYSTEM =
  "You answer, on the restaurant owner's behalf, questions from an AI phone agent that is placing a call the owner has already approved. " +
  "You get the approved instructions and the agent's latest message. First decide its kind:\n" +
  "- question: it asks the owner something or waits for the owner's answer (a go-ahead, whether to call outside business hours, a detail). Write the answer.\n" +
  "- in_progress: it says it is placing the call, the call is going out or under way, or it will report back, but doesn't yet say how the call went. answer is empty.\n" +
  "- report: it says how the call went (who answered, what they said, no answer, voicemail, or that it couldn't place the call and isn't asking anything). answer is empty.\n" +
  "If a message reports and also offers to do more (e.g. 'Want me to call back?'), it's a report. " +
  "Answering a question: if it asks for a go-ahead or confirmation to place the approved call, including outside business hours, say yes and tell it to go ahead now. " +
  "If it asks something the instructions answer, answer from them. If it asks to go beyond the limits (more money, more packs, other numbers, card details, new terms), say no and tell it to say the owner will follow up. " +
  "Never add new facts or numbers. Keep answers to one or two sentences.";

export async function answerCaller(callMessage: string, agentText: string): Promise<CallerReply> {
  return ask(
    ANSWER_SYSTEM,
    `Approved instructions:\n${callMessage}\n\nThe agent's latest message:\n${agentText}`,
    AnswerSchema,
    "low"
  );
}

// ---------------------------------------------------------------------

const RESULT_SYSTEM =
  "You read the record of a phone call an AI agent made to a restaurant's supplier, and fill in what happened. " +
  "Use only what the record says; if something isn't stated, use null, false or an empty string. " +
  "outcome: resolved, partial, refused, no_answer or callback_needed. If the record doesn't show the call happened or what was said, use callback_needed and say so in follow_up. " +
  "new_price: per pack. effective_date: YYYY-MM-DD. " +
  "summary: exactly two plain sentences for the restaurant owner about the call with the supplier: who answered, what they said, and what was agreed or is still open. " +
  "Write as if reporting the call yourself: don't mention the AI agent, Wajo, the app, instructions, messages between them, or that a transcript was or wasn't provided. " +
  "follow_up: what the owner should do next, in the same plain terms, or empty. " +
  "supply_problem: true if the supplier said anything that means they can't reliably supply the item at a workable price soon: a shortage, out of stock, discontinued, " +
  "can't deliver before the restaurant runs low, or a price rise that won't come down soon (or will go up again). " +
  "Judge by what the supplier said, even if the call was informal or the answers sounded doubtful: put any doubts in follow_up, don't set false because of them. " +
  "False only if supply and price are fine, or the call didn't reach anyone or didn't cover the item.";

export async function readCallResult(callMessage: string, record: string): Promise<CallResult> {
  return ask(RESULT_SYSTEM, `What the agent was asked to do:\n${callMessage}\n\nThe record:\n${record}`, CallResultSchema, "low");
}

// ---------------------------------------------------------------------

const SwitchSchema = z.object({
  recommend_switch: z.boolean(),
  verdict: z.string(), // two sentences for the owner
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  lead_index: z.number().int(), // the lead to call, or -1
  call: z.object({ title: z.string(), reason: z.string(), brief: BriefOutSchema }),
});
export type SwitchDecision = z.infer<typeof SwitchSchema>;

const SWITCH_SYSTEM =
  "You help the owner of a small restaurant decide whether to look for a new supplier after their current supplier reported a supply problem on a phone call. " +
  "You get what the supplier said, what the shortage puts at risk (dishes that use the item, their sales and profit over the last 30 days, share of revenue, days of stock left; all worked out by the app), " +
  "and the candidates to switch to: source on_file = a supplier the restaurant already buys from that sells this item (with its price on file), " +
  "source thomasnet = an outside company found on ThomasNet (an online directory) with what it says it sells.\n" +
  "Weigh the pros of switching (e.g. sales and profit at risk, stock running out before the current supplier can deliver, a price rise with no relief, a cheaper price on file) " +
  "against the cons (e.g. a short or minor problem that resolves soon, little revenue at risk, an unknown company with no price, minimum orders, distance, " +
  "a company that doesn't clearly sell this food for restaurants). Lists of 2 to 4 short pros and cons, using the given numbers.\n" +
  "recommend_switch: true only if the pros clearly outweigh the cons AND a candidate plausibly sells this food to restaurants. Prefer an on_file supplier when there is one: " +
  "it's a known business and already set up. Never pick a company whose description shows it sells something else (chemicals, equipment, canned products when fresh meat is needed). " +
  "lead_index: that candidate's index, or -1. " +
  "verdict: exactly two plain sentences: what you recommend and the main reason. " +
  "today is given: use dates only as the supplier stated them or as given; never add or guess a year.\n" +
  "call: only when recommending, a first call to that candidate: title under 70 characters; reason one sentence. " +
  "For an on_file supplier, the brief asks whether they have the item now, the current price per pack, and how soon they can deliver. " +
  "For a thomasnet company, it asks whether they sell the item to restaurants, the price per pack and pack sizes, minimum order, delivery to the restaurant and how soon, " +
  "and how to set up an account. Either way it is information only: no order. " +
  "When not recommending, fill call with empty strings and empty lists. " +
  BRIEF_RULES;

export async function weighSwitch(input: {
  today: string; // YYYY-MM-DD
  ingredient: string;
  call: { supplier: string; summary: string; follow_up: string; delivery_eta: string; outcome: string };
  impact: unknown;
  leads: { index: number; source: "on_file" | "thomasnet"; company_name: string; city: string | null; state: string | null; sells: string | null }[];
}): Promise<SwitchDecision> {
  return ask(SWITCH_SYSTEM, "The situation:\n" + JSON.stringify(input, null, 1), SwitchSchema, "medium");
}

// The new company's call brief: information only, so every money and pack limit is 0.
export function switchBrief(decision: SwitchDecision): Brief {
  return toBrief(decision.call.brief, { min_credit: 0, max_packs: 0, max_total: 0, notes: "" });
}
