#!/usr/bin/env python3
"""Seeded end-to-end cognitive memory validation.

Flow:
1) Seed memories via /memory/remember and /memory/extract
2) Trigger contradiction consolidation
3) Recall by query
4) Review recall log (accept/reject)
5) Fetch metrics + stats and print compact report
"""

import json
import os
import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://dutiful-goshawk-499.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")
SCOPE = os.getenv("MISSION_CONTROL_MEMORY_SCOPE", "research/seeded-e2e")

if not ADMIN_KEY:
    raise SystemExit("ERROR: set MISSION_CONTROL_ADMIN_KEY")

H = {"content-type": "application/json", "x-admin-key": ADMIN_KEY}


def post(path: str, payload: dict):
    r = requests.post(f"{BASE}{path}", headers=H, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} {r.status_code}: {r.text[:400]}")
    return r.json()


def get(path: str):
    r = requests.get(f"{BASE}{path}", timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} {r.status_code}: {r.text[:400]}")
    return r.json()


def main():
    seeded = []

    # Base facts
    seeded.append(post("/memory/remember", {
        "scope": SCOPE,
        "content": "Frex weekly growth review happens every Monday 10:00 IST.",
        "importance": 0.8,
        "sourceType": "calendar",
        "sourceRef": "https://example.com/calendar/frex-weekly"
    }))

    seeded.append(post("/memory/extract", {
        "scope": SCOPE,
        "text": "Frex launched UPI autopay in Feb. Team tracks activation rate and repeat transfers weekly.",
        "importance": 0.7,
        "sourceType": "changelog",
        "sourceRef": "https://example.com/frex/changelog"
    }))

    # Contradiction / supersession
    seeded.append(post("/memory/remember", {
        "scope": SCOPE,
        "content": "Frex weekly growth review moved to Tuesday 11:00 IST from March.",
        "importance": 0.9,
        "sourceType": "calendar",
        "sourceRef": "https://example.com/calendar/frex-weekly-updated"
    }))

    # Recall
    recall = post("/memory/recall", {
        "scope": SCOPE,
        "query": "When is Frex weekly growth review and what changed recently?",
        "topK": 5
    })

    recall_log_id = recall.get("recallLog", {}).get("_id") or recall.get("recallLogId")
    review_outcome = "accepted" if recall.get("confidence") in ("high", "medium") else "rejected"

    review = None
    if recall_log_id:
        review = post("/memory/recall/review", {
            "recallLogId": recall_log_id,
            "outcome": review_outcome
        })

    stats = get(f"/memory/stats?scope={SCOPE}")
    metrics = get(f"/memory/metrics?scope={SCOPE}")

    report = {
        "scope": SCOPE,
        "seededOps": len(seeded),
        "recall": {
            "confidence": recall.get("confidence"),
            "requiresReview": recall.get("requiresReview"),
            "evidenceGaps": recall.get("evidenceGaps", []),
            "results": len(recall.get("results", [])),
            "recallLogId": recall_log_id,
        },
        "review": review,
        "stats": stats,
        "metrics": metrics,
    }

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
