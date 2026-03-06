#!/usr/bin/env python3
"""Research-agent L3 pilot loop for Mission Control Lite with cognitive memory hooks."""

import json
import os
import re
import sys
import textwrap
import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://dutiful-goshawk-499.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")
MEMORY_SCOPE = os.getenv("MISSION_CONTROL_MEMORY_SCOPE", "research")

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

    recall = post(
        "/memory/recall",
        {"scope": MEMORY_SCOPE, "query": f"{title}\n{desc}\n{ac}", "topK": 5},
    )

    if recall.get("requiresReview"):
        post(
            "/tasks/blocked",
            {
                "taskId": task_id,
                "actorAgent": "research-agent",
                "blockerReason": "Low-confidence memory recall; manual review required before execution. Gaps: "
                + "; ".join(recall.get("evidence_gaps", [])[:3]),
                "handoffToAgent": "main-orchestrator",
                "handoffToLane": "ops",
            },
        )
        print(
            json.dumps(
                {
                    "ok": False,
                    "taskId": task_id,
                    "blocked": "low_confidence_memory_recall",
                    "confidenceBand": recall.get("confidenceBand"),
                    "evidence_gaps": recall.get("evidence_gaps", []),
                }
            )
        )
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

    recalled_lines = recall.get("memories", [])[:3]
    recalled_text = "\n".join([f"- {m.get('content')} (score={m.get('score')})" for m in recalled_lines]) or "- none"

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "progress",
            "body": f"Picked up task: {title}. Evidence links found: {len(urls)}. Memory confidence={recall.get('confidenceBand')}.\nRecalled context:\n{recalled_text}",
            "resultLinks": urls,
        },
    )

    confidence = 0.70 if len(urls) >= min_sources else 0.35
    counterpoints = "- Counterpoint: current evidence may be biased toward provided sources." if require_counterpoints else "- Counterpoints not required for this task."

    result = textwrap.dedent(
        f"""
        ## Answer
        Placeholder synthesis for: {title}

        ## Evidence ({len(urls)} sources)
        {chr(10).join(f'- {u}' for u in urls[:8])}

        ## Memory Reuse
        confidenceBand={recall.get('confidenceBand')} | evidence_gaps={'; '.join(recall.get('evidence_gaps', [])) or 'none'}

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

    post(
        "/memory/extract",
        {
            "scope": MEMORY_SCOPE,
            "text": f"{title}. {desc}. {result}",
            "sourceTaskId": task_id,
            "sourceType": "task_result",
            "importance": 0.65,
            "reliability": 0.6,
            "maxItems": 8,
        },
    )

    patch(
        "/tasks/status",
        {
            "taskId": task_id,
            "status": "review",
            "actorAgent": "research-agent",
            "notes": "Moved to review with L3 structured output + memory recall/remember",
            "resultLinks": urls,
        },
    )

    print(
        json.dumps(
            {
                "ok": True,
                "taskId": task_id,
                "movedTo": "review",
                "sources": len(urls),
                "confidence": confidence,
                "memoryConfidenceBand": recall.get("confidenceBand"),
            }
        )
    )


if __name__ == "__main__":
    run()
