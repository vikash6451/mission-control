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
      "access-control-allow-headers": "content-type",
    },
  });
}

http.route({
  path: "/mission-control/tasks",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "content-type" } })),
});

http.route({
  path: "/mission-control/tasks",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const lane = url.searchParams.get("lane") || undefined;
    const status = url.searchParams.get("status") || undefined;

    const tasks = await ctx.runQuery(api.missionControl.listTasks, {
      lane: lane as any,
      status: status as any,
    });

    return json({ tasks });
  }),
});

http.route({
  path: "/mission-control/tasks",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.title || !body?.lane) {
      return json({ error: "title and lane are required" }, 400);
    }

    const taskId = await ctx.runMutation(api.missionControl.createTask, {
      title: body.title,
      description: body.description,
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
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "content-type" } })),
});

http.route({
  path: "/mission-control/tasks/status",
  method: "PATCH",
  handler: httpAction(async (ctx, req) => {
    if (!isAdmin(req)) return json({ error: "admin key required" }, 401);
    const body = await req.json();
    if (!body?.taskId || !body?.status) {
      return json({ error: "taskId and status are required" }, 400);
    }

    const result = await ctx.runMutation(api.missionControl.updateTaskStatus, {
      taskId: body.taskId,
      status: body.status,
      ownerAgent: body.ownerAgent,
      notes: body.notes,
      actorAgent: body.actorAgent,
    });

    return json(result);
  }),
});

export default http;
