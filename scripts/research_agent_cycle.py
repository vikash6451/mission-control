#!/usr/bin/env python3
"""Research-agent L3 pilot loop for Mission Control Lite.

Flow:
1) claim next research backlog task
2) validate task contract + evidence minimum
3) post progress
4) post structured result (answer, evidence, counterpoints, confidence, gaps)
5) move to review with result links

If contract/evidence is incomplete -> mark blocked + optional handoff.
"""

import json
import os
import re
import sys
import textwrap
import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://adamant-cassowary-648.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")

if not ADMIN_KEY:
    print("ERROR: MISSION_CONTROL_ADMIN_KEY is required")
    sys.exit(1)

HEADERS = {"content-type": "application/json", "x-admin-key": ADMIN_KEY}
URL_RE = re.compile(r"https?://\S+")


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


def extract_urls(*chunks):
    s = "\n".join([c for c in chunks if c])
    return list(dict.fromkeys(URL_RE.findall(s)))


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
    min_sources = int(task.get("minSources", 3) or 3)
    require_counterpoints = bool(task.get("requireCounterpoints", True))
    context_paths = task.get("contextPaths", []) or []

    urls = extract_urls(desc, "\n".join(context_paths))

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
        print(json.dumps({"ok": False, "taskId": task_id, "blocked": "contract_incomplete"}))
        return

    if len(urls) < min_sources:
        post(
            "/tasks/blocked",
            {
                "taskId": task_id,
                "actorAgent": "research-agent",
                "blockerReason": f"Insufficient evidence inputs: found {len(urls)} source links, need >= {min_sources}",
                "handoffToAgent": "main-orchestrator",
                "handoffToLane": "ops",
            },
        )
        print(json.dumps({"ok": False, "taskId": task_id, "blocked": "insufficient_sources", "found": len(urls), "required": min_sources}))
        return

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "progress",
            "body": f"Picked up task: {title}. Evidence links found: {len(urls)}",
            "resultLinks": urls,
        },
    )

    confidence = 0.62 if len(urls) >= min_sources else 0.35
    counterpoints = "- Counterpoint: current evidence may be biased toward provided sources." if require_counterpoints else "- Counterpoints not required for this task."

    result = textwrap.dedent(
        f"""
        ## Answer
        Placeholder synthesis for: {title}

        ## Evidence ({len(urls)} sources)
        {chr(10).join(f'- {u}' for u in urls[:8])}

        ## Counterpoints
        {counterpoints}

        ## Confidence
        {confidence:.2f} (provisional)

        ## Gaps
        - Needs independent verification against primary data sources.

        ## Output Format Requested
        {outfmt}
        """
    ).strip()

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "result",
            "body": result,
            "resultLinks": urls,
        },
    )

    patch(
        "/tasks/status",
        {
            "taskId": task_id,
            "status": "review",
            "actorAgent": "research-agent",
            "notes": "Moved to review with L3 structured output",
            "resultLinks": urls,
        },
    )

    print(json.dumps({"ok": True, "taskId": task_id, "movedTo": "review", "sources": len(urls), "confidence": confidence}))


if __name__ == "__main__":
    run()
