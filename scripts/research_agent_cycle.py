#!/usr/bin/env python3
"""Research-agent pilot loop for Mission Control Lite.

Flow:
1) claim next research backlog task
2) post progress comment
3) produce placeholder output
4) post result comment with result links
5) move task to review

If required task contract fields are missing, mark task blocked.
"""

import json
import os
import sys
import textwrap
import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://brazen-fly-288.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")

if not ADMIN_KEY:
    print("ERROR: MISSION_CONTROL_ADMIN_KEY is required")
    sys.exit(1)

HEADERS = {"content-type": "application/json", "x-admin-key": ADMIN_KEY}


def post(path: str, payload: dict):
    r = requests.post(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} failed: {r.status_code} {r.text[:400]}")
    return r.json()


def patch(path: str, payload: dict):
    r = requests.patch(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} failed: {r.status_code} {r.text[:400]}")
    return r.json()


def run():
    claimed = post("/tasks/claim", {"lane": "research", "agent": "research-agent"})
    task = claimed.get("task")
    if not task:
        print("No research backlog task available")
        return

    task_id = task["_id"]
    title = task.get("title", "")
    desc = task.get("description", "")
    ac = task.get("acceptanceCriteria", "")
    outfmt = task.get("outputFormat", "")

    if not desc or not ac or not outfmt:
        post(
            "/tasks/blocked",
            {
                "taskId": task_id,
                "actorAgent": "research-agent",
                "blockerReason": "Task contract incomplete: description/acceptanceCriteria/outputFormat missing",
                "handoffToAgent": "main-orchestrator",
                "handoffToLane": "ops",
            },
        )
        print(json.dumps({"ok": False, "taskId": task_id, "blocked": True}))
        return

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "progress",
            "body": f"Picked up task: {title}",
        },
    )

    result_links = ["memory/lanes/research.md"]
    result = textwrap.dedent(
        f"""
        Research pilot execution complete.

        Task: {title}
        Description: {desc}
        Acceptance Criteria: {ac}
        Output Format: {outfmt}

        Next: replace this placeholder with actual research output + citations.
        """
    ).strip()

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "result",
            "body": result,
            "resultLinks": result_links,
        },
    )

    patch(
        "/tasks/status",
        {
            "taskId": task_id,
            "status": "review",
            "actorAgent": "research-agent",
            "notes": "Moved to review by research-agent pilot loop",
            "resultLinks": result_links,
        },
    )

    print(json.dumps({"ok": True, "taskId": task_id, "movedTo": "review", "resultLinks": result_links}))


if __name__ == "__main__":
    run()
