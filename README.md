# Earth's Supposedly Impenetrable Radiation Barrier Has Been Breached

An 8-minute YouTube explainer, a vertical Short, subtitles and a mastered soundtrack, generated entirely from code:
a **Three.js / WebGL** simulation rendered frame-by-frame in headless Chrome, with narration, sound design and loudness
mastering built by Python, and **GitHub Actions** doing the rendering in parallel.

Based on: Miyoshi et al., *Geophysical Research Letters* (2026), reported by ScienceAlert on 31 Oct 2026.

## Run it on GitHub (no local setup)

1. Create a new GitHub repository and upload everything in this folder (or `git push` it).
2. Open **Actions -> Render video -> Run workflow**.
3. Pick **quality**: `1080p`, `4k`, `shorts` or `all`. Leave the other options on default.
4. When it finishes, download the **final-video-and-audio** artifact. It contains:

| File | What it is |
|---|---|
| `radiation-barrier_1080p.mp4` / `_4k.mp4` | the 8-minute video (H.264, 30 fps, AAC 320 kbps) |
| `radiation-barrier_shorts_9x16.mp4` | the ~52 s Short (1080x1920, captions burned in) |
| `radiation-barrier_shorts.srt`, `radiation-barrier_long.srt` | subtitles, ready for YouTube upload |
| `*-audio.m4a`, `*-audio-master.wav` | final mixed audio (voice + score), -14 LUFS / -1 dBTP |
| `*-narration.mp3` | voice only |
| `youtube_metadata.md` | titles, description, **chapter timestamps**, tags, sources |

Tick **publish_release** to also attach the files to a GitHub Release (handy for files over the artifact UI limits).

### Expected render time and cost

Measured in a 2-core sandbox at the heaviest scene (the breach), with ~14,500 frames for the long video:

| Output | s/frame | CPU time total | Wall clock on Actions (parallel) |
|---|---|---|---|
| 1080p | ~1.15 | ~4.6 h | ~25-30 min (12 jobs) |
| 4K | ~3.1 | ~12.5 h | ~60-70 min (25 jobs, 20 at a time) |
| Short 1080x1920 | ~1.2 | ~17 min | ~16 min (2 jobs) |

Rendering uses software WebGL (SwiftShader) because standard runners have no GPU. Public repositories get unlimited
Actions minutes; on a **private free** repository (2,000 min/month) the 4K render will not fit, so use 1080p or make the repo public.
Output sizes are roughly 1.3 GB (1080p) and 3 GB (4K), since the particle fields are hard to compress.

## Narration voice

`tts = auto` tries, in order: **edge-tts** (Microsoft neural voice, default `en-US-AndrewMultilingualNeural`), **Kokoro**
(offline, open weights), then silent timing-only. Edge-TTS is an unofficial endpoint that GitHub runners can reach; the
sandbox this project was built in could not, so the pre-made audio in `deliverables/` uses Kokoro. If you want one voice
everywhere, pick `kokoro` in the workflow. The speaking rate is auto-fitted so the video lands on ~8:00.

Every on-screen event is tied to the **spoken word** (marks in `content/*.json`), so changing the script or voice re-times
the whole video automatically.

## Run locally

```bash
npm ci
pip install numpy scipy edge-tts kokoro-onnx     # plus ffmpeg and Google Chrome on PATH
python3 scripts/build_timeline.py --format long  # narration + timeline + SRT -> out/long/
python3 scripts/build_audio.py    --format long  # score + mix + loudness master
npm test                                         # storyboard sanity checks
node scripts/still.mjs out/long/timeline.json 1080p 1 out/stills 20 150 360   # preview single frames
node scripts/render_chunk.mjs --timeline out/long/timeline.json --profile 1080p --start 355 --end 365 --out out/test.mp4
python3 scripts/plan_chunks.py --quality 1080p   # the matrix the Action uses
python3 scripts/assemble.py --format long --profile 1080p --chunks chunks --out final/video.mp4
```

## What is in the simulation

- **Particles**: ~25,000 point sprites following guiding-centre motion in a dipole field (bounce along the field line,
  drift around Earth; protons and electrons drift in opposite directions). Orange = inner-belt protons, blue = outer-belt
  electrons, white = killer electrons, magenta = locally accelerated electrons inside the barrier.
- **Storm physics (stylised)**: field compressed on the day side and stretched on the night side, Shue-type magnetopause,
  solar-wind flow lines around the magnetopause, a CME cloud, the plasmasphere shell collapsing to ~2 Re, auroral ovals.
- **The barrier**: a shell at L ~ 2.8 that visibly cracks as the breach progresses.
- **Arase**: a Kepler orbit (perigee ~440 km, apogee ~32,100 km altitude, ~31 deg inclination), with chorus-wave
  arcs whose timing matches the "birdsong" chirps in the audio.
- **Earth**: generated procedurally (no downloaded imagery), so renders are deterministic and portable.

Every frame is a pure function of time, so chunks rendered on different machines stitch together seamlessly.

## Honest notes

- It is a **scientific visualisation, not to scale** (the on-screen label says so). Shapes and speeds are illustrative.
- Facts in the script come from the ScienceAlert report, the Nagoya/Arase papers and abstracts, the 2014 *Nature* paper
  and NASA/CU Boulder CIRBE coverage. The Arase orbital numbers and the Earth-radius figures are standard values from memory,
  not re-checked against a source. Re-read the script (`content/long.json`) before publishing.
- The soundtrack is synthesised from scratch, so there is no music licensing to worry about.

## Layout

```
content/       narration script + marks (long.json, short.json)
scripts/       build_timeline.py (TTS/SRT/timeline), build_audio.py (score, mix, loudness), render_chunk.mjs,
               plan_chunks.py, assemble.py, make_metadata.py, still.mjs, selftest.mjs
web/           Three.js scene: scene.js, shaders.js, tracks.js (storyboard), hud.js, earthtex.js
.github/workflows/render.yml
```
