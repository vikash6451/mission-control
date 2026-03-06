import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

function getAdminKey() {
  return process.env.MISSION_CONTROL_ADMIN_KEY ?? "CHANGE_ME_LOCAL_ADMIN_KEY";
}

function isAdmin(req: Request) {
  const key = getAdminKey();
  const provided = req.headers.get("x-admin-key");
  return !!key && !!provided && key === provided;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      "access-control-allow-headers": "content-type, x-admin-key",
    },
  });
}

function optionsHandler() {
  return httpAction(async () =>
    new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-allow-headers": "content-type, x-admin-key",
      },
    }),
  );
}

const optionPaths = [
  "/mission-control/tasks",
  "/mission-control/tasks/status",
  "/mission-control/tasks/claim",
  "/mission-control/tasks/comment",
  "/mission-control/tasks/blocked",
  "/mission-control/memory/remember",
  "/mission-control/memory/extract",
  "/mission-control/memory/recall",
  "/mission-control/memory/forget",
  "/mission-control/memory/tree",
  "/mission-control/memory/stats",
  "/mission-control/memory/metrics",
  "/mission-control/memory/recall/review",
];
for (const p of optionPaths) http.route({ path: p, method: "OPTIONS", handler: optionsHandler() });

http.route({
  path: "/mission-control/tasks",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const lane = url.searchParams.get("lane") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const tasks = await ctx.runQuery(api.missionControl.listTasks, { lane: lane as any, status: status as any });
    return json({ tasks });
  }),
});

http.route({
  path: "/mission-control/tasks",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.title || !body?.lane || !body?.description || !body?.acceptanceCriteria || !body?.outputFormat) {
      return json({ error: "title, lane, description, acceptanceCriteria, outputFormat are required" }, 400);
    }
    const taskId = await ctx.runMutation(api.missionControl.createTask, {
      title: body.title,
      description: body.description,
      acceptanceCriteria: body.acceptanceCriteria,
      outputFormat: body.outputFormat,
      minSources: body.minSources,
      requireCounterpoints: body.requireCounterpoints,
      dueAt: body.dueAt,
      lane: body.lane,
      priority: body.priority,
      ownerAgent: body.ownerAgent,
      contextPaths: body.contextPaths,
    });
    return json({ ok: true, taskId });
  }),
});

http.route({
  path: "/mission-control/tasks/status",
  method: "PATCH",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.taskId || !body?.status) return json({ error: "taskId and status are required" }, 400);
    const result = await ctx.runMutation(api.missionControl.updateTaskStatus, {
      taskId: body.taskId,
      status: body.status,
      ownerAgent: body.ownerAgent,
      notes: body.notes,
      resultLinks: body.resultLinks,
      actorAgent: body.actorAgent,
    });
    return json(result);
  }),
});

http.route({
  path: "/mission-control/tasks/claim",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.lane || !body?.agent) return json({ error: "lane and agent are required" }, 400);
    const result = await ctx.runMutation(api.missionControl.claimNextTask, {
      lane: body.lane,
      agent: body.agent,
    });
    return json(result);
  }),
});

http.route({
  path: "/mission-control/tasks/comment",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.taskId || !body?.authorAgent || !body?.body) {
      return json({ error: "taskId, authorAgent, body are required" }, 400);
    }
    const commentId = await ctx.runMutation(api.missionControl.addTaskComment, {
      taskId: body.taskId,
      authorAgent: body.authorAgent,
      body: body.body,
      kind: body.kind,
      resultLinks: body.resultLinks,
    });
    return json({ ok: true, commentId });
  }),
});

http.route({
  path: "/mission-control/tasks/blocked",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.taskId || !body?.actorAgent || !body?.blockerReason) {
      return json({ error: "taskId, actorAgent, blockerReason are required" }, 400);
    }
    const result = await ctx.runMutation(api.missionControl.markTaskBlocked, {
      taskId: body.taskId,
      actorAgent: body.actorAgent,
      blockerReason: body.blockerReason,
      handoffToAgent: body.handoffToAgent,
      handoffToLane: body.handoffToLane,
    });
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/remember",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.scope || !body?.content) return json({ error: "scope and content are required" }, 400);
    const result = await ctx.runMutation(api.missionControl.remember, body as any);
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/extract",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.scope || !body?.text) return json({ error: "scope and text are required" }, 400);
    const result = await ctx.runMutation(api.missionControl.extractAndRemember, body as any);
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/recall",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.scope || !body?.query) return json({ error: "scope and query are required" }, 400);
    const result = await ctx.runMutation(api.missionControl.recall, body as any);
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/forget",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    const result = await ctx.runMutation(api.missionControl.forget, body as any);
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/tree",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") || "research";
    const result = await ctx.runQuery(api.missionControl.memoryTree, { scope });
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/stats",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") || undefined;
    const result = await ctx.runQuery(api.missionControl.memoryStats, { scope });
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/metrics",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") || undefined;
    const result = await ctx.runQuery(api.missionControl.memoryMetrics, { scope });
    return json(result);
  }),
});

http.route({
  path: "/mission-control/memory/recall/review",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.recallLogId || !body?.outcome) return json({ error: "recallLogId and outcome are required" }, 400);
    const result = await ctx.runMutation(api.missionControl.reviewRecallLog, body as any);
    return json(result);
  }),
});

export default http;
