#!/usr/bin/env python3
"""Minimal Exa deep-search wrapper.

- Uses EXA_API_KEY from env, with fallback to scripts/integrations/secrets.py
- Returns compact JSON with urls + snippets
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

import requests


def get_exa_key() -> str | None:
    key = os.getenv("EXA_API_KEY")
    if key:
        return key
    try:
        from integrations.secrets import get_secret  # scripts/integrations/secrets.py
        return get_secret("EXA_API_KEY")
    except Exception:
        return None


def exa_search(query: str, num_results: int = 5, deep: bool = True) -> Dict[str, Any]:
    key = get_exa_key()
    if not key:
        raise RuntimeError("EXA_API_KEY missing")

    headers = {
        "x-api-key": key,
        "Content-Type": "application/json",
    }

    payload = {
        "query": query,
        "numResults": max(1, min(10, int(num_results))),
        "useAutoprompt": True,
        "contents": {
            "highlights": {"maxCharacters": 280},
            "text": {"maxCharacters": 1000},
        },
    }

    # Best-effort deep mode flag (API may ignore/rename; fallback below).
    if deep:
        payload["searchType"] = "deep"

    r = requests.post("https://api.exa.ai/search", headers=headers, json=payload, timeout=35)

    if not r.ok and deep:
        # Fallback to normal search if deep flag is unsupported.
        payload.pop("searchType", None)
        r = requests.post("https://api.exa.ai/search", headers=headers, json=payload, timeout=35)

    if not r.ok:
        raise RuntimeError(f"exa search failed {r.status_code}: {r.text[:240]}")

    data = r.json()
    results = data.get("results", []) or []
    out: List[Dict[str, Any]] = []
    for x in results:
        url = x.get("url")
        if not url:
            continue
        highlights = x.get("highlights") or []
        snippet = highlights[0] if highlights else (x.get("text") or "")[:240]
        out.append(
            {
                "title": x.get("title") or "",
                "url": url,
                "snippet": (snippet or "").strip(),
                "publishedDate": x.get("publishedDate"),
            }
        )

    return {"ok": True, "query": query, "results": out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--num", type=int, default=5)
    ap.add_argument("--no-deep", action="store_true")
    args = ap.parse_args()

    try:
        out = exa_search(args.query, num_results=args.num, deep=(not args.no_deep))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
