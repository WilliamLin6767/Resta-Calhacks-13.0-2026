import { describe, expect, it } from "vitest";
import type { Digest } from "@/lib/analytics";
import {
  AssistantRequestSchema,
  CHART_IDS,
  chartContext,
  chartFromResult,
  checkQuestion,
  explainChartMessage,
  explainCompareMessage,
  screenContextText,
  type AssistantRequest,
} from "@/lib/assistant";
import type { CompareResult } from "@/lib/compare";
import type { WaterfallStep } from "@/lib/insights";
import digest30Json from "./fixtures/digest-30.json";

const d30 = digest30Json as unknown as Digest;
const DONT_SHOW = "Don't call show_chart; I can already see it.";

const question = (content: string): AssistantRequest => ({ days: 30, messages: [{ role: "user", content }] });

describe("chartContext", () => {
  it("gives a title, an explanation and data for every chart", () => {
    for (const id of CHART_IDS) {
      const ctx = chartContext(id, d30);
      expect(ctx.title.length).toBeGreaterThan(0);
      expect(ctx.howItWorks.length).toBeGreaterThan(0);
      expect(ctx.data).toBeTruthy();
    }
  });
  it("returns only by_weekday for the weekday chart", () => {
    expect(chartContext("weekday", d30).data).toEqual(d30.by_weekday);
  });
  it("starts the waterfall at revenue", () => {
    const steps = chartContext("waterfall", d30).data as WaterfallStep[];
    expect(steps[0]).toMatchObject({ label: "Revenue", amount: d30.kpis.cur!.revenue });
  });
});

describe("AssistantRequestSchema", () => {
  it("accepts a question", () => {
    expect(AssistantRequestSchema.safeParse(question("Which weekday is slowest?")).success).toBe(true);
  });
  it("accepts explain requests", () => {
    expect(AssistantRequestSchema.safeParse({ days: 7, messages: [], explain: { chart: "menu" }, page: "Analytics" }).success).toBe(true);
    expect(
      AssistantRequestSchema.safeParse({ days: 60, messages: [], explain: { compare: { metric: "revenue", breakdown: "dish" } } }).success,
    ).toBe(true);
  });
  it("rejects 14 days, an unknown chart and 13 messages", () => {
    expect(AssistantRequestSchema.safeParse({ ...question("hi"), days: 14 }).success).toBe(false);
    expect(AssistantRequestSchema.safeParse({ days: 30, messages: [], explain: { chart: "weather" } }).success).toBe(false);
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "hi" }));
    expect(AssistantRequestSchema.safeParse({ days: 30, messages: thirteen }).success).toBe(false);
  });
});

describe("checkQuestion", () => {
  it("is fine for a normal question or an explain request", () => {
    expect(checkQuestion(question("Which weekday is slowest?"))).toBeNull();
    expect(checkQuestion({ days: 30, messages: [], explain: { chart: "kpis" } })).toBeNull();
  });
  it("needs the last message to be a user question", () => {
    expect(checkQuestion({ days: 30, messages: [] })).toBeTruthy();
    expect(
      checkQuestion({
        days: 30,
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      }),
    ).toBeTruthy();
  });
  it("limits the question to 1000 characters", () => {
    expect(checkQuestion(question("x".repeat(1001)))).toMatch(/1,000/);
    expect(checkQuestion(question("x".repeat(1000)))).toBeNull();
  });
});

describe("explain messages", () => {
  it("include the chart data and the don't-show line", () => {
    const ctx = chartContext("weekday", d30);
    const text = explainChartMessage(ctx, 30);
    expect(text).toContain(ctx.title);
    expect(text).toContain(JSON.stringify(ctx.data));
    expect(text).toContain(DONT_SHOW);
  });
  it("include the compare result and the don't-show line", () => {
    const result: CompareResult = {
      metric: "revenue",
      breakdown: "weekday",
      aggregation: "per_open_day",
      period: d30.period,
      has_previous: true,
      rows: [{ key: 1, label: "Monday", value: 2000, prev_value: 1900 }],
    };
    const text = explainCompareMessage(result);
    expect(text).toContain(JSON.stringify(result));
    expect(text).toContain(DONT_SHOW);
    expect(chartFromResult(result).title).toBe("Revenue by day of the week, average per open day (last 30 days)");
  });
});

describe("view (what's on screen)", () => {
  const base = question("what am I looking at?");

  it("accepts a valid view", () => {
    const view = { focus: { chart: "menu" }, visible: [{ chart: "menu" }, { compare: { metric: "revenue", breakdown: "hour" } }] };
    expect(AssistantRequestSchema.safeParse({ ...base, view }).success).toBe(true);
    expect(AssistantRequestSchema.safeParse({ ...base, view: { visible: [] } }).success).toBe(true);
  });
  it("rejects an unknown chart id", () => {
    expect(AssistantRequestSchema.safeParse({ ...base, view: { focus: { chart: "weather" }, visible: [] } }).success).toBe(false);
    expect(AssistantRequestSchema.safeParse({ ...base, view: { visible: [{ chart: "weather" }] } }).success).toBe(false);
  });
  it("rejects more than 8 visible charts", () => {
    const nine = Array.from({ length: 9 }, () => ({ chart: "kpis" }));
    expect(AssistantRequestSchema.safeParse({ ...base, view: { visible: nine } }).success).toBe(false);
  });
});

describe("screenContextText", () => {
  it("names the focused chart and includes only its data", () => {
    const text = screenContextText({ focus: { chart: "menu" }, visible: [{ chart: "menu" }, { chart: "kpis" }] }, d30);
    expect(text).toContain('They are looking at "Menu engineering"');
    expect(text).toContain("On screen: Menu engineering, Key numbers.");
    expect(text).toContain(d30.menu[0].name);
    expect(text).toContain(JSON.stringify(chartContext("menu", d30).data));
    // Not the data of other visible charts.
    expect(text).not.toContain(JSON.stringify(chartContext("kpis", d30).data));
  });
  it("uses a compare chart's title, and its data when it loaded", () => {
    const focus = { compare: { metric: "revenue", breakdown: "weekday" } } as const;
    const result: CompareResult = {
      metric: "revenue",
      breakdown: "weekday",
      aggregation: "per_open_day",
      period: d30.period,
      has_previous: true,
      rows: [{ key: 1, label: "Monday", value: 2088.6, prev_value: 2130.05 }],
    };
    const title = "Revenue by day of the week, average per open day (last 30 days)";
    expect(screenContextText({ focus, visible: [focus] }, d30)).toContain(`"${title}"`);
    expect(screenContextText({ focus, visible: [focus] }, d30)).not.toContain("Its data");
    expect(screenContextText({ focus, visible: [focus] }, d30, result)).toContain(JSON.stringify(result));
  });
  it("lists the charts without a focus, and is empty without a view", () => {
    const text = screenContextText({ visible: [{ chart: "hour" }] }, d30);
    expect(text).toContain("On screen: Average orders by hour.");
    expect(text).not.toContain("They are looking at");
    expect(screenContextText({ visible: [] }, d30)).toContain("no charts");
    expect(screenContextText(undefined, d30)).toBe("");
  });
});
