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

const memoryStatus = v.union(v.literal("active"), v.literal("superseded"), v.literal("stale"));

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

  memories: defineTable({
    scope: v.string(),
    subjectKey: v.string(),
    content: v.string(),
    fingerprint: v.string(),
    status: memoryStatus,
    supersedesMemoryId: v.optional(v.id("memories")),
    sourceTaskId: v.optional(v.id("tasks")),
    sourceType: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
    reliability: v.optional(v.number()),
    contradictionWithMemoryId: v.optional(v.id("memories")),
    recallCount: v.optional(v.number()),
    lastRecalledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope", ["scope"])
    .index("by_scope_status", ["scope", "status"])
    .index("by_fingerprint", ["fingerprint"])
    .index("by_subject", ["scope", "subjectKey"])
    .index("by_source_task", ["sourceTaskId"]),

  memory_edges: defineTable({
    scope: v.string(),
    fromMemoryId: v.id("memories"),
    toMemoryId: v.id("memories"),
    relationType: v.union(v.literal("supports"), v.literal("contradicts"), v.literal("derived_from"), v.literal("related")),
    weight: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_scope", ["scope"])
    .index("by_from", ["fromMemoryId"])
    .index("by_to", ["toMemoryId"]),

  memory_recall_logs: defineTable({
    query: v.string(),
    scope: v.string(),
    topK: v.number(),
    resultMemoryIds: v.array(v.id("memories")),
    scores: v.array(v.number()),
    confidenceBand: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    evidenceGaps: v.array(v.string()),
    reusedCount: v.number(),
    requiresReview: v.boolean(),
    actor: v.optional(v.string()),
    reviewOutcome: v.optional(v.union(v.literal("accepted"), v.literal("rejected"))),
    reviewedAt: v.optional(v.number()),
    tokenCostProxy: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_scope", ["scope"])
    .index("by_time", ["createdAt"])
    .index("by_confidence", ["confidenceBand"]),
});
