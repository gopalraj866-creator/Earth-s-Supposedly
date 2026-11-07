#!/usr/bin/env python3
"""Write YouTube title / description / chapters / tags from the final timeline.  -> out/long/youtube_metadata.md"""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
tl = json.loads((ROOT / "out" / "long" / "timeline.json").read_text())

def ts(t):
    t = int(round(t)); h, r = divmod(t, 3600); m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

names = {"hook": "The impossible breach", "belts": "Earth's invisible donuts: the Van Allen belts", "killer": "Killer electrons",
         "barrier": "The impenetrable barrier (2014)", "doubt": "Cracks in the wall", "storm": "The May 2024 superstorm",
         "chorus": "The birdsong waves", "breach": "The breach: 5,000x more electrons", "aftermath": "What this means",
         "outro": "The wall that wasn't"}
chapters = "\n".join(f"{ts(0 if i == 0 else c['first_sentence'] - 0.5)} {names[c['id']]}" for i, c in enumerate(tl["chapters"]))
md = f"""# YouTube upload kit

## Title options
1. Earth's "Impenetrable" Radiation Barrier Was Just Breached (Real Simulation)
2. The Wall Around Earth That Nothing Could Cross... Until Now
3. Killer Electrons Got Inside Earth's Impenetrable Barrier

## Description
In May 2024 the strongest solar storm in two decades hit Earth. Japan's Arase satellite then saw something scientists thought was impossible: ultra-relativistic "killer electrons" accelerated inside the so-called impenetrable barrier of the Van Allen radiation belts, with flux at ~3 MeV rising by more than 5,000 times.

This video explains the barrier, the storm, the plasmasphere collapse, and the birdsong-like chorus waves that did it, using a Three.js physics-inspired simulation (dipole-field particle motion, Shue-style magnetopause, solar-wind flow, a Kepler orbit for Arase). The visuals are a scientific visualisation and not to scale.

CHAPTERS
{chapters}

SOURCES
- Miyoshi et al., Geophysical Research Letters (2026), doi:10.1029/2026GL125879
- ScienceAlert, "Earth's Supposedly Impenetrable Radiation Barrier Has Been Breached", 31 Oct 2026
- Baker et al., "An impenetrable barrier to ultrarelativistic electrons in the Van Allen radiation belts", Nature (2014), doi:10.1038/nature13956
- Ozeke et al., Nature Communications (2018), doi:10.1038/s41467-018-04162-3
- Li et al., CIRBE new radiation belts, JGR Space Physics (Feb 2025)
- Shinbori et al. (Nagoya University), plasmasphere collapse during the May 2024 storm

Upload the .srt file under Subtitles -> Add -> Upload file -> With timing.

## Tags
Van Allen belts, radiation belt, solar storm, May 2024 geomagnetic storm, Arase satellite, killer electrons, space weather, impenetrable barrier, magnetosphere, plasmasphere, chorus waves, Nagoya University, space science, three.js simulation

## Shorts caption
Earth's "impenetrable" radiation barrier just got breached. #space #science #solarstorm #vanallenbelts
"""
(ROOT / "out" / "long" / "youtube_metadata.md").write_text(md)
print(md[md.index("CHAPTERS"): md.index("SOURCES")])
