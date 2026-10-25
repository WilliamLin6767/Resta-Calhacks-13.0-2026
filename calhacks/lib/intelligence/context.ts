// Layer 1 of the agent's context (pure): the operating picture as a short block for the system
// prompt, under a fixed budget. Layer 2 (a department's detail, one discovery's full evidence) is
// the get_operating_picture tool; layer 3 (what was tried before and how it went) is
// get_case_history. Nothing here is remembered between conversations: it's recomputed from the
// database (cached for a few minutes), and the block says when.
import type { Discovery, Picture } from "./types";

export const CONTEXT_BUDGET = 3200; // characters, about 800 tokens
const MAX_DISCOVERIES = 5;

const money = (n: number) => `$${n.toFixed(2)}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

export function discoveryLine(d: Discovery): string {
  const impact = d.impact ? ` Worth ${money(d.impact.amount_usd)}${d.impact.per === "week" ? " a week" : " once"} (${d.impact.basis}).` : " No dollar figure.";
  const kase = d.case ? ` Loop case #${d.case.id} is ${d.case.status}.` : "";
  return `- [${d.key}] ${d.status === "verified" ? "VERIFIED" : "HYPOTHESIS"} (${d.areas.join(" + ")}): ${d.title}.${impact}${kase} Next: ${d.next.tools.join(", ")}.`;
}

export function contextBlock(p: Picture, budget = CONTEXT_BUDGET): string {
  const head = `Operating picture, computed by code from the database at ${time(p.generated_at)} Pacific (not memory; numbers are traceable to the tools named). For a department's detail or a discovery's full evidence use get_operating_picture; for what was tried before and how it went use get_case_history.`;
  const areas = p.areas
    .filter((a) => a.available)
    .map((a) => `- ${a.label}${a.stale ? " (stale)" : ""}: ${a.facts.slice(0, 3).map((f) => `${f.label} ${f.value}`).join("; ")}`);
  const missing = p.areas.filter((a) => !a.available);
  const lines = [
    head,
    `Departments:\n${areas.join("\n")}`,
    missing.length ? `Not available right now (say so if asked; don't guess): ${missing.map((a) => `${a.label} (${a.error ?? "no data"})`).join("; ")}.` : "",
  ];
  const discoveries = p.discoveries.slice(0, MAX_DISCOVERIES).map(discoveryLine);
  const closing =
    "Cross-department discoveries are found by fixed rules: VERIFIED means every part is a recorded number; HYPOTHESIS means the numbers are real but the link " +
    "between them is a guess. Say which, keep evidence, hypothesis and recommendation apart, and never present a correlation as the cause.";

  // Over budget, the least important discoveries go first; past that the block is cut.
  let out = "";
  for (let n = discoveries.length; n >= 0; n--) {
    const block = [...lines, n ? `Cross-department discoveries:\n${discoveries.slice(0, n).join("\n")}` : "", n ? closing : ""].filter(Boolean).join("\n\n");
    out = block;
    if (block.length <= budget) return block;
  }
  return out.slice(0, budget);
}
