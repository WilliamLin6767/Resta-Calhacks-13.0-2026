// The live-update layer. Next.js writes to Supabase first, then calls these mutations from the
// server (lib/live/signal.ts) with LIVE_SYNC_SECRET. Browsers only use the queries.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { countsFields, liveActionFields, liveCallFields } from "./schema";
import { TOPICS, topicValidator, type Topic } from "./topics";

const callValidator = v.object(liveCallFields);
const countsValidator = v.object(countsFields);
type LiveCall = typeof callValidator.type;
type Counts = typeof countsValidator.type;

// Every mutation takes the shared secret. It's set in the Convex deployment and in the Next.js
// server's env, never in the browser.
function checkSecret(secret: string) {
  const expected = process.env.LIVE_SYNC_SECRET;
  if (!expected || secret !== expected) throw new Error("Not allowed");
}

const CALL_KEYS = ["restaurantId", "contextType", "contextId", "supplierId", "status", "progress", "question", "outcome", "stage"] as const;

// Writes the call unless nothing the panel shows changed, so a status check every few seconds
// doesn't wake every open screen. Returns whether it changed.
async function writeCall(ctx: MutationCtx, call: LiveCall): Promise<boolean> {
  const existing = await ctx.db
    .query("liveCalls")
    .withIndex("by_callId", (q) => q.eq("callId", call.callId))
    .unique();
  if (!existing) {
    await ctx.db.insert("liveCalls", call);
    return true;
  }
  if (CALL_KEYS.every((k) => existing[k] === call[k])) return false;
  await ctx.db.replace("liveCalls", existing._id, call);
  return true;
}

async function writeCounts(ctx: MutationCtx, restaurantId: number, next: Counts): Promise<boolean> {
  const existing = await ctx.db
    .query("liveCounts")
    .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
    .unique();
  const doc = { restaurantId, ...next, updatedAt: Date.now() };
  if (!existing) {
    await ctx.db.insert("liveCounts", doc);
    return true;
  }
  const key = (c: Counts) => JSON.stringify([c.total, c.sections, c.byContext, c.bySupplier]);
  if (key(existing) === key(next)) return false;
  await ctx.db.replace("liveCounts", existing._id, doc);
  return true;
}

async function bumpTopics(ctx: MutationCtx, restaurantId: number, topics: Topic[]) {
  const now = Date.now();
  for (const topic of new Set(topics)) {
    const existing = await ctx.db
      .query("liveTopics")
      .withIndex("by_restaurant_topic", (q) => q.eq("restaurantId", restaurantId).eq("topic", topic))
      .unique();
    if (existing) await ctx.db.patch("liveTopics", existing._id, { version: existing.version + 1, updatedAt: now });
    else await ctx.db.insert("liveTopics", { restaurantId, topic, version: 1, updatedAt: now });
  }
}

// ---------------------------------------------------------------------
// Mutations (server only: all check the secret)
// ---------------------------------------------------------------------

export const upsertCall = mutation({
  args: { secret: v.string(), call: callValidator },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    return await writeCall(ctx, args.call); // true if it changed
  },
});

export const setCounts = mutation({
  args: { secret: v.string(), restaurantId: v.number(), counts: countsValidator },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    return await writeCounts(ctx, args.restaurantId, args.counts); // true if it changed
  },
});

export const upsertAction = mutation({
  args: { secret: v.string(), action: v.object(liveActionFields) },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    const existing = await ctx.db
      .query("liveActions")
      .withIndex("by_restaurant_and_actionId", (q) => q.eq("restaurantId", args.action.restaurantId).eq("actionId", args.action.actionId))
      .unique();
    if (!existing) await ctx.db.insert("liveActions", args.action);
    else if (existing.status !== args.action.status) await ctx.db.replace("liveActions", existing._id, args.action);
    return null;
  },
});

export const bump = mutation({
  args: { secret: v.string(), restaurantId: v.number(), topics: v.array(topicValidator) },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    await bumpTopics(ctx, args.restaurantId, args.topics);
    return null;
  },
});

// Starts over from Supabase: the restaurant's live calls and counts are replaced, and every
// topic is bumped so open screens reload.
export const resync = mutation({
  args: { secret: v.string(), restaurantId: v.number(), calls: v.array(callValidator), counts: countsValidator },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    for await (const old of ctx.db.query("liveCalls").withIndex("by_restaurant_and_callId", (q) => q.eq("restaurantId", args.restaurantId))) {
      await ctx.db.delete("liveCalls", old._id);
    }
    for (const call of args.calls) await ctx.db.insert("liveCalls", call);
    await writeCounts(ctx, args.restaurantId, args.counts);
    await bumpTopics(ctx, args.restaurantId, [...TOPICS]);
    return null;
  },
});

// ---------------------------------------------------------------------
// Queries (what open screens subscribe to; no secret)
// ---------------------------------------------------------------------

const MAX_CALLS = 100;
const ACTIVE = ["approved", "calling", "needs_input"] as const;

const view = (d: Doc<"liveCalls">): LiveCall => ({
  callId: d.callId,
  restaurantId: d.restaurantId,
  contextType: d.contextType,
  contextId: d.contextId,
  supplierId: d.supplierId,
  status: d.status,
  progress: d.progress,
  question: d.question,
  outcome: d.outcome,
  stage: d.stage,
  updatedAt: d.updatedAt,
});

// The calls one panel shows: for a record (contextType + contextId), a kind of record
// (contextType), a supplier, or all of them, newest first. activeOnly: just the ones under way.
export const callsFor = query({
  args: {
    restaurantId: v.number(),
    contextType: v.optional(v.string()),
    contextId: v.optional(v.number()),
    supplierId: v.optional(v.number()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { restaurantId, contextType, contextId, supplierId } = args;
    let rows: Doc<"liveCalls">[] = [];
    if (args.activeOnly) {
      for (const status of ACTIVE) {
        rows.push(
          ...(await ctx.db
            .query("liveCalls")
            .withIndex("by_restaurant_status", (q) => q.eq("restaurantId", restaurantId).eq("status", status))
            .take(MAX_CALLS)),
        );
      }
    } else if (contextType !== undefined) {
      rows = await ctx.db
        .query("liveCalls")
        .withIndex("by_restaurant_and_contextType_and_contextId_and_callId", (q) => {
          const byType = q.eq("restaurantId", restaurantId).eq("contextType", contextType);
          return contextId !== undefined ? byType.eq("contextId", contextId) : byType;
        })
        .order("desc")
        .take(MAX_CALLS);
    } else if (supplierId !== undefined) {
      rows = await ctx.db
        .query("liveCalls")
        .withIndex("by_restaurant_and_supplierId_and_callId", (q) => q.eq("restaurantId", restaurantId).eq("supplierId", supplierId))
        .order("desc")
        .take(MAX_CALLS);
    } else {
      rows = await ctx.db
        .query("liveCalls")
        .withIndex("by_restaurant_and_callId", (q) => q.eq("restaurantId", restaurantId))
        .order("desc")
        .take(MAX_CALLS);
    }
    return rows.map(view);
  },
});

// The sidebar badges (PendingCounts), or null before the first sync.
export const counts = query({
  args: { restaurantId: v.number() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("liveCounts")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
      .unique();
    if (!doc) return null;
    return { total: doc.total, sections: doc.sections, byContext: doc.byContext, bySupplier: doc.bySupplier, updatedAt: doc.updatedAt };
  },
});

// The status of these action cards ({ "12": "running" }). An action not mirrored yet is left out.
export const actionStatuses = query({
  args: { restaurantId: v.number(), actionIds: v.array(v.number()) },
  handler: async (ctx, args) => {
    const out: Record<string, Doc<"liveActions">["status"]> = {};
    for (const actionId of new Set(args.actionIds.slice(0, 50))) {
      const doc = await ctx.db
        .query("liveActions")
        .withIndex("by_restaurant_and_actionId", (q) => q.eq("restaurantId", args.restaurantId).eq("actionId", actionId))
        .unique();
      if (doc) out[String(actionId)] = doc.status;
    }
    return out;
  },
});

// { inventory: 12, attention: 40 }. A topic that was never bumped is 0.
export const topicVersions = query({
  args: { restaurantId: v.number(), topics: v.array(topicValidator) },
  handler: async (ctx, args) => {
    const versions: Partial<Record<Topic, number>> = {};
    for (const topic of new Set(args.topics)) {
      const doc = await ctx.db
        .query("liveTopics")
        .withIndex("by_restaurant_topic", (q) => q.eq("restaurantId", args.restaurantId).eq("topic", topic))
        .unique();
      versions[topic] = doc?.version ?? 0;
    }
    return versions;
  },
});
