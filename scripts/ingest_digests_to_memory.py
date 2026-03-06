#!/usr/bin/env python3
"""Ingest digest items (newsletter/twitter/reddit/hn) into Mission Control cognitive memory.

Best-practice defaults implemented:
- Structured normalization (claim/evidence/url/source/date/author/tags)
- Quality gating + per-source reliability priors
- Exact dedupe via fingerprint within run
- Scope routing (global + signals + optional client scopes)
- Conservative write caps to avoid memory flooding

Usage examples:
  python3 scripts/ingest_digests_to_memory.py --input /path/newsletters.json --source newsletter
  python3 scripts/ingest_digests_to_memory.py --input /path/twitter_digest.txt --source twitter
  python3 scripts/ingest_digests_to_memory.py --input a.json --input b.json --source auto
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://dutiful-goshawk-499.convex.site/mission-control")
ADMIN_KEY = os.getenv("MISSION_CONTROL_ADMIN_KEY", "")

DEFAULT_SCOPE_GLOBAL = os.getenv("MISSION_CONTROL_MEMORY_SCOPE_GLOBAL", "research/global")
DEFAULT_SCOPE_SIGNALS = os.getenv("MISSION_CONTROL_MEMORY_SCOPE_SIGNALS", "research/signals/market")
MAX_ITEMS_PER_RUN = int(os.getenv("MISSION_CONTROL_DIGEST_INGEST_MAX", "20"))
MIN_QUALITY_SCORE = float(os.getenv("MISSION_CONTROL_DIGEST_MIN_QUALITY", "0.45"))

SOURCE_PRIOR = {
    "newsletter": 0.72,
    "twitter": 0.58,
    "reddit": 0.52,
    "hn": 0.66,
}

CLIENT_KEYWORDS = {
    "frex": ["frex", "cross-border", "remittance", "upi", "payments"],
    "pice": ["pice", "sme payment", "msme", "merchant payment"],
    "oolka": ["oolka", "sixdis", "credit management", "lending", "credit"],
    "bukuwarung": ["bukuwarung", "indonesia", "warung", "msme indonesia"],
}

URL_RE = re.compile(r"https?://\S+")

if not ADMIN_KEY:
    raise SystemExit("ERROR: set MISSION_CONTROL_ADMIN_KEY")

HEADERS = {"content-type": "application/json", "x-admin-key": ADMIN_KEY}


def post(path: str, payload: dict):
    r = requests.post(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if not r.ok:
        raise RuntimeError(f"{path} {r.status_code}: {r.text[:400]}")
    return r.json()


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def to_source(value: str, filename: str) -> str:
    if value and value != "auto":
        return value
    lower = filename.lower()
    if "newsletter" in lower:
        return "newsletter"
    if "twitter" in lower or "tweet" in lower or "x_" in lower:
        return "twitter"
    if "reddit" in lower:
        return "reddit"
    if "hn" in lower or "hacker" in lower:
        return "hn"
    return "newsletter"


def parse_ts(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    try:
        # Accept ISO-ish strings.
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


def extract_tags(text: str) -> List[str]:
    t = text.lower()
    tag_map = {
        "ai": ["llm", "gpt", "claude", "ai agent", "inference", "rag", "model"],
        "fintech": ["fintech", "payment", "upi", "credit", "lending", "card"],
        "growth": ["cac", "ltv", "uac", "retention", "activation", "attribution"],
        "product": ["onboarding", "feature", "funnel", "experimentation", "a/b"],
        "india": ["india", "rbi", "upi", "gst", "inr"],
    }
    out = []
    for tag, kws in tag_map.items():
        if any(k in t for k in kws):
            out.append(tag)
    return out[:5]


def route_scopes(text: str) -> List[str]:
    t = text.lower()
    scopes = [DEFAULT_SCOPE_GLOBAL, DEFAULT_SCOPE_SIGNALS]
    for client, kws in CLIENT_KEYWORDS.items():
        if any(k in t for k in kws):
            scopes.append(f"research/client/{client}")
    return list(dict.fromkeys(scopes))


def fingerprint(source: str, claim: str, url: str) -> str:
    key = f"{source}|{normalize_text(claim).lower()}|{(url or '').strip().lower()}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def quality_score(item: Dict[str, Any], source: str) -> float:
    q = SOURCE_PRIOR.get(source, 0.55)
    claim = item.get("claim", "")
    evidence = item.get("evidence", "")
    url = item.get("url", "")
    if len(claim) > 60:
        q += 0.08
    if len(evidence) > 30:
        q += 0.06
    if re.search(r"\b\d+(?:\.\d+)?%?\b", f"{claim} {evidence}"):
        q += 0.06
    if url.startswith("http"):
        q += 0.05
    return max(0.2, min(0.95, q))


def normalize_json_item(obj: Dict[str, Any], source: str) -> Dict[str, Any] | None:
    text_fields = [obj.get("claim"), obj.get("summary"), obj.get("title"), obj.get("content"), obj.get("text")]
    claim = next((normalize_text(x) for x in text_fields if isinstance(x, str) and normalize_text(x)), "")
    if not claim:
        return None
    evidence = normalize_text(obj.get("evidence") or obj.get("snippet") or "")
    url = (obj.get("url") or obj.get("link") or "").strip()
    if not url:
        m = URL_RE.search(f"{obj.get('content', '')} {obj.get('text', '')}")
        if m:
            url = m.group(0)
    author = normalize_text(obj.get("author") or obj.get("from") or obj.get("publication") or "")
    published_at = parse_ts(obj.get("published_at") or obj.get("date") or obj.get("published"))

    blob = f"{claim} {evidence} {author}"
    tags = extract_tags(blob)
    return {
        "source": source,
        "claim": claim[:280],
        "evidence": evidence[:280],
        "url": url,
        "author": author[:120],
        "published_at": published_at,
        "tags": tags,
    }


def normalize_text_block(text: str, source: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    lines = [normalize_text(x) for x in text.splitlines() if normalize_text(x)]
    for line in lines:
        m = URL_RE.search(line)
        if not m:
            continue
        url = m.group(0)
        claim = normalize_text(line.replace(url, ""))
        if len(claim) < 24:
            continue
        items.append(
            {
                "source": source,
                "claim": claim[:280],
                "evidence": "",
                "url": url,
                "author": "",
                "published_at": None,
                "tags": extract_tags(claim),
            }
        )
    return items


def load_items(path: Path, source_hint: str) -> List[Dict[str, Any]]:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    source = to_source(source_hint, path.name)

    # JSON path
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            out = []
            for x in data:
                if isinstance(x, dict):
                    n = normalize_json_item(x, source)
                    if n:
                        out.append(n)
            return out
        if isinstance(data, dict):
            # common wrappers: {items:[...]} or newsletter payload dict
            arr = data.get("items") or data.get("results") or data.get("data")
            if isinstance(arr, list):
                out = []
                for x in arr:
                    if isinstance(x, dict):
                        n = normalize_json_item(x, source)
                        if n:
                            out.append(n)
                return out
            n = normalize_json_item(data, source)
            return [n] if n else []
    except Exception:
        pass

    # Plain text fallback
    return normalize_text_block(raw, source)


def memory_content(item: Dict[str, Any], fp: str) -> str:
    published = f" | published={item['published_at']}" if item.get("published_at") else ""
    evidence = f" | evidence={item['evidence']}" if item.get("evidence") else ""
    author = f" | author={item['author']}" if item.get("author") else ""
    tags = f" | tags={','.join(item.get('tags', []))}" if item.get("tags") else ""
    url = f" | url={item['url']}" if item.get("url") else ""
    return f"[{item['source']}] {item['claim']}{evidence}{author}{published}{tags}{url} | fp={fp}"


def main():
    ap = argparse.ArgumentParser(description="Ingest digest files into cognitive memory")
    ap.add_argument("--input", action="append", required=True, help="Path to digest file (repeatable)")
    ap.add_argument("--source", default="auto", choices=["auto", "newsletter", "twitter", "reddit", "hn"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    all_items: List[Dict[str, Any]] = []
    for p in args.input:
        path = Path(p)
        if not path.exists():
            print(f"WARN: file not found: {p}")
            continue
        all_items.extend(load_items(path, args.source))

    if not all_items:
        print(json.dumps({"ok": True, "ingested": 0, "reason": "no_normalized_items"}, indent=2))
        return

    # Deduplicate in-run + quality sort.
    seen = set()
    scored = []
    for item in all_items:
        fp = fingerprint(item["source"], item["claim"], item.get("url", ""))
        if fp in seen:
            continue
        seen.add(fp)
        q = quality_score(item, item["source"])
        if q < MIN_QUALITY_SCORE:
            continue
        scored.append((q, fp, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    scored = scored[:MAX_ITEMS_PER_RUN]

    writes = []
    errors = []
    for q, fp, item in scored:
        scopes = route_scopes(f"{item['claim']} {item.get('evidence','')} {item.get('author','')}")
        reliability = round(q, 3)
        importance = round(min(0.9, max(0.45, 0.55 + (q - 0.5) * 0.5)), 3)
        content = memory_content(item, fp)
        for scope in scopes:
            payload = {
                "scope": scope,
                "content": content,
                "sourceType": f"digest:{item['source']}",
                "sourceRef": item.get("url") or None,
                "importance": importance,
                "reliability": reliability,
                "tags": item.get("tags", []),
            }
            if args.dry_run:
                writes.append({"scope": scope, "payload": payload})
                continue
            try:
                resp = post("/memory/remember", payload)
                writes.append({"scope": scope, "fp": fp, "state": resp.get("state", "inserted")})
            except Exception as e:
                errors.append({"scope": scope, "fp": fp, "error": str(e)})

    print(
        json.dumps(
            {
                "ok": len(errors) == 0,
                "normalized": len(all_items),
                "selected": len(scored),
                "writes": len(writes),
                "errors": errors[:10],
                "sample": writes[:6],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
