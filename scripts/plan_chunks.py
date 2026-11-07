#!/usr/bin/env python3
"""Plan the render matrix for the GitHub Action.  Writes `matrix=<json>` and `formats=<list>` to $GITHUB_OUTPUT.

  python3 scripts/plan_chunks.py --quality 1080p|4k|shorts|all
"""
import argparse, json, math, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNK = {"1080p": 40, "4k": 20, "short": 26}          # seconds of video per matrix job
JOBS = {"1080p": "long", "4k": "long", "short": "short"}

ap = argparse.ArgumentParser()
ap.add_argument("--quality", default="1080p", choices=["1080p", "4k", "shorts", "all"])
args = ap.parse_args()
profiles = {"1080p": ["1080p"], "4k": ["4k"], "shorts": ["short"], "all": ["1080p", "4k", "short"]}[args.quality]

include, formats = [], set()
for prof in profiles:
    fmt = JOBS[prof]; formats.add(fmt)
    dur = json.loads((ROOT / "out" / fmt / "timeline.json").read_text())["duration"]
    n = max(1, math.ceil(dur / CHUNK[prof] - 0.15))        # absorb a tiny remainder instead of launching a job for it
    bounds = [round(dur * i / n, 3) for i in range(n)] + [round(dur, 3)]   # even split; adjacent chunks share the same boundary value
    for i in range(n):
        include.append({"format": fmt, "profile": prof, "idx": i, "name": f"{prof}-{i:03d}",
                        "start": bounds[i], "end": bounds[i + 1]})
matrix = {"include": include}
print(json.dumps({"jobs": len(include), "formats": sorted(formats)}))
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"matrix={json.dumps(matrix)}\nformats={json.dumps(sorted(formats))}\n")
else:
    print(json.dumps(matrix)[:400])
