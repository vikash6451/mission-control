#!/usr/bin/env python3
"""Research-agent L3 pilot loop for Mission Control Lite with cognitive memory hooks."""

import json
import os
import re
import sys
import textwrap
import requests

from exa_deep_search import exa_search

try:
    from integrations.secrets import get_secret
except Exception:
    get_secret = None

BASE = os.getenv("MISSION_CONTROL_BASE", "https://dutiful-goshawk-499.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "") or ((get_secret("MISSION_CONTROL_ADMIN_KEY") if get_secret else "") or "")
MEMORY_SCOPE = os.getenv("MISSION_CONTROL_MEMORY_SCOPE", "research")
MEMORY_SCOPES = [s.strip() for s in os.getenv("MISSION_CONTROL_MEMORY_SCOPES", f"{MEMORY_SCOPE},research/global,research/signals/market").split(",") if s.strip()]

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


def recall_multi_scope(query_text: str, top_k_per_scope: int = 4):
    recalls = []
    merged = []

    for scope in MEMORY_SCOPES:
        r = post("/memory/recall", {"scope": scope, "query": query_text, "topK": top_k_per_scope})
        recalls.append({"scope": scope, "raw": r})
        for m in r.get("memories", []):
            mm = dict(m)
            mm["scope"] = scope
            merged.append(mm)

    merged.sort(key=lambda x: x.get("score", 0), reverse=True)

    # Deduplicate by exact content so repeated facts across scopes don't spam context.
    dedup = []
    seen = set()
    for m in merged:
        c = (m.get("content") or "").strip().lower()
        if not c or c in seen:
            continue
        seen.add(c)
        dedup.append(m)

    any_medium_plus = any((r["raw"].get("confidenceBand") in ("medium", "high")) for r in recalls)
    all_require_review = bool(recalls) and all(r["raw"].get("requiresReview") for r in recalls)

    evidence_gaps = []
    for r in recalls:
        for g in r["raw"].get("evidence_gaps", []):
            if g not in evidence_gaps:
                evidence_gaps.append(g)

    return {
        "recalls": recalls,
        "memories": dedup,
        "anyMediumPlus": any_medium_plus,
        "allRequireReview": all_require_review,
        "evidence_gaps": evidence_gaps,
        "topConfidence": next((r["raw"].get("confidenceBand") for r in recalls if r["raw"].get("confidenceBand") in ("high", "medium", "low")), "low"),
    }


def exa_url_fallback(query_text: str, need: int):
    need = max(0, min(6, need))
    if need == 0:
        return []
    try:
        deep = exa_search(query_text, num_results=need, deep=True)
        return [r.get("url") for r in deep.get("results", []) if r.get("url")]
    except Exception:
        return []


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

    recall = recall_multi_scope(f"{title}\n{desc}\n{ac}", top_k_per_scope=4)

    if recall.get("allRequireReview") and not recall.get("anyMediumPlus"):
        # Exa Deep fallback before blocking the task.
        exa_urls = exa_url_fallback(f"{title}\n{desc}\n{ac}", need=max(2, min_sources))
        urls = list(dict.fromkeys(urls + exa_urls))
        if not exa_urls:
            post(
                "/tasks/blocked",
                {
                    "taskId": task_id,
                    "actorAgent": "research-agent",
                    "blockerReason": "Low-confidence memory recall across all scopes and Exa fallback returned no evidence. Gaps: "
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
                        "confidenceBand": recall.get("topConfidence"),
                        "evidence_gaps": recall.get("evidence_gaps", []),
                        "scopes": MEMORY_SCOPES,
                    }
                )
            )
            return

    if len(urls) < min_sources:
        # Exa Deep fallback for missing evidence links.
        need = min_sources - len(urls)
        exa_urls = exa_url_fallback(f"{title}\n{desc}\n{ac}", need=need)
        urls = list(dict.fromkeys(urls + exa_urls))

    if len(urls) < min_sources:
        post(
            "/tasks/blocked",
            {
                "taskId": task_id,
                "actorAgent": "research-agent",
                "blockerReason": f"Insufficient evidence inputs even after Exa fallback: found {len(urls)} source links, need >= {min_sources}",
                "handoffToAgent": "main-orchestrator",
                "handoffToLane": "ops",
            },
        )
        print(json.dumps({"ok": False, "taskId": task_id, "blocked": "insufficient_sources", "found": len(urls), "required": min_sources}))
        return

    recalled_lines = recall.get("memories", [])[:5]
    recalled_text = "\n".join([
        f"- [{m.get('scope')}] {m.get('content')} (score={m.get('score')})" for m in recalled_lines
    ]) or "- none"

    post(
        "/tasks/comment",
        {
            "taskId": task_id,
            "authorAgent": "research-agent",
            "kind": "progress",
            "body": f"Picked up task: {title}. Evidence links found: {len(urls)}. Memory confidence={recall.get('topConfidence')} across scopes {', '.join(MEMORY_SCOPES)}.\nRecalled context:\n{recalled_text}",
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
        confidenceBand={recall.get('topConfidence')} | scopes={', '.join(MEMORY_SCOPES)} | evidence_gaps={'; '.join(recall.get('evidence_gaps', [])) or 'none'}

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
                "memoryConfidenceBand": recall.get("topConfidence"),
            }
        )
    )


if __name__ == "__main__":
    run()
