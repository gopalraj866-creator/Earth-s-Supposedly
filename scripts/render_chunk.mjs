#!/usr/bin/env node
// Render a time range of the simulation to an .mp4 chunk (video only, no audio).
//   node scripts/render_chunk.mjs --timeline out/long/timeline.json --profile 1080p --start 0 --end 30 --out out/chunks/c000.mp4
// Profiles: 4k (3840x2160), 1080p (1920x1080), short (1080x1920). --scale shrinks the output for quick tests.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const PROFILES = { '4k': [3840, 2160, 2048], '1080p': [1920, 1080, 2048], short: [1080, 1920, 2048] };
const profile = args.profile || '1080p';
if (!PROFILES[profile]) throw new Error('unknown profile ' + profile);
const scale = parseFloat(args.scale || '1');
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const W = even(PROFILES[profile][0] * scale), H = even(PROFILES[profile][1] * scale);
const texSize = parseInt(args.tex || (scale < 0.5 ? 1024 : PROFILES[profile][2]));
const timeline = JSON.parse(fs.readFileSync(path.resolve(args.timeline), 'utf8'));
const FPS = timeline.fps;
const t0 = parseFloat(args.start ?? 0), t1 = Math.min(parseFloat(args.end ?? timeline.duration), timeline.duration);
const f0 = Math.round(t0 * FPS), f1 = Math.round(t1 * FPS);
const out = path.resolve(args.out);
// quality/size trade-off: constant-quality with a rate cap (particle fields are noisy and otherwise balloon in size).
const RATE = { '4k': ['21', '50M', '50M'], '1080p': ['19', '20M', '20M'], short: ['19', '20M', '20M'] }[profile];
const crf = args.crf || RATE[0];
const jpegQ = parseInt(args.jpeg || '92');
const captions = args.captions === 'true' || (args.captions === undefined && timeline.format === 'short');
fs.mkdirSync(path.dirname(out), { recursive: true });

// tiny static server so ES modules + importmap work (file:// does not allow module imports)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const chromePath = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({
  executablePath: chromePath, headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--disable-gpu-vsync', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none', '--allow-file-access-from-files'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  protocolTimeout: 0,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/web/index.html`, { waitUntil: 'load' });
const t_init = Date.now();
const info = await page.evaluate((o) => window.initSim(o), { W, H, timeline, texSize, captions });
console.log(`[render] ${profile} ${W}x${H} frames ${f0}-${f1} (${(t1 - t0).toFixed(1)}s) tex ${texSize} captions=${captions} init ${((Date.now() - t_init) / 1000).toFixed(1)}s | ${info.gl}`);

const tmp = out.replace(/\.mp4$/, '') + '.partial.mp4';
const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
  '-c:v', 'libx264', '-preset', args.preset || 'veryfast', '-crf', crf, '-maxrate', RATE[1], '-bufsize', RATE[2], '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-movflags', '+faststart',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-tune', 'film', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res, rej) => { ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))); ff.stdin.on('error', () => {}); });

const started = Date.now();
for (let f = f0; f < f1; f++) {
  await page.evaluate((t) => window.drawFrame(t), f / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: jpegQ, optimizeForSpeed: true });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  const n = f - f0 + 1;
  if (n % 10 === 0 || f === f1 - 1) {
    const el = (Date.now() - started) / 1000;
    process.stdout.write(`\r[render] ${n}/${f1 - f0} frames  ${(el / n).toFixed(2)} s/frame  eta ${(((f1 - f0 - n) * el) / n / 60).toFixed(1)} min   `);
  }
}
ff.stdin.end();
await ffDone;
fs.renameSync(tmp, out);
await browser.close(); server.close();
console.log(`\n[render] wrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
