// What open screens can follow for changes. Imported by the Convex functions and by Next.js
// (the write routes bump these; <LiveRefresh> on each page listens to them).
import { v } from "convex/values";

export const TOPICS = ["overview", "inventory", "prep", "invoices", "suppliers", "menu", "calls", "attention", "actions"] as const;
export type Topic = (typeof TOPICS)[number];

export const topicValidator = v.union(
  v.literal("overview"),
  v.literal("inventory"),
  v.literal("prep"),
  v.literal("invoices"),
  v.literal("suppliers"),
  v.literal("menu"),
  v.literal("calls"),
  v.literal("attention"),
  v.literal("actions"),
);
