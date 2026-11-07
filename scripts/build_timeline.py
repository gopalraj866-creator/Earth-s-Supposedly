#!/usr/bin/env python3
"""
Build narration audio + timeline.json + SRT for one video format.

  python3 scripts/build_timeline.py --format long  [--engine auto|edge|kokoro|estimate]
  python3 scripts/build_timeline.py --format short

Outputs (in out/<format>/):
  timeline.json   - everything the Three.js renderer + audio mixer need
  narration.wav   - 48 kHz mono float32 voice track laid out on the timeline
  subtitles.srt   - captions synced to the narration
"""
import argparse, asyncio, hashlib, json, os, re, subprocess, sys, wave
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
SR = 48000
FPS = 30

KOKORO_MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
KOKORO_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"


# --------------------------------------------------------------------------- TTS engines
def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load_wav_mono48(path):
    sr, x = wavfile.read(path)
    if x.dtype == np.int16:
        x = x.astype(np.float32) / 32768.0
    elif x.dtype == np.int32:
        x = x.astype(np.float32) / 2147483648.0
    else:
        x = x.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        from math import gcd
        g = gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x


class EdgeEngine:
    name = "edge"

    def __init__(self, voice):
        import edge_tts  # noqa
        self.voice = voice

    def synth(self, text, rate_pct, out_wav):
        import edge_tts
        mp3 = str(out_wav) + ".mp3"
        rate = f"{rate_pct:+d}%"
        last = None
        for attempt in range(4):
            try:
                asyncio.run(edge_tts.Communicate(text, self.voice, rate=rate).save(mp3))
                if os.path.getsize(mp3) > 1000:
                    break
            except Exception as e:  # network hiccups happen on shared runners
                last = e
                import time
                time.sleep(1.5 * (attempt + 1))
        else:
            raise RuntimeError(f"edge-tts failed: {last}")
        run(["ffmpeg", "-y", "-i", mp3, "-ar", str(SR), "-ac", "1", "-c:a", "pcm_f32le", str(out_wav)])
        os.remove(mp3)


class KokoroEngine:
    name = "kokoro"

    def __init__(self, voice):
        from kokoro_onnx import Kokoro
        cache = ROOT / "out" / "models"
        cache.mkdir(parents=True, exist_ok=True)
        model, voices = cache / "kokoro-v1.0.onnx", cache / "voices-v1.0.bin"
        for p, url in ((model, KOKORO_MODEL_URL), (voices, KOKORO_VOICES_URL)):
            if not p.exists():
                print(f"  downloading {p.name} ...", flush=True)
                run(["curl", "-sSfL", "--retry", "3", "-o", str(p), url])
        self.k = Kokoro(str(model), str(voices))
        self.voice = voice if voice and not voice.startswith("en-US-") else "am_michael"

    def synth(self, text, rate_pct, out_wav):
        samples, sr = self.k.create(text, voice=self.voice, speed=1.0 + rate_pct / 100.0, lang="en-us")
        x = np.asarray(samples, dtype=np.float32)
        from math import gcd
        g = gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
        wavfile.write(out_wav, SR, x)


class EstimateEngine:
    """No speech. Silent audio with realistic durations - for layout tests only."""
    name = "estimate"

    def synth(self, text, rate_pct, out_wav):
        words = len(text.split())
        dur = words / (2.55 * (1 + rate_pct / 100.0)) + 0.25 * len(re.findall(r"[,.;:?!]", text))
        wavfile.write(out_wav, SR, np.zeros(int(dur * SR), dtype=np.float32))


def make_engine(choice, voice):
    order = {"auto": ["edge", "kokoro", "estimate"], "edge": ["edge"], "kokoro": ["kokoro"], "estimate": ["estimate"]}[choice]
    errors = []
    for name in order:
        try:
            if name == "edge":
                eng = EdgeEngine(voice)
                # probe the service once so "auto" can fall back early
                probe = ROOT / "out" / "_probe.wav"
                probe.parent.mkdir(parents=True, exist_ok=True)
                eng.synth("Testing.", 0, probe)
                return eng
            if name == "kokoro":
                return KokoroEngine(voice)
            return EstimateEngine()
        except Exception as e:
            errors.append(f"{name}: {e}")
            print(f"  engine '{name}' unavailable ({e})", flush=True)
    raise SystemExit("No TTS engine available:\n" + "\n".join(errors))


# --------------------------------------------------------------------------- helpers
def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def wrap_lines(text, width=42):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def split_cues(text, width=42, max_lines=2):
    """Split a sentence into balanced subtitle cues of <= max_lines lines (<= width chars each)."""
    if len(wrap_lines(text, width)) <= max_lines:
        return [wrap_lines(text, width)]
    words = text.split()
    total = len(text)
    best, best_score = None, 1e9
    for i in range(2, len(words) - 1):
        left, right = " ".join(words[:i]), " ".join(words[i:])
        if len(wrap_lines(left, width)) > max_lines or len(wrap_lines(right, width)) > max_lines * 2:
            continue
        punct = bool(re.search(r"[,.;:?!]$", words[i - 1]))
        score = abs(len(left) - total / 2) / total - (0.35 if punct else 0.0)
        if score < best_score:
            best, best_score = i, score
    if best is None:
        best = len(words) // 2
    left, right = " ".join(words[:best]), " ".join(words[best:])
    return split_cues(left, width, max_lines) + split_cues(right, width, max_lines)


def make_chirps(marks, dur, fmt, seed=7):
    """Deterministic list of chorus 'birdsong' chirps (shared by audio synth and the renderer)."""
    rng = np.random.default_rng(seed)
    t0 = marks.get("chorus_on")
    if t0 is None:
        return []
    t1 = marks.get("from_within" if fmt == "short" else "x5000", dur) + (2.0 if fmt == "short" else 14.0)
    push = marks.get("chorus_push", t0 + (t1 - t0) * 0.4)
    out, t = [], t0 + 0.3
    while t < t1:
        density = 1.0 if t < push else 2.1
        f0 = float(rng.uniform(900, 1700))
        out.append({"t": round(t, 3), "dur": round(float(rng.uniform(0.22, 0.5)), 3),
                    "f0": round(f0), "f1": round(f0 * float(rng.uniform(1.6, 2.6)))})
        t += float(rng.uniform(0.7, 1.9)) / density
    return out


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--format", choices=["long", "short"], required=True)
    ap.add_argument("--engine", default="auto", choices=["auto", "edge", "kokoro", "estimate"])
    ap.add_argument("--voice", default="en-US-AndrewMultilingualNeural",
                    help="edge-tts voice name (kokoro uses its own, default am_michael)")
    ap.add_argument("--rate", type=int, default=None, help="force speaking rate offset in percent (skips auto-fit)")
    args = ap.parse_args()

    content = json.loads((ROOT / "content" / f"{args.format}.json").read_text())
    out_dir = ROOT / "out" / args.format
    tts_dir = out_dir / "tts"
    tts_dir.mkdir(parents=True, exist_ok=True)

    sentences = []
    for ci, ch in enumerate(content["chapters"]):
        for si, s in enumerate(ch["sentences"]):
            sentences.append({"i": len(sentences), "chapter": ch["id"], "ci": ci, "first": si == 0, **s})

    engine = make_engine(args.engine, args.voice)
    print(f"[{args.format}] TTS engine: {engine.name}, {len(sentences)} sentences", flush=True)

    def synth_all(rate):
        audio = []
        for s in sentences:
            key = hashlib.sha1(f"{engine.name}|{getattr(engine, 'voice', '')}|{rate}|{s['text']}".encode()).hexdigest()[:12]
            p = tts_dir / f"s{s['i']:03d}_{key}.wav"
            if not p.exists():
                engine.synth(s["text"], rate, p)
            audio.append(load_wav_mono48(p))
        return audio

    sent_gap = 0.30 if args.format == "long" else 0.12
    ch_gap = content.get("chapter_gap", 0.9)
    lead, tail, target = content["lead_in"], content["tail"], content["target_seconds"]
    n_ch = len(content["chapters"])

    def total_len(audio, rate_gap_sent=sent_gap, rate_gap_ch=ch_gap):
        speech = sum(len(a) for a in audio) / SR
        gaps = 0.0
        for k, s in enumerate(sentences[:-1]):
            gaps += rate_gap_ch if sentences[k + 1]["first"] else rate_gap_sent
        return lead + speech + gaps + tail, speech

    rate = args.rate if args.rate is not None else 0
    audio = synth_all(rate)
    total, speech = total_len(audio)
    print(f"  first pass @ {rate:+d}%: {total:.1f}s total ({speech:.1f}s speech), target {target}s", flush=True)

    if args.rate is None and engine.name != "estimate":
        # fit the speaking rate so the video lands on the target length (within a natural range)
        budget = target - (total - speech)
        factor = speech / max(budget, 1.0)
        adj = int(round((factor - 1.0) * 100))
        adj = max(-8, min(14, adj))
        if abs(adj) >= 2:
            rate = adj
            audio = synth_all(rate)
            total, speech = total_len(audio)
            print(f"  re-synthesised @ {rate:+d}%: {total:.1f}s total", flush=True)

    # spread any remaining slack into pauses so the length hits the target
    extra = target - total
    if extra > 0.5:
        add_s = min(extra / max(len(sentences) - n_ch, 1), 0.35)
        sent_gap += add_s
        extra -= add_s * (len(sentences) - n_ch)
        add_c = min(extra / max(n_ch - 1, 1), 3.0)
        ch_gap += add_c
        extra -= add_c * (n_ch - 1)
        tail += max(extra, 0.0)
    elif extra < -0.5:
        print(f"  note: speech is {-extra:.1f}s longer than target; keeping natural pacing", flush=True)

    # ------------------------------------------------------------- layout
    t = lead
    for k, s in enumerate(sentences):
        s["start"] = round(t, 3)
        s["end"] = round(t + len(audio[k]) / SR, 3)
        t = s["end"] + (ch_gap if k + 1 < len(sentences) and sentences[k + 1]["first"] else sent_gap)
    duration = round(sentences[-1]["end"] + tail, 3)

    # contiguous chapters: each chapter owns the time from the previous chapter's end to its own end
    chapters = []
    for ci, ch in enumerate(content["chapters"]):
        ss = [s for s in sentences if s["ci"] == ci]
        start = 0.0 if ci == 0 else chapters[-1]["end"]
        end = duration if ci == n_ch - 1 else round((ss[-1]["end"] + [s for s in sentences if s["ci"] == ci + 1][0]["start"]) / 2, 3)
        chapters.append({"id": ch["id"], "title": ch["title"], "subtitle": ch.get("subtitle", ""),
                         "energy": ch.get("energy", 0.5), "start": round(start, 3), "end": end,
                         "first_sentence": ss[0]["start"], "last_sentence": ss[-1]["end"]})

    marks = {s["mark"]: s["start"] for s in sentences if "mark" in s}
    callouts = []
    for s in sentences:
        c = s.get("callout")
        if c:
            hold = 7.0 if c["kind"] == "timeline" else 1.2
            callouts.append({"start": round(s["start"] + 0.1, 3), "end": round(s["end"] + hold, 3), **c})

    # ------------------------------------------------------------- subtitles
    cues = []
    for s in sentences:
        parts = split_cues(s["text"])
        weights = [sum(len(l) for l in p) + 1 for p in parts]
        tot, t0 = sum(weights), s["start"]
        span = s["end"] - s["start"]
        for p, w in zip(parts, weights):
            t1 = t0 + span * w / tot
            cues.append({"start": round(t0, 3), "end": round(t1, 3), "lines": p})
            t0 = t1
    srt = []
    for n, c in enumerate(cues, 1):
        end = min(c["end"] + 0.12, cues[n]["start"] - 0.02) if n < len(cues) else c["end"] + 0.4
        srt.append(f"{n}\n{srt_time(c['start'])} --> {srt_time(max(end, c['start'] + 0.3))}\n" + "\n".join(c["lines"]) + "\n")
    (out_dir / "subtitles.srt").write_text("\n".join(srt), encoding="utf-8")

    # ------------------------------------------------------------- narration track
    track = np.zeros(int(duration * SR) + SR, dtype=np.float32)
    for s, a in zip(sentences, audio):
        i0 = int(s["start"] * SR)
        track[i0:i0 + len(a)] += a
    track = track[:int(duration * SR)]
    wavfile.write(out_dir / "narration.wav", SR, track)

    timeline = {
        "format": args.format, "fps": FPS, "duration": duration, "title": content["title"],
        "engine": engine.name, "rate_pct": rate, "tail": round(tail, 3),
        "chapters": chapters, "sentences": [{k: v for k, v in s.items() if k not in ("first",)} for s in sentences],
        "marks": marks, "callouts": callouts, "cues": cues,
        "chirps": make_chirps(marks, duration, args.format),
    }
    (out_dir / "timeline.json").write_text(json.dumps(timeline, indent=1, ensure_ascii=False))

    m, sec = divmod(duration, 60)
    print(f"[{args.format}] duration {int(m)}:{sec:05.2f}  chapters {len(chapters)}  cues {len(cues)}  chirps {len(timeline['chirps'])}")
    print(f"  wrote {out_dir}/timeline.json, narration.wav, subtitles.srt")


if __name__ == "__main__":
    main()
