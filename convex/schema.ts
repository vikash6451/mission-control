import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const lane = v.union(
  v.literal("research"),
  v.literal("finance"),
  v.literal("sports"),
  v.literal("ops"),
);

const status = v.union(
  v.literal("backlog"),
  v.literal("in_progress"),
  v.literal("review"),
  v.literal("done"),
);

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    description: v.string(),
    acceptanceCriteria: v.string(),
    outputFormat: v.string(),
    minSources: v.optional(v.number()),
    requireCounterpoints: v.optional(v.boolean()),
    dueAt: v.optional(v.number()),
    lane,
    status,
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    createdBy: v.string(),
    ownerAgent: v.optional(v.string()),
    claimExpiresAt: v.optional(v.number()),
    resultLinks: v.optional(v.array(v.string())),
    contextPaths: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    verifiedBy: v.optional(v.string()),
  })
    .index("by_lane", ["lane"])
    .index("by_lane_status", ["lane", "status"])
    .index("by_status", ["status"]),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorAgent: v.string(),
    body: v.string(),
    kind: v.optional(v.union(v.literal("progress"), v.literal("result"), v.literal("blocker"), v.literal("note"))),
    resultLinks: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index("by_task", ["taskId"]),

  events: defineTable({
    taskId: v.optional(v.id("tasks")),
    lane: v.optional(v.string()),
    actor: v.string(),
    type: v.string(),
    details: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_time", ["at"]),

  handoffs: defineTable({
    taskId: v.optional(v.id("tasks")),
    fromAgent: v.string(),
    toAgent: v.string(),
    fromLane: lane,
    toLane: lane,
    summary: v.string(),
    context: v.optional(v.string()),
    status: v.union(v.literal("queued"), v.literal("done"), v.literal("blocked")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  auditLog: defineTable({
    actor: v.string(),
    action: v.string(),
    entity: v.string(),
    entityId: v.string(),
    lane: v.optional(v.string()),
    details: v.optional(v.string()),
    at: v.number(),
  }).index("by_entity", ["entity", "entityId"]),
});
