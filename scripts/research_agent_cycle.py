#!/usr/bin/env python3
"""Research-agent pilot loop for Mission Control Lite.

Flow:
1) claim next research backlog task
2) (placeholder) process task
3) post progress/result comment
4) move task to review

This script is intentionally thin and can be called from an agent heartbeat.
"""

import json
import os
import sys
import textwrap
import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://fabulous-dog-776.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")

if not ADMIN_KEY:
    print("ERROR: MISSION_CONTROL_ADMIN_KEY is required")
    sys.exit(1)

HEADERS = {"content-type": "application/json", "x-admin-key": ADMIN_KEY}


def post(path: str, payload: dict):
    r = requests.post(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} failed: {r.status_code} {r.text[:300]}")
    return r.json()


def patch(path: str, payload: dict):
    r = requests.patch(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} failed: {r.status_code} {r.text[:300]}")
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

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "progress",
            "body": f"Picked up task: {title}",
        },
    )

    # Placeholder execution output (replace with real research toolchain)
    result = textwrap.dedent(
        f"""
        Research pilot execution complete.

        Task: {title}
        Description: {desc or '(none)'}

        Next: replace this placeholder with actual research output and links.
        """
    ).strip()

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "result",
            "body": result,
        },
    )

    patch(
        "/tasks/status",
        {
            "taskId": task_id,
            "status": "review",
            "actorAgent": "research-agent",
            "notes": "Moved to review by research-agent pilot loop",
        },
    )

    print(json.dumps({"ok": True, "taskId": task_id, "movedTo": "review"}))


if __name__ == "__main__":
    run()
