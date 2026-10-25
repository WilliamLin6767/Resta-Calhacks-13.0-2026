// The autonomous loop: one loop for every kind of problem. A playbook says how to find a kind of
// problem in code, which tools the agent may use to investigate it, which actions it may propose,
// and how to measure afterwards whether things went better. Playbooks are data, not new agents.
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

export const CASE_STATUSES = ["detected", "investigating", "proposed", "approved", "running", "measuring", "closed", "dismissed", "failed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const OPEN_CASE_STATUSES: CaseStatus[] = ["detected", "investigating", "proposed", "approved", "running", "measuring"];

// What detect found, worked out in code.
export type Detected = {
  finding_key: string;
  title: string; // "Weekday lunch revenue is down 13%"
  facts: Record<string, unknown>;
  evidence: { label: string; value: string; href?: string }[];
  impact_usd_week: number | null;
  basis: string;
};

export type Goal = { metric: string; label: string; direction: "up" | "down"; target?: number; unit: string };

export type Verdict = "above usual" | "about the same" | "below usual" | "too early to tell";

export type Lesson = { playbook: string; action: string; item: string; verdict: Verdict; difference: number | null };

export type CaseRow = {
  id: number;
  restaurant_id: number;
  playbook: string;
  finding_key: string;
  status: CaseStatus;
  facts: Record<string, unknown>;
  evidence: Detected["evidence"];
  proposal: { recommendation: string; why: string; action_tools: string[]; action_ids: number[]; drafted: string[] } | null;
  goal: Goal | null;
  baseline: { method: string; value: number | null } | null;
  window_start: string | null;
  window_end: string | null;
  result: { value: number | null; baseline: number | null; difference: number | null; sample: { days: number; orders: number }; cost: number; verdict: Verdict } | null;
  report: string | null;
  lesson: Lesson | null;
  error: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

// What measuring a case needs: the goal metric in the window, and its baseline, from code.
export type Measured = { value: number | null; baseline: number | null; sample: { days: number; orders: number }; cost: number; unit: string; item: string; action: string };

export type Playbook = {
  id: string; // "supplier_price_rise"
  title: string;
  detect(db: Db): Promise<Detected[]>; // plain code; returns facts and impact, or []
  investigate: { tools: string[]; question: string }; // read tools the agent may use
  actions: string[]; // the draft and commit tools it may propose, nothing else
  goal(facts: Record<string, unknown>): Goal; // the metric is computed in code (measure)
  window: { days: number };
  baseline: "same_weekdays_prior_4w" | "forecast" | "previous_invoices" | "none";
  limits: { cooldownDays: number; maxOpen: number };
  autonomy: "inform" | "propose"; // "act" is not allowed in this build
  measure(db: Db, c: CaseRow): Promise<Measured>;
};
