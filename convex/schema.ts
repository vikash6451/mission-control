import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    lane: v.union(
      v.literal("research"),
      v.literal("finance"),
      v.literal("sports"),
      v.literal("ops"),
    ),
    status: v.union(
      v.literal("backlog"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("done"),
    ),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    createdBy: v.string(),
    ownerAgent: v.optional(v.string()),
    contextPaths: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    verifiedBy: v.optional(v.string()),
  })
    .index("by_lane", ["lane"])
    .index("by_lane_status", ["lane", "status"])
    .index("by_status", ["status"]),

  handoffs: defineTable({
    taskId: v.optional(v.id("tasks")),
    fromAgent: v.string(),
    toAgent: v.string(),
    fromLane: v.union(
      v.literal("research"),
      v.literal("finance"),
      v.literal("sports"),
      v.literal("ops"),
    ),
    toLane: v.union(
      v.literal("research"),
      v.literal("finance"),
      v.literal("sports"),
      v.literal("ops"),
    ),
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
