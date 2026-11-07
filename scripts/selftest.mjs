// Sanity-check the storyboard: every track must be finite and every mark/chapter must exist, for both formats.
import fs from 'node:fs';
import { buildSampler } from '../web/tracks.js';
let bad = 0;
for (const fmt of ['long', 'short']) {
  const p = new URL(`../out/${fmt}/timeline.json`, import.meta.url);
  if (!fs.existsSync(p)) { console.log(`skip ${fmt} (no timeline)`); continue; }
  const tl = JSON.parse(fs.readFileSync(p, 'utf8'));
  const s = buildSampler(tl);
  let n = 0;
  for (let t = 0; t <= tl.duration; t += 0.25) {
    const st = s.sample(t); n++;
    for (const [k, v] of Object.entries(st)) if (!Number.isFinite(v)) { console.log(`NaN ${fmt} ${k} @${t}`); bad++; }
  }
  const ends = tl.chapters.every((c, i) => i === 0 ? c.start === 0 : Math.abs(c.start - tl.chapters[i - 1].end) < 1e-6);
  const srtOk = tl.cues.every((c) => c.end > c.start);
  console.log(`${fmt}: ${n} samples ok, chapters contiguous=${ends}, cues valid=${srtOk}, duration ${tl.duration}s, engine ${tl.engine}`);
  if (!ends || !srtOk) bad++;
}
process.exit(bad ? 1 : 0);
