#!/usr/bin/env python3
import json
import os
import requests

BASE = os.getenv("MISSION_CONTROL_BASE", "https://dutiful-goshawk-499.convex.site/mission-control")
SCOPE = os.getenv("MISSION_CONTROL_MEMORY_SCOPE", "")

url = f"{BASE}/memory/metrics"
if SCOPE:
    url += f"?scope={SCOPE}"

r = requests.get(url, timeout=30)
r.raise_for_status()
data = r.json()
print(json.dumps(data, indent=2))
