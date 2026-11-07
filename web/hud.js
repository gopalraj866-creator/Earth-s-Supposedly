// DOM overlay: chapter cards, callouts, timeline bar, captions (shorts), credits and the fade to black.
// All sizes are in vh/vw-relative units so the same layout works at 4K, 1080p and 9:16.
import { clamp } from './noise.js';

const ease = (x) => x * x * (3 - 2 * x);
const pulse = (t, a, b, fi, fo) => ease(clamp((t - a) / fi, 0, 1)) * ease(clamp((b - t) / fo, 0, 1));

export function createHud(root, tl, opts) {
  const portrait = opts.H > opts.W, u = opts.H / 100; // u = 1% of height in px
  const accent = '#6fd3ff', warn = '#ffb347';
  root.innerHTML = '';
  const css = (el, s) => Object.assign(el.style, s);
  const mk = (parent, s, html = '') => { const e = document.createElement('div'); css(e, s); e.innerHTML = html; parent.appendChild(e); return e; };

  const vignette = mk(root, { position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' });

  // chapter card
  const card = mk(root, portrait
    ? { position: 'absolute', left: '7vw', right: '7vw', top: `${u * 9}px`, opacity: 0 }
    : { position: 'absolute', left: `${u * 7}px`, bottom: `${u * 11}px`, maxWidth: '62vw', opacity: 0 });
  const bar = mk(card, { width: `${u * 7}px`, height: `${Math.max(2, u * 0.45)}px`, background: accent, marginBottom: `${u * 1.6}px`, boxShadow: `0 0 ${u * 2}px ${accent}` });
  const cTitle = mk(card, { fontWeight: 800, letterSpacing: '0.06em', fontSize: `${portrait ? u * 3.4 : u * 5.6}px`, lineHeight: 1.05, textShadow: `0 ${u * 0.3}px ${u * 2}px rgba(0,0,0,.8)` });
  const cSub = mk(card, { fontWeight: 500, letterSpacing: '0.12em', fontSize: `${portrait ? u * 1.7 : u * 2.5}px`, color: accent, marginTop: `${u * 1.1}px`, textShadow: `0 0 ${u * 1.5}px rgba(0,0,0,.9)` });

  // callout (stat / note)
  const call = mk(root, portrait
    ? { position: 'absolute', left: '7vw', right: '7vw', top: `${u * 22}px`, opacity: 0 }
    : { position: 'absolute', right: `${u * 7}px`, top: `${u * 12}px`, textAlign: 'right', opacity: 0 });
  const callMain = mk(call, { fontWeight: 800, fontSize: `${portrait ? u * 6.2 : u * 8}px`, lineHeight: 1, letterSpacing: '0.02em', textShadow: `0 0 ${u * 3}px rgba(111,211,255,.55), 0 ${u * 0.3}px ${u * 2}px #000` });
  const callSub = mk(call, { fontWeight: 500, letterSpacing: '0.1em', fontSize: `${portrait ? u * 1.7 : u * 2.2}px`, color: accent, marginTop: `${u * 0.8}px`, textShadow: '0 0 12px #000' });

  // timeline bar (May -> Oct 2024)
  const tlw = mk(root, { position: 'absolute', left: portrait ? '9vw' : '18vw', right: portrait ? '9vw' : '18vw', top: `${u * (portrait ? 30 : 17)}px`, opacity: 0 });
  const tlLine = mk(tlw, { height: `${Math.max(3, u * 0.7)}px`, background: 'rgba(255,255,255,.22)', borderRadius: '99px', position: 'relative' });
  const tlFill = mk(tlLine, { position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%', background: `linear-gradient(90deg, ${warn}, ${accent})`, borderRadius: '99px', boxShadow: `0 0 ${u * 1.5}px ${accent}` });
  const tlLabels = mk(tlw, { display: 'flex', justifyContent: 'space-between', marginTop: `${u * 1.2}px`, fontWeight: 700, letterSpacing: '0.1em', fontSize: `${u * (portrait ? 1.7 : 2.2)}px` });
  const tlA = mk(tlLabels, {}), tlB = mk(tlLabels, { color: accent });
  const tlNote = mk(tlw, { textAlign: 'center', marginTop: `${u * 1.2}px`, fontSize: `${u * (portrait ? 1.5 : 1.9)}px`, letterSpacing: '0.12em', color: '#cfe8ff' }, 'EXTRA RADIATION LINGERS FOR MONTHS');

  // captions (burned-in; used for shorts)
  const cap = mk(root, { position: 'absolute', left: '6vw', right: '6vw', bottom: `${portrait ? u * 17 : u * 6}px`, textAlign: 'center', fontWeight: 800, fontSize: `${portrait ? u * 3.3 : u * 3.6}px`, lineHeight: 1.22, textShadow: `0 0 ${u * 0.8}px #000, 0 ${u * 0.3}px ${u * 1.2}px #000, 0 0 ${u * 2.5}px #000`, opacity: 0, WebkitTextStroke: `${Math.max(1, u * 0.18)}px rgba(0,0,0,.85)`, paintOrder: 'stroke fill' });

  // credits
  const credits = mk(root, { position: 'absolute', left: `${u * 4}px`, right: `${u * 4}px`, bottom: `${portrait ? u * 22 : u * 5}px`, textAlign: 'center', fontSize: `${u * (portrait ? 1.35 : 1.7)}px`, lineHeight: 1.5, color: 'rgba(220,235,255,.85)', letterSpacing: '0.04em', opacity: 0 },
    'Sources: Miyoshi et al., <i>Geophysical Research Letters</i> (2026)  ·  Baker et al., <i>Nature</i> (2014)  ·  Ozeke et al., <i>Nature Communications</i> (2018)<br>JAXA Arase (ERG) mission  ·  NASA Van Allen Probes  ·  NASA / CU Boulder CIRBE  ·  ScienceAlert, 31 Oct 2026');
  const note = mk(root, { position: 'absolute', right: `${u * 3}px`, top: `${u * 2.5}px`, fontSize: `${u * 1.4}px`, letterSpacing: '0.12em', color: 'rgba(255,255,255,.4)' }, 'SCIENTIFIC VISUALISATION · NOT TO SCALE');

  const fade = mk(root, { position: 'absolute', inset: 0, background: '#000', opacity: 1 });

  const burn = opts.captions;
  const outro = tl.chapters[tl.chapters.length - 1];

  return function update(t, st) {
    // chapter card
    const ch = tl.chapters.find((c) => t >= c.start && t < c.end) || tl.chapters[tl.chapters.length - 1];
    const a0 = Math.max(ch.first_sentence - 0.6, ch.start), shown = Math.min(a0 + (portrait ? 3.4 : 5.2), ch.end - 0.2);
    const ca = pulse(t, a0, shown, 0.7, 0.8) * (ch.id === 'outro' && tl.format === 'long' && !ch.title ? 0 : 1);
    cTitle.textContent = ch.title; cSub.textContent = ch.subtitle || '';
    card.style.opacity = ca; card.style.transform = `translateY(${(1 - ca) * u * 1.2}px)`;
    bar.style.width = `${u * 7 * ca}px`;

    // callouts
    const cs = tl.callouts.filter((c) => t >= c.start - 0.01 && t <= c.end + 0.3 && c.kind !== 'timeline');
    const c = cs[cs.length - 1];
    if (c) {
      const a = pulse(t, c.start, c.end, 0.5, 0.7);
      const stat = c.kind === 'stat';
      callMain.textContent = c.text; callSub.textContent = c.sub || '';
      callMain.style.fontSize = `${(portrait ? u * 6.2 : u * 8) * (stat ? 1 : 0.5)}px`;
      callMain.style.color = stat ? '#fff' : accent;
      call.style.opacity = a; call.style.transform = `translateY(${(1 - a) * -u * 1.5}px)`;
    } else call.style.opacity = 0;

    const tc = tl.callouts.find((x) => x.kind === 'timeline');
    if (tc) {
      const end = tc.end - 7, a = pulse(t, tc.start, tc.end, 0.8, 1.2);
      tlw.style.opacity = a; tlFill.style.width = `${clamp((t - tc.start) / (end - tc.start), 0, 1) * 100}%`;
      tlA.textContent = tc.text; tlB.textContent = tc.sub;
    } else tlw.style.opacity = 0;

    if (burn) {
      const q = tl.cues.find((x) => t >= x.start && t <= x.end + 0.12);
      if (q) { cap.innerHTML = q.lines.join('<br>').replace(/&/g, '&amp;'); cap.style.opacity = 1; } else cap.style.opacity = 0;
    } else cap.style.opacity = 0;

    credits.style.opacity = pulse(t, tl.duration - (portrait ? 5.5 : 12), tl.duration - 1.2, 1.0, 0.8);
    note.style.opacity = t < 6 ? 0 : 1;
    vignette.style.opacity = 1;
    fade.style.opacity = 1 - st.fade;
  };
}
