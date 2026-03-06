#!/usr/bin/env python3
"""Shared memory preflight for all agents.

Usage:
  python3 scripts/memory_preflight.py --query "credit card reward hacks" \
    --scope research/global --scope research/signals/market --scope research/domain/finance

Outputs compact JSON with merged recalled memories + confidence summary.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://dutiful-goshawk-499.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")
TOPK = int(os.getenv("MISSION_CONTROL_PREFLIGHT_TOPK", "4"))


def post(path: str, payload: Dict[str, Any]):
    r = requests.post(
        f"{BASE}{path}",
        headers={"content-type": "application/json", "x-admin-key": ADMIN_KEY},
        json=payload,
        timeout=25,
    )
    if not r.ok:
        raise RuntimeError(f"{path} {r.status_code}: {r.text[:240]}")
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True)
    ap.add_argument("--scope", action="append", dest="scopes")
    ap.add_argument("--topk", type=int, default=TOPK)
    args = ap.parse_args()

    if not ADMIN_KEY:
        print(json.dumps({"ok": False, "error": "MISSION_CONTROL_ADMIN_KEY missing"}))
        sys.exit(1)

    scopes = args.scopes or ["research/global", "research/signals/market"]

    recalls: List[Dict[str, Any]] = []
    merged: List[Dict[str, Any]] = []
    for scope in scopes:
        r = post("/memory/recall", {"scope": scope, "query": args.query, "topK": args.topk})
        recalls.append({"scope": scope, "confidenceBand": r.get("confidenceBand"), "requiresReview": r.get("requiresReview"), "evidence_gaps": r.get("evidence_gaps", [])})
        for m in r.get("memories", []):
            merged.append(
                {
                    "scope": scope,
                    "content": m.get("content"),
                    "score": m.get("score"),
                    "importance": m.get("importance"),
                    "reliability": m.get("reliability"),
                    "updatedAt": m.get("updatedAt"),
                }
            )

    merged.sort(key=lambda x: x.get("score", 0), reverse=True)
    dedup = []
    seen = set()
    for m in merged:
        key = (m.get("content") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        dedup.append(m)

    any_medium_plus = any(x.get("confidenceBand") in ("medium", "high") for x in recalls)
    all_require_review = bool(recalls) and all(x.get("requiresReview") for x in recalls)

    print(
        json.dumps(
            {
                "ok": True,
                "query": args.query,
                "scopes": scopes,
                "summary": {
                    "anyMediumPlus": any_medium_plus,
                    "allRequireReview": all_require_review,
                    "recalled": len(dedup),
                },
                "recalls": recalls,
                "memories": dedup[:8],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
