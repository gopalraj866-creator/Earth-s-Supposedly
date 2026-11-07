// Seeded PRNG + 3D value noise / fbm. Everything in the scene is deterministic so that
// separate render jobs (chunks) produce frames that stitch together seamlessly.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  const rnd = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VAL[i] = rnd();
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const h = (a, b, c) => VAL[PERM[PERM[PERM[X + a] + Y + b] + Z + c]];
  const x00 = h(0, 0, 0) + u * (h(1, 0, 0) - h(0, 0, 0));
  const x10 = h(0, 1, 0) + u * (h(1, 1, 0) - h(0, 1, 0));
  const x01 = h(0, 0, 1) + u * (h(1, 0, 1) - h(0, 0, 1));
  const x11 = h(0, 1, 1) + u * (h(1, 1, 1) - h(0, 1, 1));
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

export function fbm3(x, y, z, oct = 5, lac = 2.0, gain = 0.5) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return s / norm;
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
