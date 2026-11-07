#!/usr/bin/env python3
"""Join rendered chunks (stream copy, no re-encode) and mux the mastered audio.

  python3 scripts/assemble.py --format long --profile 1080p --chunks chunks/ --out final/radiation-barrier_1080p.mp4
"""
import argparse, json, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--format", required=True); ap.add_argument("--profile", required=True)
ap.add_argument("--chunks", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--audio", default=None, help="defaults to out/<format>/audio.m4a")
a = ap.parse_args()

files = sorted(Path(a.chunks).glob(f"{a.profile}-*.mp4"))
if not files: raise SystemExit(f"no chunks named {a.profile}-*.mp4 in {a.chunks}")
tl = json.loads((ROOT / "out" / a.format / "timeline.json").read_text())
audio = Path(a.audio or ROOT / "out" / a.format / "audio.m4a")
out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory() as td:
    lst = Path(td) / "list.txt"
    lst.write_text("".join(f"file '{f.resolve()}'\n" for f in files))
    joined = Path(td) / "joined.mp4"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)], check=True)
    tmp = out.with_suffix(".partial.mp4")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(joined), "-i", str(audio), "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", "-metadata", f"title={tl['title']}", str(tmp)], check=True)
    tmp.rename(out)

dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout)
print(f"[assemble] {out}  {dur:.2f}s (timeline {tl['duration']:.2f}s)  {out.stat().st_size / 1e6:.1f} MB  from {len(files)} chunks")
