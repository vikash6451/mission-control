import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const CLAIM_TTL_MS = 45 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function actorId(ctx: { auth: { getUserIdentity: () => Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  return (identity?.email ?? identity?.subject ?? identity?.name ?? "unknown-actor") as string;
}

function priorityRank(p: "low" | "medium" | "high") {
  return p === "high" ? 3 : p === "medium" ? 2 : 1;
}

function normalize(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function subjectKeyFromText(text: string) {
  const t = normalize(text).replace(/[^a-z0-9\s]/g, "");
  return t.split(" ").slice(0, 6).join(" ") || "general";
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "when", "where", "which", "who", "why", "how", "are", "was", "were", "will", "have", "has", "had", "into", "over", "under", "about", "after", "before", "every"
]);

const TOKEN_CANON: Record<string, string> = {
  moved: "move",
  moving: "move",
  change: "update",
  changed: "update",
  changes: "update",
  updated: "update",
  update: "update",
  recently: "recent",
  latest: "recent",
  new: "recent",
  review: "review",
  reviews: "review",
};

function stemToken(token: string) {
  if (token.length <= 4) return token;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokenize(text: string) {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !STOPWORDS.has(x))
    .map((x) => TOKEN_CANON[x] ?? TOKEN_CANON[stemToken(x)] ?? stemToken(x));
}

function jaccard(a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = new Set([...sa, ...sb]).size || 1;
  return inter / union;
}

function overlapCoefficient(a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / Math.min(sa.size, sb.size);
}

function recencyScore(ts: number) {
  const age = Math.max(0, Date.now() - ts);
  return Math.exp(-age / (14 * DAY_MS));
}

function contradictionHeuristic(a: string, b: string) {
  const x = normalize(a);
  const y = normalize(b);
  const overlap = jaccard(tokenize(x), tokenize(y));
  const negA = /\b(not|never|no|false|incorrect|fails?)\b/.test(x);
  const negB = /\b(not|never|no|false|incorrect|fails?)\b/.test(y);
  return overlap > 0.55 && negA !== negB;
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
  await ctx.db.insert("auditLog", { actor, action, entity, entityId, lane, details, at: Date.now() });
}

async function writeEvent(ctx: any, actor: string, type: string, taskId?: any, lane?: string, details?: string) {
  await ctx.db.insert("events", { taskId, lane, actor, type, details, at: Date.now() });
}

async function upsertMemory(ctx: any, actor: string, input: any) {
  const now = Date.now();
  const scope = input.scope || "global";
  const content = (input.content || "").trim();
  if (!content) throw new Error("content is required");

  const fingerprint = normalize(content);
  const subjectKey = input.subjectKey?.trim() || subjectKeyFromText(content);

  const dupes = await ctx.db.query("memories").withIndex("by_fingerprint", (q: any) => q.eq("fingerprint", fingerprint)).collect();
  const sameScopeDup = dupes.find((m: any) => m.scope === scope && m.status === "active");
  if (sameScopeDup) {
    await ctx.db.patch(sameScopeDup._id, {
      updatedAt: now,
      importance: Math.max(sameScopeDup.importance ?? 0.5, input.importance ?? 0.5),
      reliability: Math.max(sameScopeDup.reliability ?? 0.5, input.reliability ?? 0.6),
    });
    await writeAudit(ctx, "memory_duplicate", "memory", sameScopeDup._id, scope, "duplicate detected");
    await writeEvent(ctx, actor, "memory_duplicate", undefined, scope, content.slice(0, 160));
    return { memoryId: sameScopeDup._id, state: "duplicate" as const };
  }

  const existingSubject = await ctx.db
    .query("memories")
    .withIndex("by_subject", (q: any) => q.eq("scope", scope).eq("subjectKey", subjectKey))
    .collect();

  const activePeer = existingSubject.find((m: any) => m.status === "active");

  let supersedesMemoryId = input.supersedesMemoryId;
  let contradictionWithMemoryId = undefined;

  if (!supersedesMemoryId && activePeer) {
    if (contradictionHeuristic(activePeer.content, content)) {
      supersedesMemoryId = activePeer._id;
      contradictionWithMemoryId = activePeer._id;
    }
  }

  if (supersedesMemoryId) {
    const prev = await ctx.db.get(supersedesMemoryId);
    if (prev && prev.status === "active") {
      await ctx.db.patch(prev._id, { status: "superseded", updatedAt: now });
      await ctx.db.insert("memory_edges", {
        scope,
        fromMemoryId: input.sourceTaskId ? supersedesMemoryId : prev._id,
        toMemoryId: prev._id,
        relationType: "contradicts",
        weight: 0.8,
        createdAt: now,
      });
    }
  }

  const memoryId = await ctx.db.insert("memories", {
    scope,
    subjectKey,
    content,
    fingerprint,
    status: "active",
    supersedesMemoryId,
    contradictionWithMemoryId,
    sourceTaskId: input.sourceTaskId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    tags: input.tags,
    importance: input.importance ?? 0.5,
    reliability: input.reliability ?? 0.6,
    recallCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (supersedesMemoryId) {
    await ctx.db.insert("memory_edges", {
      scope,
      fromMemoryId: memoryId,
      toMemoryId: supersedesMemoryId,
      relationType: contradictionWithMemoryId ? "contradicts" : "derived_from",
      weight: contradictionWithMemoryId ? 0.8 : 0.6,
      createdAt: now,
    });
  }

  await writeAudit(ctx, "remember", "memory", memoryId, scope, content.slice(0, 160));
  await writeEvent(ctx, actor, "memory_saved", undefined, scope, content.slice(0, 160));

  return { memoryId, state: supersedesMemoryId ? "superseded_previous" : "created" };
}

export const releaseExpiredClaims = mutation({
  args: { lane: v.optional(v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops"))) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inProg = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "in_progress")).collect();
    let released = 0;
    for (const t of inProg) {
      if (args.lane && t.lane !== args.lane) continue;
      if (t.claimExpiresAt && t.claimExpiresAt < now) {
        await ctx.db.patch(t._id, { status: "backlog", ownerAgent: undefined, claimExpiresAt: undefined, updatedAt: now });
        released += 1;
        await writeEvent(ctx, "system", "claim_released", t._id, t.lane, "TTL expired");
      }
    }
    return { ok: true, released };
  },
});

export const listTasks = query({
  args: {
    lane: v.optional(v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops"))),
    status: v.optional(v.union(v.literal("backlog"), v.literal("in_progress"), v.literal("review"), v.literal("done"))),
  },
  handler: async (ctx, args) => {
    if (args.lane && args.status) return await ctx.db.query("tasks").withIndex("by_lane_status", (q) => q.eq("lane", args.lane!).eq("status", args.status!)).collect();
    if (args.lane) return await ctx.db.query("tasks").withIndex("by_lane", (q) => q.eq("lane", args.lane!)).collect();
    if (args.status) return await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", args.status!)).collect();
    return await ctx.db.query("tasks").collect();
  },
});

export const createTask = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    acceptanceCriteria: v.string(),
    outputFormat: v.string(),
    minSources: v.optional(v.number()),
    requireCounterpoints: v.optional(v.boolean()),
    dueAt: v.optional(v.number()),
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
      acceptanceCriteria: args.acceptanceCriteria,
      outputFormat: args.outputFormat,
      minSources: args.minSources ?? 3,
      requireCounterpoints: args.requireCounterpoints ?? true,
      dueAt: args.dueAt,
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
  args: { lane: v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops")), agent: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inProg = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "in_progress")).collect();
    for (const t of inProg) {
      if (t.lane === args.lane && t.claimExpiresAt && t.claimExpiresAt < now) {
        await ctx.db.patch(t._id, { status: "backlog", ownerAgent: undefined, claimExpiresAt: undefined, updatedAt: now });
        await writeEvent(ctx, "system", "claim_released", t._id, t.lane, "TTL expired");
      }
    }

    const backlog = await ctx.db.query("tasks").withIndex("by_lane_status", (q) => q.eq("lane", args.lane).eq("status", "backlog")).collect();
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
      claimExpiresAt: now + CLAIM_TTL_MS,
      updatedAt: now,
    });

    await writeAudit(ctx, "claim_task", "task", task._id, task.lane, `${args.agent} claimed`);
    await writeEvent(ctx, args.agent, "task_claimed", task._id, task.lane, task.title);

    return { ok: true, task: { ...task, status: "in_progress", ownerAgent: args.agent, claimExpiresAt: now + CLAIM_TTL_MS } };
  },
});

export const updateTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(v.literal("backlog"), v.literal("in_progress"), v.literal("review"), v.literal("done")),
    ownerAgent: v.optional(v.string()),
    notes: v.optional(v.string()),
    resultLinks: v.optional(v.array(v.string())),
    actorAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const actor = (await actorId(ctx)) || "unknown-actor";
    const agent = args.actorAgent ?? actor;
    if (args.status === "done" && agent !== "main-orchestrator") throw new Error("Only main-orchestrator can move a task to done");

    await ctx.db.patch(args.taskId, {
      status: args.status,
      ownerAgent: args.ownerAgent ?? task.ownerAgent,
      notes: args.notes ?? task.notes,
      claimExpiresAt: args.status === "in_progress" ? task.claimExpiresAt : undefined,
      resultLinks: args.resultLinks ?? task.resultLinks,
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
    resultLinks: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    const id = await ctx.db.insert("comments", {
      taskId: args.taskId,
      authorAgent: args.authorAgent,
      body: args.body,
      kind: args.kind,
      resultLinks: args.resultLinks,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, "add_comment", "comment", id, task.lane, args.kind ?? "note");
    await writeEvent(ctx, args.authorAgent, "task_commented", task._id, task.lane, args.kind ?? "note");
    return id;
  },
});

export const markTaskBlocked = mutation({
  args: {
    taskId: v.id("tasks"),
    actorAgent: v.string(),
    blockerReason: v.string(),
    handoffToAgent: v.optional(v.string()),
    handoffToLane: v.optional(v.union(v.literal("research"), v.literal("finance"), v.literal("sports"), v.literal("ops"))),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    await ctx.db.patch(args.taskId, {
      status: "review",
      notes: `BLOCKED: ${args.blockerReason}`,
      claimExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    const commentId = await ctx.db.insert("comments", {
      taskId: args.taskId,
      authorAgent: args.actorAgent,
      body: args.blockerReason,
      kind: "blocker",
      createdAt: Date.now(),
    });
    await writeAudit(ctx, "add_comment", "comment", commentId, task.lane, "blocker");

    if (args.handoffToAgent && args.handoffToLane) {
      await ctx.runMutation((exports as any).createHandoff, {
        taskId: args.taskId,
        fromAgent: args.actorAgent,
        toAgent: args.handoffToAgent,
        fromLane: task.lane,
        toLane: args.handoffToLane,
        summary: `Blocked: ${task.title}`,
        context: args.blockerReason,
        status: "queued",
      });
    }

    await writeEvent(ctx, args.actorAgent, "task_blocked", task._id, task.lane, args.blockerReason);
    return { ok: true };
  },
});

export const listTaskComments = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => await ctx.db.query("comments").withIndex("by_task", (q) => q.eq("taskId", args.taskId)).collect(),
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

export const remember = mutation({
  args: {
    scope: v.string(),
    content: v.string(),
    subjectKey: v.optional(v.string()),
    sourceTaskId: v.optional(v.id("tasks")),
    sourceType: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
    reliability: v.optional(v.number()),
    supersedesMemoryId: v.optional(v.id("memories")),
  },
  handler: async (ctx, args) => {
    const actor = await actorId(ctx);
    return await upsertMemory(ctx, actor, args);
  },
});

export const extractAndRemember = mutation({
  args: {
    scope: v.string(),
    text: v.string(),
    sourceTaskId: v.optional(v.id("tasks")),
    sourceType: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    importance: v.optional(v.number()),
    reliability: v.optional(v.number()),
    maxItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await actorId(ctx);
    const bits = args.text
      .split(/\n|\. |; /)
      .map((x) => x.trim())
      .filter((x) => x.length > 24)
      .slice(0, args.maxItems ?? 8);

    const saved = [] as any[];
    for (const content of bits) {
      const r = await upsertMemory(ctx, actor, {
        scope: args.scope,
        content,
        sourceTaskId: args.sourceTaskId,
        sourceType: args.sourceType ?? "extract",
        sourceRef: args.sourceRef,
        importance: args.importance,
        reliability: args.reliability,
      });
      saved.push(r);
    }

    await writeEvent(ctx, actor, "memory_extract_completed", args.sourceTaskId, args.scope, `saved=${saved.length}`);
    return { ok: true, extracted: bits.length, saved };
  },
});

export const recall = mutation({
  args: { query: v.string(), scope: v.string(), topK: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await actorId(ctx);
    const topK = Math.min(20, Math.max(1, args.topK ?? 5));
    const queryTokens = tokenize(args.query);

    const candidates = await ctx.db
      .query("memories")
      .withIndex("by_scope_status", (q: any) => q.eq("scope", args.scope).eq("status", "active"))
      .collect();

    const scored = candidates.map((m: any) => {
      const contentTokens = tokenize(m.content);
      const simJ = jaccard(queryTokens, contentTokens);
      const simOverlap = overlapCoefficient(queryTokens, contentTokens);
      const sim = Math.max(simJ, 0.85 * simOverlap);
      const rec = recencyScore(m.updatedAt || m.createdAt);
      const imp = Math.max(0, Math.min(1, m.importance ?? 0.5));
      const rel = Math.max(0, Math.min(1, m.reliability ?? 0.6));
      const score = 0.5 * sim + 0.2 * rec + 0.18 * imp + 0.12 * rel;
      return {
        ...m,
        score,
        scoreParts: { similarity: sim, jaccard: simJ, overlap: simOverlap, recency: rec, importance: imp, reliability: rel },
      };
    });

    scored.sort((a: any, b: any) => b.score - a.score);
    const selected = scored.slice(0, topK);

    const topScore = selected[0]?.score ?? 0;
    const secondScore = selected[1]?.score ?? 0;
    const margin = topScore - secondScore;

    let confidenceBand: "high" | "medium" | "low" = "low";
    if (topScore >= 0.7 && margin >= 0.1) confidenceBand = "high";
    else if (topScore >= 0.45) confidenceBand = "medium";

    const evidenceGaps: string[] = [];
    if (selected.length < Math.min(3, topK)) evidenceGaps.push("Low memory coverage for this scope/query");
    const avgRel = selected.length ? selected.reduce((a: number, m: any) => a + (m.reliability ?? 0.6), 0) / selected.length : 0;
    if (avgRel < 0.55) evidenceGaps.push("Low reliability in top recalled memories");
    const hasRecent = selected.some((m: any) => Date.now() - (m.updatedAt || m.createdAt) < 30 * DAY_MS);
    if (!hasRecent) evidenceGaps.push("No recent memory evidence in top recalls");

    const requiresReview = confidenceBand === "low" || evidenceGaps.length >= 2;

    for (const m of selected) {
      await ctx.db.patch(m._id, {
        recallCount: (m.recallCount ?? 0) + 1,
        lastRecalledAt: Date.now(),
        updatedAt: m.updatedAt,
      });
    }

    const logId = await ctx.db.insert("memory_recall_logs", {
      query: args.query,
      scope: args.scope,
      topK,
      resultMemoryIds: selected.map((m: any) => m._id),
      scores: selected.map((m: any) => m.score),
      confidenceBand,
      evidenceGaps,
      reusedCount: selected.length,
      requiresReview,
      actor,
      tokenCostProxy: args.query.length,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, "recall", "memory_recall_log", logId, args.scope, `${confidenceBand} (${selected.length})`);
    await writeEvent(ctx, actor, "memory_recall", undefined, args.scope, `confidence=${confidenceBand}`);

    return {
      ok: true,
      recallLogId: logId,
      confidenceBand,
      requiresReview,
      evidence_gaps: evidenceGaps,
      memories: selected.map((m: any) => ({
        _id: m._id,
        content: m.content,
        subjectKey: m.subjectKey,
        score: Number(m.score.toFixed(4)),
        scoreParts: m.scoreParts,
        importance: m.importance ?? 0.5,
        reliability: m.reliability ?? 0.6,
        updatedAt: m.updatedAt,
      })),
    };
  },
});

export const forget = mutation({
  args: {
    scope: v.optional(v.string()),
    memoryIds: v.optional(v.array(v.id("memories"))),
    olderThanMs: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await actorId(ctx);
    const now = Date.now();

    let targets: any[] = [];
    if (args.memoryIds?.length) {
      for (const id of args.memoryIds) {
        const m = await ctx.db.get(id);
        if (m) targets.push(m);
      }
    } else if (args.scope) {
      targets = await ctx.db.query("memories").withIndex("by_scope", (q: any) => q.eq("scope", args.scope!)).collect();
    } else {
      throw new Error("forget requires scope or memoryIds");
    }

    if (args.olderThanMs) targets = targets.filter((m) => now - (m.updatedAt || m.createdAt) >= args.olderThanMs!);

    let staleCount = 0;
    for (const m of targets) {
      if (m.status !== "stale") {
        await ctx.db.patch(m._id, { status: "stale", updatedAt: now });
        staleCount += 1;
      }
    }

    await writeEvent(ctx, actor, "memory_forget", undefined, args.scope, `stale=${staleCount}`);
    await writeAudit(ctx, "forget", "memory", args.scope ?? "targeted", args.scope, args.reason ?? `stale=${staleCount}`);
    return { ok: true, staleCount };
  },
});

export const memoryTree = query({
  args: { scope: v.string() },
  handler: async (ctx, args) => {
    const memories = await ctx.db.query("memories").withIndex("by_scope", (q: any) => q.eq("scope", args.scope)).collect();
    const edges = await ctx.db.query("memory_edges").withIndex("by_scope", (q: any) => q.eq("scope", args.scope)).collect();

    const nodeMap = new Map(memories.map((m: any) => [String(m._id), { ...m, children: [] as any[] }]));
    const hasParent = new Set<string>();

    for (const e of edges) {
      const from = nodeMap.get(String(e.fromMemoryId));
      const to = nodeMap.get(String(e.toMemoryId));
      if (from && to) {
        from.children.push({ relationType: e.relationType, weight: e.weight ?? 0.5, node: to });
        hasParent.add(String(e.toMemoryId));
      }
    }

    const roots = [...nodeMap.values()].filter((n: any) => !hasParent.has(String(n._id)));
    return { ok: true, scope: args.scope, roots, memoryCount: memories.length, edgeCount: edges.length };
  },
});

export const memoryStats = query({
  args: { scope: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = args.scope;
    const memories = scope
      ? await ctx.db.query("memories").withIndex("by_scope", (q: any) => q.eq("scope", scope)).collect()
      : await ctx.db.query("memories").collect();

    const recalls = scope
      ? await ctx.db.query("memory_recall_logs").withIndex("by_scope", (q: any) => q.eq("scope", scope)).collect()
      : await ctx.db.query("memory_recall_logs").collect();

    const byStatus = {
      active: memories.filter((m: any) => m.status === "active").length,
      superseded: memories.filter((m: any) => m.status === "superseded").length,
      stale: memories.filter((m: any) => m.status === "stale").length,
    };

    const recentConflicts = memories
      .filter((m: any) => !!m.contradictionWithMemoryId)
      .sort((a: any, b: any) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 20);

    return {
      ok: true,
      totals: { memories: memories.length, recalls: recalls.length },
      byStatus,
      recentConflicts,
    };
  },
});

export const memoryMetrics = query({
  args: { scope: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = args.scope;
    const recalls = scope
      ? await ctx.db.query("memory_recall_logs").withIndex("by_scope", (q: any) => q.eq("scope", scope)).collect()
      : await ctx.db.query("memory_recall_logs").collect();

    const memories = scope
      ? await ctx.db.query("memories").withIndex("by_scope", (q: any) => q.eq("scope", scope)).collect()
      : await ctx.db.query("memories").collect();

    const conflicts = memories.filter((m: any) => !!m.contradictionWithMemoryId).length;
    const rejected = recalls.filter((r: any) => r.reviewOutcome === "rejected").length;
    const needsReview = recalls.filter((r: any) => r.requiresReview).length;
    const resolved = recalls.filter((r: any) => !!r.reviewedAt).length;

    const avgTimeToReviewMs = (() => {
      const times = recalls.filter((r: any) => r.reviewedAt).map((r: any) => r.reviewedAt - r.createdAt).filter((x: number) => x >= 0);
      if (!times.length) return null;
      return Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length);
    })();

    const totalReused = recalls.reduce((a: number, r: any) => a + (r.reusedCount ?? 0), 0);
    const totalTokenProxy = recalls.reduce((a: number, r: any) => a + (r.tokenCostProxy ?? 0), 0);

    return {
      ok: true,
      scope: scope ?? "all",
      metrics: {
        recall_reuse_rate: recalls.length ? totalReused / recalls.length : 0,
        contradiction_resolution_count: conflicts,
        review_rejection_proxy: needsReview ? rejected / needsReview : 0,
        avg_time_to_review_ms_proxy: avgTimeToReviewMs,
        cost_token_proxy_total: totalTokenProxy,
        reviewed_count: resolved,
      },
      counts: { recalls: recalls.length, memories: memories.length },
    };
  },
});

export const reviewRecallLog = mutation({
  args: {
    recallLogId: v.id("memory_recall_logs"),
    outcome: v.union(v.literal("accepted"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const actor = await actorId(ctx);
    await ctx.db.patch(args.recallLogId, {
      reviewOutcome: args.outcome,
      reviewedAt: Date.now(),
    });
    await writeEvent(ctx, actor, "memory_recall_reviewed", undefined, undefined, `${args.recallLogId}:${args.outcome}`);
    await writeAudit(ctx, "review_recall", "memory_recall_log", args.recallLogId, undefined, args.outcome);
    return { ok: true };
  },
});
