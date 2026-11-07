#!/usr/bin/env python3
"""
Mix the final soundtrack: narration + a synthesized cinematic score + event sound design.

  python3 scripts/build_audio.py --format long

Score is generated procedurally (no copyrighted music): evolving sub drone + detuned pad, per-chapter energy,
risers into big moments, a CME whoosh, the 'birdsong' chorus chirps (same timings as the on-screen waves),
a breach impact, and a gentle heartbeat pulse under the finale. The score is side-chain ducked under the voice,
then the whole mix is loudness-normalised to -14 LUFS / -1 dBTP (YouTube's target) with a 2-pass loudnorm.

Outputs in out/<format>/:  mix.wav (48k stereo 24-bit)  audio.m4a (AAC 320k)  audio.mp3 (320k)  narration_only.mp3
"""
import argparse, json, subprocess
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

ROOT = Path(__file__).resolve().parent.parent
SR = 48000


def env_interp(tl, key, t, default=0.5):
    xs = [c["start"] for c in tl["chapters"]] + [tl["duration"]]
    ys = [c.get(key, default) for c in tl["chapters"]]
    cs = [(c["start"] + c["end"]) / 2 for c in tl["chapters"]]
    return np.interp(t, cs, ys)


def lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x)


def highpass(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def reverb_ir(seconds=2.6, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-t * 2.4)[None, :]
    ir[:, : int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[None, :]
    ir = np.array([lowpass(ir[0], 5500), lowpass(ir[1], 5500)])
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--format", choices=["long", "short"], required=True)
    ap.add_argument("--music", type=float, default=1.0, help="music level multiplier")
    args = ap.parse_args()
    out = ROOT / "out" / args.format
    tl = json.loads((out / "timeline.json").read_text())
    D = tl["duration"]; N = int(D * SR)
    t = np.arange(N) / SR
    rng = np.random.default_rng(11)
    M = tl["marks"]
    short = args.format == "short"

    energy = env_interp(tl, "energy", t)
    energy = lowpass(energy, 0.4, 1)  # smooth

    # ---------------------------------------------------------------- pad: slow-moving Am(add9) cluster with detuned saws
    roots = [55.0, 55.0, 43.65, 49.0]  # A1 A1 F1 G1 progression, 16s per chord
    chord_len = 16.0 if not short else 6.0
    pad = np.zeros((2, N))
    for ci in range(int(np.ceil(D / chord_len)) + 1):
        r = roots[ci % 4]
        a, b = ci * chord_len, (ci + 1) * chord_len
        i0, i1 = int(a * SR), min(int(b * SR), N)
        if i0 >= N: break
        tt = t[i0:i1]
        w = np.minimum(1, (tt - a) / (chord_len * 0.35)) * np.minimum(1, (b - tt) / (chord_len * 0.35))
        for mult, amp in [(1, 1.0), (2, 0.7), (3, 0.35), (2.997, 0.3), (4.0, 0.25), (6.0, 0.12)]:
            for ch, det in ((0, -0.0007), (1, 0.0007)):
                f = r * 2 * mult * (1 + det) * (1 + 0.0015 * np.sin(2 * np.pi * 0.17 * tt + ci))
                pad[ch, i0:i1] += amp * w * np.sin(2 * np.pi * np.cumsum(f) / SR + ci * mult)
    pad = np.array([lowpass(pad[0], 900 + 2200 * 0.5), lowpass(pad[1], 900 + 2200 * 0.5)])
    # energy-controlled brightness: blend a brighter copy in at high energy
    bright = np.array([highpass(pad[0], 400), highpass(pad[1], 400)])
    pad = pad * (0.55 + 0.25 * (1 - energy)) + bright * (0.4 * energy)

    # ---------------------------------------------------------------- sub drone (felt more than heard)
    sub = np.sin(2 * np.pi * np.cumsum(np.full(N, 36.7) * (1 + 0.004 * np.sin(2 * np.pi * 0.05 * t))) / SR) * (0.35 + 0.5 * energy)
    sub = lowpass(sub, 90)

    # ---------------------------------------------------------------- space dust: filtered noise swells
    noise = rng.standard_normal((2, N))
    dust = np.array([highpass(lowpass(noise[0], 7000), 1500), highpass(lowpass(noise[1], 7000), 1500)]) * (0.012 + 0.02 * energy)

    music = pad * 0.20 + sub[None, :] * 0.22 + dust

    # ---------------------------------------------------------------- event sound design
    def add(sig, at, g=1.0, pan=0.0):
        i0 = int(at * SR)
        if i0 >= N or i0 < -len(sig): return
        s0 = max(0, -i0); i0 = max(i0, 0); i1 = min(i0 + len(sig) - s0, N)
        l, r = (1 - pan) / 2 + 0.5, (1 + pan) / 2
        music[0, i0:i1] += sig[s0:s0 + i1 - i0] * g * min(1, 1 - pan * 0.5)
        music[1, i0:i1] += sig[s0:s0 + i1 - i0] * g * min(1, 1 + pan * 0.5)

    def riser(dur, f0=180, f1=2600):
        n = int(dur * SR); tt = np.linspace(0, 1, n)
        nz = rng.standard_normal(n)
        # swept band-pass noise built from two cascaded filters
        out_ = np.zeros(n); blocks = 40; bl = n // blocks
        for k in range(blocks):
            fc = f0 * (f1 / f0) ** (k / blocks)
            seg = nz[k * bl:(k + 1) * bl]
            sos = butter(2, [fc * 0.7, min(fc * 1.4, SR / 2 - 100)], "band", fs=SR, output="sos")
            out_[k * bl:(k + 1) * bl] = sosfilt(sos, seg)
        out_ *= tt ** 2.2
        tone = np.sin(2 * np.pi * np.cumsum(f0 * 0.5 * (f1 / f0) ** tt * 0.5) / SR) * tt ** 3 * 0.25
        return (out_ * 1.6 + tone) * np.minimum(1, (1 - tt) * 40 + 0.0)

    def impact(dur=3.4, f=48):
        n = int(dur * SR); tt = np.arange(n) / SR
        body = np.sin(2 * np.pi * (f + 90 * np.exp(-tt * 9)) * tt) * np.exp(-tt * 1.5)
        click = lowpass(rng.standard_normal(n), 3000) * np.exp(-tt * 40) * 0.5
        return body + click

    def whoosh(dur=3.0):
        n = int(dur * SR); tt = np.linspace(0, 1, n)
        nz = lowpass(rng.standard_normal(n), 2400) * np.sin(np.pi * tt) ** 2
        return highpass(nz, 150)

    def chirp(dur, f0, f1):
        n = int(dur * SR); tt = np.linspace(0, 1, n)
        f = f0 * (f1 / f0) ** (tt ** 0.8)
        ph = 2 * np.pi * np.cumsum(f) / SR
        s = (np.sin(ph) + 0.35 * np.sin(2 * ph)) * np.sin(np.pi * tt) ** 1.5
        return s

    def heartbeat():
        n = int(0.5 * SR); tt = np.arange(n) / SR
        return np.sin(2 * np.pi * 52 * tt) * np.exp(-tt * 14)

    # risers + impacts at the big beats
    for key, rd in (("sun_hit", 3.0), ("cme_launch", 5.0), ("barrier_on", 0), ("chorus_push", 5.0), ("breach", 5.0)):
        if key in M and rd:
            add(riser(rd), M[key] - rd + 0.15, 0.10 if not short else 0.14)
    for key, g in (("sun_hit", 0.55), ("breach", 0.9), ("x5000", 0.45), ("from_within", 0.8)):
        if key in M: add(impact(), M[key], g * (0.9 if not short else 1.1))
    if "cme_hit" in M:
        add(whoosh(3.5), M["cme_hit"] - 1.8, 0.9)
        add(impact(4.0, 40), M["cme_hit"], 0.8)
    if "plasma_crush" in M:
        add(whoosh(2.4)[::-1], M["plasma_crush"] - 1.2, 0.6); add(impact(3.0, 44), M["plasma_crush"], 0.45)
    if "lightning" in M and not short:
        for k in range(14):
            at = M["lightning"] + 0.4 + k * rng.uniform(0.35, 1.1)
            n = int(0.5 * SR); tt = np.arange(n) / SR
            crack = lowpass(rng.standard_normal(n), 1800) * np.exp(-tt * 14)
            add(crack, at, 0.35 * rng.uniform(0.4, 1.0), pan=rng.uniform(-0.6, 0.6))
    # chorus 'birdsong': rising chirps with reverb, in sync with the on-screen waves
    chir = np.zeros((2, N))
    for c in tl.get("chirps", []):
        s = chirp(c["dur"], c["f0"], c["f1"]) * 0.5
        i0 = int(c["t"] * SR); i1 = min(i0 + len(s), N)
        pan = rng.uniform(-0.7, 0.7)
        chir[0, i0:i1] += s[: i1 - i0] * (1 - max(pan, 0)); chir[1, i0:i1] += s[: i1 - i0] * (1 + min(pan, 0))
    ir = reverb_ir()
    wet = np.array([fftconvolve(chir[0], ir[0])[:N], fftconvolve(chir[1], ir[1])[:N]])
    music += (chir * 0.5 + wet * 0.9) * 0.085
    # heartbeat under the finale / breach
    if "breach" in M and not short:
        for bt in np.arange(M["breach"], M["from_within"] + 6, 1.0):
            add(heartbeat(), bt, 0.30); add(heartbeat(), bt + 0.28, 0.2)
    # a soft rising shimmer on the CTA
    if "cta" in M and not short:
        add(riser(4.0, 400, 5000), M["cta"] - 3.5, 0.06)

    # subtle reverb on the whole music bed for width
    music = music + 0.18 * np.array([fftconvolve(music[0], ir[0])[:N], fftconvolve(music[1], ir[1])[:N]])

    # ---------------------------------------------------------------- voice: EQ + compression, centre
    sr0, v = wavfile.read(out / "narration.wav")
    v = v.astype(np.float64)
    if v.ndim > 1: v = v.mean(axis=1)
    v = np.pad(v, (0, max(0, N - len(v))))[:N]
    v = highpass(v, 75, 2)
    v = v + 0.20 * highpass(v, 3000, 2) * 0.5 + 0.12 * lowpass(highpass(v, 140), 320)  # presence + warmth
    # simple feed-forward compressor (RMS envelope, 3:1 above -22 dBFS)
    win = int(0.02 * SR)
    rms = np.sqrt(np.convolve(v ** 2, np.ones(win) / win, mode="same") + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    gr = np.where(db > -22, (db - -22) * (1 - 1 / 3.0), 0.0)
    gr = lowpass(gr, 8, 1)  # attack/release smoothing
    v = v * 10 ** (-gr / 20)
    peak = np.percentile(np.abs(v), 99.9) + 1e-9
    v = v / peak * 0.7

    # side-chain duck of the music by the voice envelope
    ve = np.abs(v); ve = np.maximum.accumulate(np.convolve(ve, np.ones(int(0.05 * SR)) / int(0.05 * SR), mode="same")[::480]) * 0 + np.convolve(ve, np.ones(int(0.05 * SR)) / int(0.05 * SR), mode="same")[::480]
    env = np.interp(np.arange(N), np.arange(len(ve)) * 480, ve)
    env = lowpass(np.clip(env / 0.12, 0, 1), 3.0, 1)
    duck = 1 - 0.62 * np.clip(env, 0, 1)
    music_l = music * duck[None, :] * args.music

    # tiny stereo reverb send on the voice for presence
    vwet = np.array([fftconvolve(v, ir[0])[:N], fftconvolve(v, ir[1])[:N]])
    mix = music_l + np.array([v, v]) + vwet * 0.05

    # fades
    fi, fo = int(1.2 * SR), int(min(5.0, tl.get("tail", 3.0)) * SR)
    mix[:, :fi] *= np.linspace(0, 1, fi)[None, :]
    mix[:, -fo:] *= np.linspace(1, 0, fo)[None, :] ** 1.5
    mix = np.tanh(mix * 0.9) / np.tanh(0.9)  # soft clip any strays
    raw = out / "mix_raw.wav"
    wavfile.write(raw, SR, (mix.T).astype(np.float32))

    # ---------------------------------------------------------------- loudness: 2-pass EBU R128 -> -14 LUFS, -1 dBTP
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(raw), "-af", "loudnorm=I=-14:TP=-1.0:LRA=9:print_format=json", "-f", "null", "-"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    j = json.loads(r.stderr[r.stderr.rindex("{"): r.stderr.rindex("}") + 1])
    af = (f"loudnorm=I=-14:TP=-1.0:LRA=9:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
          f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,aresample=48000")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), "-af", af, "-c:a", "pcm_s24le", str(out / "mix.wav")], check=True)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(out / "mix.wav"), "-c:a", "aac", "-b:a", "320k", str(out / "audio.m4a")], check=True)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(out / "mix.wav"), "-c:a", "libmp3lame", "-b:a", "320k", str(out / "audio.mp3")], check=True)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(out / "narration.wav"), "-af", "loudnorm=I=-16:TP=-1.5", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", str(out / "narration_only.mp3")], check=True)
    raw.unlink()

    chk = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(out / "mix.wav"), "-af", "loudnorm=I=-14:TP=-1.0:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
    jj = json.loads(chk[chk.rindex("{"): chk.rindex("}") + 1])
    print(f"[audio:{args.format}] {D:.1f}s  integrated {float(jj['input_i']):.1f} LUFS  true-peak {float(jj['input_tp']):.1f} dBTP  LRA {float(jj['input_lra']):.1f}")


if __name__ == "__main__":
    main()
