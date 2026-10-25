// Convex is only the live-update layer: Supabase stays the database for everything. These
// tables hold just enough for open screens to notice a change (see lib/live/ in Next.js).
// No transcripts, briefs, phone numbers or money.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { topicValidator } from "./topics";

// The same statuses as CALL_STATUSES in lib/calls/types.ts.
export const callStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("calling"),
  v.literal("needs_input"),
  v.literal("completed"),
  v.literal("failed"),
);

// What the calls panel shows while a supplier call changes. callId is the Supabase id.
export const liveCallFields = {
  callId: v.number(),
  restaurantId: v.number(),
  contextType: v.string(),
  contextId: v.number(),
  supplierId: v.number(),
  status: callStatusValidator,
  progress: v.optional(v.string()),
  question: v.optional(v.string()),
  outcome: v.optional(v.string()),
  // "summarizing" once the call is over and Claude is reading it (moves the progress bar a step)
  stage: v.optional(v.literal("summarizing")),
  updatedAt: v.number(), // ms
};

// The same shape as PendingCounts in lib/calls/service.ts.
export const countsFields = {
  total: v.number(),
  sections: v.object({ invoices: v.number(), inventory: v.number(), suppliers: v.number() }),
  byContext: v.record(v.string(), v.number()), // "invoice:12" -> 1
  bySupplier: v.record(v.string(), v.number()),
};

// The same statuses as ACTION_STATUSES in lib/agent/actions.ts.
export const actionStatusValidator = v.union(
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("rejected"),
  v.literal("undone"),
  v.literal("expired"),
);

// An action card's status while it changes. actionId is the Supabase id. The label is generic
// ("Supplier call"), never the title, args or evidence: no names, numbers or money here.
export const liveActionFields = {
  actionId: v.number(),
  restaurantId: v.number(),
  status: actionStatusValidator,
  label: v.string(),
  updatedAt: v.number(), // ms
};

export default defineSchema({
  liveActions: defineTable(liveActionFields).index("by_restaurant_and_actionId", ["restaurantId", "actionId"]),

  liveCalls: defineTable(liveCallFields)
    .index("by_callId", ["callId"])
    .index("by_restaurant_status", ["restaurantId", "status"])
    // For the panels: newest first, for one record, one kind of record, or one supplier
    .index("by_restaurant_and_callId", ["restaurantId", "callId"])
    .index("by_restaurant_and_contextType_and_contextId_and_callId", ["restaurantId", "contextType", "contextId", "callId"])
    .index("by_restaurant_and_supplierId_and_callId", ["restaurantId", "supplierId", "callId"]),

  liveCounts: defineTable({ restaurantId: v.number(), ...countsFields, updatedAt: v.number() }).index("by_restaurant", ["restaurantId"]),

  liveTopics: defineTable({ restaurantId: v.number(), topic: topicValidator, version: v.number(), updatedAt: v.number() }).index(
    "by_restaurant_topic",
    ["restaurantId", "topic"],
  ),
});
