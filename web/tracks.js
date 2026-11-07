// Storyboard: keyframe tracks for camera + scene parameters, anchored to chapters (C) and narration marks (M),
// so every visual beat lands on the spoken word regardless of how long the voice takes.
import { clamp, lerp } from './noise.js';

export const DEFAULTS = {
  az: 30, el: 15, dist: 16, tx: 0, ty: 0, tz: 0, fov: 40,
  vIn: 0, vOut: 0, vKill: 0, vAcc: 0,
  plL: 5.0, plA: 0, barA: 0, breach: 0, storm: 0, aurora: 0,
  cmeX: 230, cmeA: 0, windA: 0, sunA: 0, fieldA: 0, mpA: 0, chorusA: 0, araA: 0, lightning: 0, fade: 1,
};
const CLAMP01 = new Set(['vIn', 'vOut', 'vKill', 'vAcc', 'plA', 'barA', 'breach', 'storm', 'aurora', 'cmeA', 'windA', 'sunA', 'fieldA', 'mpA', 'chorusA', 'araA', 'lightning', 'fade']);

// Piecewise cubic Hermite with monotone (PCHIP) tangents: smooth, no overshoot.
function makeTrack(kfs) {
  if (!kfs.length) return () => 0;
  const k = kfs.slice().sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < k.length; i++) if (k[i][0] <= k[i - 1][0]) k[i][0] = k[i - 1][0] + 1e-3;
  const n = k.length, m = new Array(n).fill(0);
  if (n > 2) {
    const h = [], d = [];
    for (let i = 0; i < n - 1; i++) { h.push(k[i + 1][0] - k[i][0]); d.push((k[i + 1][1] - k[i][1]) / h[i]); }
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
  }
  return (t) => {
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[n - 1][0]) return k[n - 1][1];
    let i = 0; while (t > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0], s = (t - k[i][0]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * k[i][1] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * k[i + 1][1] + (s3 - s2) * h * m[i + 1];
  };
}

export function buildSampler(tl) {
  const C = (id, u = 0) => {
    const c = tl.chapters.find((c) => c.id === id);
    if (!c) throw new Error('unknown chapter ' + id);
    return c.start + (c.end - c.start) * u;
  };
  const M = (name, off = 0) => {
    if (!(name in tl.marks)) throw new Error('unknown mark ' + name);
    return tl.marks[name] + off;
  };
  const D = tl.duration;
  const spec = tl.format === 'short' ? shortTracks(C, M, D, tl) : longTracks(C, M, D, tl);
  const tracks = {};
  for (const [name, kfs] of Object.entries(spec)) tracks[name] = makeTrack(kfs);

  // beat-synchronous flicker for lightning flashes
  const flick = (t) => { const f = Math.floor(t * 7); const h = Math.abs(Math.sin(f * 12.9898) * 43758.5453) % 1; return h > 0.62 ? 1 : 0.15; };

  return {
    sample(t) {
      const st = { ...DEFAULTS };
      for (const name in tracks) {
        let v = tracks[name](t);
        if (CLAMP01.has(name)) v = clamp(v, 0, 1);
        st[name] = v;
      }
      st.lightning *= flick(t);
      return st;
    },
  };
}

// ============================================================================ LONG (16:9, ~8 minutes)
function longTracks(C, M, D, tl) {
  const hookEnd = C('hook', 1), bn = M('barrier_named'), sh = M('sun_hit'), te = M('teaser_end');
  const cl = M('cme_launch'), ch = M('cme_hit'), pc = M('plasma_crush'), au = M('aurora');
  const tlc = tl.callouts.find((c) => c.kind === 'timeline');
  const s0 = tlc ? tlc.start : M('months'), e0 = tlc ? tlc.end - 7 : M('months', 25);
  const mid = (a, b, f) => lerp(a, b, f);
  const fo = hookEnd - 3.2; // reset to a calm Earth just before chapter 2

  return {
    fade: [[0, 0], [1.4, 1], [D - 3.0, 1], [D - 0.3, 0]],

    // ------------------------------------------------------------------ camera
    az: [[0, 62], [C('hook', .5), 40], [hookEnd, 30],
         [C('belts', .5), -25], [C('belts', 1), -62],
         [C('killer', 0), -62], [C('killer', 1), -97],
         [C('barrier', 1), -150], [C('doubt', 1) - 1, -214],
         [cl + 1.5, 100], [ch, 78], [pc, 36], [C('storm', 1), 12],
         [M('chorus_on', 0), -68], [C('chorus', 1), -98],
         [M('x5000'), -132], [M('from_within'), -172], [C('breach', 1), -212],
         [C('aftermath', 1), -265], [C('outro', 1), -335]],
    el: [[0, 18], [C('hook', .5), 12], [hookEnd, 14],
         [M('inner_belt'), 10], [M('outer_belt'), 22], [M('slot', 2), 8], [C('belts', 1), 12],
         [C('killer', .5), 5], [C('killer', 1), 10],
         [M('barrier_on'), 16], [C('barrier', 1), 20], [C('doubt', 1) - 1, 12],
         [cl + 1.5, 6], [ch, 16], [pc, 20], [C('storm', 1), 17],
         [M('chorus_on', 0), 42], [C('chorus', 1), 38],
         [M('breach'), 14], [M('from_within'), 10], [C('breach', 1), 18],
         [C('aftermath', 1), 14], [C('outro', 1), 20]],
    dist: [[0, 34], [bn - 6, 17], [sh + 2, 13.5], [hookEnd, 11],
           [M('inner_belt', -1), 8.4], [M('inner_belt', 6), 8.8], [M('outer_belt', -1), 14], [M('slot', 3), 13], [C('belts', 1), 11.5],
           [M('killer_on'), 7.2], [C('killer', 1), 8.6],
           [M('barrier_on', -1), 8.6], [M('barrier_on', 4), 7.4], [C('barrier', 1), 9.2],
           [C('doubt', 1) - 1, 13.5],
           [cl + 1.5, 85], [cl + 10, 95], [ch - 6, 70], [ch + 1.5, 26], [pc - 2, 18], [pc + 8, 12.5], [C('storm', 1), 12],
           [C('chorus', .35), 9.8], [C('chorus', 1), 10.2],
           [M('breach'), 8.6], [M('x5000'), 7.8], [M('from_within', -1), 7.4], [M('from_within', 4), 14], [C('breach', 1), 15.5],
           [C('aftermath', 0), 15], [C('aftermath', 1), 13.5], [C('outro', 0), 13.5], [C('outro', 1), 23]],
    tx: [[0, 0], [C('doubt', 1) - 1, 0], [cl + 1.5, 248], [cl + 10, 175], [ch - 6, 60], [ch + 3, 0]],
    fov: [[0, 40], [ch, 40], [ch + 2, 40]],

    // ------------------------------------------------------------------ Earth's fields
    fieldA: [[1.5, 0], [7, 0.7], [hookEnd, 0.5], [C('belts', 1), 0.35], [ch, 0.45], [C('aftermath', 1), 0.35], [C('outro', 1), 0.5]],
    vIn: [[Math.max(bn - 10, 2), 0], [bn - 3, 1], [fo, 1], [fo + 2.6, 0], [M('inner_belt', -0.3), 0], [M('inner_belt', 2.8), 1]],
    vOut: [[Math.max(bn - 10, 2), 0], [bn - 3, 1], [fo, 1], [fo + 2.6, 0], [M('outer_belt', -0.3), 0], [M('outer_belt', 2.8), 1],
           [ch + 2, 1], [pc - 2, 0.28], [M('chorus_on'), 0.30], [M('breach'), 0.5], [C('aftermath', .5), 0.85], [C('outro', 0), 1]],
    vKill: [[bn + 1, 0], [bn + 4, 1], [fo, 1], [fo + 2.6, 0],
            [M('killer_on', -1), 0], [M('killer_on', 3), 1], [ch + 2, 1], [pc - 2, 0.25], [M('chorus_on'), 0.3], [M('breach'), 0.45], [C('aftermath', .5), 0.85], [C('outro', 0), 1]],
    vAcc: [[te - 1, 0], [te + 1.5, 0.75], [fo, 0.75], [fo + 2.6, 0],
           [M('chorus_push', -1), 0], [M('chorus_push', 5), 0.2], [M('breach', -1), 0.22], [M('breach', 6), 0.55], [M('x5000', 2), 0.8], [M('stagger', 10), 1.0],
           [C('breach', 1), 1.0], [s0, 1.0], [mid(s0, e0, .5), 0.55], [mid(s0, e0, .9), 0.22], [e0, 0.1], [C('outro', 0), 0.1], [C('outro', 1), 0.06]],

    barA: [[bn - 0.2, 0], [bn + 2.5, 0.85], [fo, 0.85], [fo + 2.6, 0],
           [M('barrier_on', -1), 0], [M('barrier_on', 2.5), 0.9], [C('doubt', 1), 0.6],
           [ch + 2, 0.7], [C('chorus', 1), 0.7], [M('breach'), 0.9], [C('aftermath', 1), 0.8], [C('outro', 1), 0.6]],
    breach: [[te - 1, 0], [te + 2, 0.5], [fo, 0.4], [fo + 2.6, 0],
             [M('doubt_2018'), 0], [M('lightning'), 0.12], [C('doubt', 1), 0.08], [C('storm', 1), 0.08],
             [M('breach'), 0.0], [M('x5000'), 0.25], [M('stagger', 8), 0.55], [M('from_within'), 0.7], [M('from_within', 5), 1.0],
             [s0, 1.0], [e0, 0.7], [C('outro', 0), 0.5], [C('outro', 1), 0.25]],

    // ------------------------------------------------------------------ solar storm
    sunA: [[cl - 0.4, 0], [cl + 1, 1], [ch - 5, 1], [ch - 1, 0]],
    cmeA: [[sh - 0.5, 0], [sh + 1, 1], [te - 2, 1], [te + 2, 0],
           [cl + 0.2, 0], [cl + 2, 1], [ch + 12, 1], [au + 8, 0.25], [pc + 6, 0], [e0 - 2.5, 0], [e0 - 1.5, 0.6], [e0 + 4, 0]],
    cmeX: [[sh - 0.5, 125], [te - 1, 14], [cl, 232], [mid(cl, ch, .5), 123], [ch, 14], [e0 - 2.5, 120], [e0 - 0.5, 14]],
    windA: [[sh, 0], [sh + 3, 0.7], [fo, 0.7], [fo + 2.6, 0], [ch - 3, 0], [ch + 2, 1], [C('chorus', 0), 0.6], [M('breach'), 0.35], [C('aftermath', 1), 0.3], [C('outro', 0.5), 0]],
    storm: [[sh + 3, 0], [te - 1, 0.8], [fo, 0.8], [fo + 2.6, 0], [ch - 0.5, 0], [ch + 5, 1], [C('chorus', .3), 0.9], [M('chorus_push'), 0.6], [M('breach'), 0.35], [C('breach', 1), 0.2],
            [C('aftermath', .3), 0.1], [e0 - 2.5, 0.08], [e0 - 0.3, 0.55], [e0 + 3, 0.2], [C('outro', 0.4), 0]],
    mpA: [[sh + 1, 0], [sh + 4, 0.5], [fo, 0.4], [fo + 2.6, 0], [ch - 4, 0], [ch + 1, 0.55], [pc + 4, 0.3], [M('arase'), 0.0]],
    aurora: [[sh + 3, 0], [te, 0.8], [fo, 0.6], [fo + 2.6, 0], [ch + 1, 0], [au + 2, 1], [M('chorus_on'), 0.8], [M('breach'), 0.5], [C('aftermath', .3), 0.2], [C('aftermath', 1), 0.05]],
    plA: [[pc - 3, 0], [pc + 0.5, 0.75], [C('aftermath', .5), 0.7], [C('outro', 0), 0.45], [C('outro', .6), 0]],
    plL: [[pc - 3, 5.6], [pc, 5.4], [pc + 9, 2.0], [C('aftermath', .5), 2.2], [C('outro', .1), 3.4], [C('outro', .6), 5.0]],
    lightning: [[M('lightning', -0.5), 0], [M('lightning', 0.5), 1], [M('lightning', 9), 1], [M('lightning', 11), 0]],

    // ------------------------------------------------------------------ Arase + chorus
    araA: [[M('arase', -1), 0], [M('arase', 1.5), 1], [C('breach', 1), 1], [C('aftermath', .25), 0]],
    chorusA: [[M('chorus_on', -1), 0], [M('chorus_on', 1.5), 1], [C('breach', .7), 1], [C('aftermath', .15), 0]],
  };
}

// ============================================================================ SHORT (9:16, ~52 s)
function shortTracks(C, M, D, tl) {
  const bn = M('barrier_named'), sh = M('sun_hit'), bo = M('barrier_on'), ch = M('cme_hit'), pc = M('plasma_crush');
  const co = M('chorus_on'), x5 = M('x5000'), fw = M('from_within');
  const bEnd = C('barrier', 1), sEnd = C('storm', 1), brEnd = C('breach', 1), hEnd = C('hook', 1);
  return {
    fade: [[0, 0], [0.5, 1], [D - 1.6, 1], [D - 0.2, 0]],
    az: [[0, 48], [hEnd, 18], [bEnd, -75], [ch, 80], [pc, 40], [sEnd, 15], [co, -70], [fw, -150], [brEnd, -200], [D, -260]],
    el: [[0, 16], [hEnd, 12], [bEnd, 14], [ch, 14], [sEnd, 18], [co, 36], [fw, 12], [brEnd, 20], [D, 18]],
    dist: [[0, 34], [bn, 20], [hEnd, 16], [bEnd, 9.5], [ch, 22], [pc, 15], [sEnd, 13], [co, 10], [x5, 6.6], [fw - 0.5, 6.2], [brEnd, 14], [D, 22]],
    fieldA: [[0, 0.3], [2, 0.7], [D, 0.45]],
    vIn: [[0.4, 0], [2.0, 1], [hEnd - 0.5, 1], [hEnd + 1.5, 1]],
    vOut: [[0.4, 0], [2.0, 1], [ch + 1, 1], [pc, 0.3], [co, 0.35], [brEnd, 0.6], [D, 1]],
    vKill: [[bn, 0], [bn + 2, 1], [ch + 1, 1], [pc, 0.3], [co, 0.35], [brEnd, 0.6], [D, 1]],
    vAcc: [[sh + 1, 0], [sh + 2.2, 0.5], [hEnd, 0], [co, 0], [x5 - 1, 0.45], [x5 + 1.5, 0.85], [fw, 1], [brEnd, 1], [D, 0.3]],
    barA: [[bn, 0], [bn + 1.5, 0.85], [hEnd + 0.5, 0.0], [bo - 0.5, 0], [bo + 1.2, 0.9], [D, 0.7]],
    breach: [[sh + 1, 0], [sh + 2.3, 0.5], [hEnd, 0], [co, 0], [x5, 0.35], [fw, 0.8], [fw + 3, 1], [D, 0.5]],
    sunA: [],
    cmeA: [[sh, 0], [sh + 0.6, 1], [sh + 2.5, 0], [ch - 0.2, 0], [ch + 0.3, 1], [pc + 3.5, 0.2], [sEnd + 1, 0]],
    cmeX: [[sh, 110], [sh + 2.2, 14], [ch - 0.2, 90], [ch + 2.5, 14]],
    windA: [[sh, 0], [sh + 1, 0.7], [hEnd, 0], [ch, 0], [ch + 1, 1], [co, 0.4], [D, 0.1]],
    storm: [[sh + 0.5, 0], [sh + 2.2, 0.7], [hEnd + 0.5, 0], [ch, 0], [ch + 2.5, 1], [co, 0.7], [fw, 0.35], [D, 0]],
    mpA: [[ch, 0], [ch + 1, 0.55], [pc + 3, 0.3], [co, 0]],
    aurora: [[sh + 1, 0], [sh + 2.2, 0.7], [hEnd, 0], [ch + 0.5, 0], [ch + 2.5, 1], [co, 0.8], [D, 0.2]],
    plA: [[pc - 1, 0], [pc + 0.5, 0.75], [brEnd, 0.6], [D, 0.0]],
    plL: [[pc - 1, 5.6], [pc, 5.4], [pc + 5, 2.0], [D - 3, 2.4], [D, 4.0]],
    araA: [[co - 0.5, 0], [co + 0.6, 1], [brEnd, 1], [brEnd + 1, 0]],
    chorusA: [[co - 0.3, 0], [co + 0.8, 1], [brEnd, 1], [brEnd + 1, 0]],
  };
}
