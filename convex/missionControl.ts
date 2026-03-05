import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function actorId(ctx: { auth: { getUserIdentity: () => Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  return (identity?.email ?? identity?.subject ?? identity?.name ?? "unknown-actor") as string;
}

function priorityRank(p: "low" | "medium" | "high") {
  return p === "high" ? 3 : p === "medium" ? 2 : 1;
}

async function writeAudit(
  ctx: any,
  action: string,
  entity: string,
  entityId: string,
  lane?: string,
  details?: string,
) {
  const actor = await actorId(ctx);
  await ctx.db.insert("auditLog", {
    actor,
    action,
    entity,
    entityId,
    lane,
    details,
    at: Date.now(),
  });
}

async function writeEvent(ctx: any, actor: string, type: string, taskId?: any, lane?: string, details?: string) {
  await ctx.db.insert("events", {
    taskId,
    lane,
    actor,
    type,
    details,
    at: Date.now(),
  });
}

export const listTasks = query({
  args: {
    lane: v.optional(v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops"))),
    status: v.optional(v.union(v.literal("backlog"), v.literal("in_progress"), v.literal("review"), v.literal("done"))),
  },
  handler: async (ctx, args) => {
    if (args.lane && args.status) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_lane_status", (q) => q.eq("lane", args.lane!).eq("status", args.status!))
        .collect();
    }
    if (args.lane) return await ctx.db.query("tasks").withIndex("by_lane", (q) => q.eq("lane", args.lane!)).collect();
    if (args.status) return await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", args.status!)).collect();
    return await ctx.db.query("tasks").collect();
  },
});

export const createTask = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    lane: v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops")),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    ownerAgent: v.optional(v.string()),
    contextPaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const actor = await actorId(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      lane: args.lane,
      status: "backlog",
      priority: args.priority ?? "medium",
      createdBy: actor,
      ownerAgent: args.ownerAgent,
      contextPaths: args.contextPaths,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, "create_task", "task", id, args.lane, args.title);
    await writeEvent(ctx, actor, "task_created", id, args.lane, args.title);
    return id;
  },
});

export const claimNextTask = mutation({
  args: {
    lane: v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops")),
    agent: v.string(),
  },
  handler: async (ctx, args) => {
    const backlog = await ctx.db
      .query("tasks")
      .withIndex("by_lane_status", (q) => q.eq("lane", args.lane).eq("status", "backlog"))
      .collect();

    if (!backlog.length) return { ok: true, task: null };

    backlog.sort((a, b) => {
      const p = priorityRank(b.priority) - priorityRank(a.priority);
      if (p !== 0) return p;
      return a.createdAt - b.createdAt;
    });

    const task = backlog[0];
    await ctx.db.patch(task._id, {
      status: "in_progress",
      ownerAgent: args.agent,
      updatedAt: Date.now(),
    });

    await writeAudit(ctx, "claim_task", "task", task._id, task.lane, `${args.agent} claimed`);
    await writeEvent(ctx, args.agent, "task_claimed", task._id, task.lane, task.title);

    return { ok: true, task: { ...task, status: "in_progress", ownerAgent: args.agent } };
  },
});

export const updateTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(v.literal("backlog"), v.literal("in_progress"), v.literal("review"), v.literal("done")),
    ownerAgent: v.optional(v.string()),
    notes: v.optional(v.string()),
    actorAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const actor = (await actorId(ctx)) || "unknown-actor";
    const agent = args.actorAgent ?? actor;

    if (args.status === "done" && agent !== "main-orchestrator") {
      throw new Error("Only main-orchestrator can move a task to done");
    }

    await ctx.db.patch(args.taskId, {
      status: args.status,
      ownerAgent: args.ownerAgent ?? task.ownerAgent,
      notes: args.notes ?? task.notes,
      updatedAt: Date.now(),
      verifiedBy: args.status === "done" ? agent : task.verifiedBy,
    });

    await writeAudit(ctx, "update_task_status", "task", args.taskId, task.lane, `${task.status} -> ${args.status} by ${agent}`);
    await writeEvent(ctx, agent, "task_status_changed", task._id, task.lane, `${task.status} -> ${args.status}`);
    return { ok: true };
  },
});

export const addTaskComment = mutation({
  args: {
    taskId: v.id("tasks"),
    authorAgent: v.string(),
    body: v.string(),
    kind: v.optional(v.union(v.literal("progress"), v.literal("result"), v.literal("blocker"), v.literal("note"))),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const id = await ctx.db.insert("comments", {
      taskId: args.taskId,
      authorAgent: args.authorAgent,
      body: args.body,
      kind: args.kind,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, "add_comment", "comment", id, task.lane, args.kind ?? "note");
    await writeEvent(ctx, args.authorAgent, "task_commented", task._id, task.lane, args.kind ?? "note");
    return id;
  },
});

export const listTaskComments = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.query("comments").withIndex("by_task", (q) => q.eq("taskId", args.taskId)).collect();
  },
});

export const createHandoff = mutation({
  args: {
    taskId: v.optional(v.id("tasks")),
    fromAgent: v.string(),
    toAgent: v.string(),
    fromLane: v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops")),
    toLane: v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops")),
    summary: v.string(),
    context: v.optional(v.string()),
    status: v.optional(v.union(v.literal("queued"), v.literal("done"), v.literal("blocked"))),
  },
  handler: async (ctx, args) => {
    if (args.fromLane === args.toLane) throw new Error("Handoff lane must be different");
    const now = Date.now();
    const id = await ctx.db.insert("handoffs", {
      taskId: args.taskId,
      fromAgent: args.fromAgent,
      toAgent: args.toAgent,
      fromLane: args.fromLane,
      toLane: args.toLane,
      summary: args.summary,
      context: args.context,
      status: args.status ?? "queued",
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, "create_handoff", "handoff", id, `${args.fromLane}->${args.toLane}`, args.summary);
    await writeEvent(ctx, args.fromAgent, "handoff_created", args.taskId, `${args.fromLane}->${args.toLane}`, args.summary);
    return id;
  },
});

export const listHandoffs = query({
  args: { status: v.optional(v.union(v.literal("queued"), v.literal("done"), v.literal("blocked"))) },
  handler: async (ctx, args) => {
    if (!args.status) return await ctx.db.query("handoffs").collect();
    return await ctx.db.query("handoffs").withIndex("by_status", (q) => q.eq("status", args.status!)).collect();
  },
});
