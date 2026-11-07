#!/usr/bin/env node
// Render single frames to JPEG for visual QA:  node scripts/still.mjs <timeline> <profile> <scale> <out_dir> t1 t2 ...
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [tlPath, profile, scaleS, outDir, ...times] = process.argv.slice(2);
const P = { '4k': [3840, 2160], '1080p': [1920, 1080], short: [1080, 1920] }[profile];
const even = (n) => Math.max(2, Math.round(n / 2) * 2), s = parseFloat(scaleS);
const W = even(P[0] * s), H = even(P[1] * s);
const timeline = JSON.parse(fs.readFileSync(tlPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(fs.existsSync);
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 0, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-device-scale-factor=1'] });
const page = await b.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message)); page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.error('console:', m.text().slice(0, 400)); });
await page.goto(`http://127.0.0.1:${server.address().port}/web/index.html`);
await page.evaluate((o) => window.initSim(o), { W, H, timeline, texSize: s < 0.5 ? 1024 : 2048, captions: timeline.format === 'short' });
for (const t of times) { const t0 = Date.now(); await page.evaluate((t) => window.drawFrame(t), parseFloat(t)); const f = path.join(outDir, `f_${String(t).padStart(6, '0')}.jpg`); await page.screenshot({ path: f, type: 'jpeg', quality: 90 }); console.log(f, ((Date.now() - t0) / 1000).toFixed(2) + 's'); }
await b.close(); server.close();
