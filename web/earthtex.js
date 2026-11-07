// Procedural Earth: continents, oceans, ice, clouds and city lights, generated on a canvas at start-up.
// (No external imagery is downloaded, so the pipeline works on any runner and stays deterministic.)
import * as THREE from 'three';
import { fbm3, noise3, clamp, smooth, lerp } from './noise.js';

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function generateEarthTextures(W = 2048) {
  const H = W / 2;
  const color = new Uint8ClampedArray(W * H * 4);
  const data = new Uint8ClampedArray(W * H * 4); // R land mask, G clouds, B city lights

  const OCEAN_DEEP = [6, 24, 64], OCEAN_SHALLOW = [18, 92, 128];
  const FOREST = [28, 62, 32], GRASS = [74, 98, 46], DESERT = [182, 154, 104], ROCK = [112, 98, 84], SNOW = [236, 241, 246];

  for (let j = 0; j < H; j++) {
    // DataTexture row 0 is v=0 (the south pole), so latitude runs south -> north with the row index
    const lat = -Math.PI / 2 + ((j + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const tl = Math.abs(lat) / (Math.PI / 2);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * Math.PI * 2 - Math.PI;
      const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);

      // continents via domain-warped fbm
      const wx = fbm3(px * 1.4 + 11.3, py * 1.4 + 3.1, pz * 1.4 + 7.7, 3) - 0.5;
      const wy = fbm3(px * 1.4 + 5.2, py * 1.4 + 9.9, pz * 1.4 + 1.3, 3) - 0.5;
      const e = fbm3(px * 1.25 + wx * 0.9, py * 1.25 + wy * 0.9, pz * 1.25, 6, 2.1, 0.5);
      const SEA = 0.505;
      const land = smooth(SEA - 0.006, SEA + 0.006, e);
      const relief = clamp((e - SEA) / 0.18, 0, 1);

      // mountains + climate
      const mtn = fbm3(px * 9 + 2.2, py * 9, pz * 9 + 4.4, 4);
      const dryBand = Math.exp(-Math.pow((tl - 0.30) / 0.11, 2));
      const dry = clamp(dryBand * (0.55 + fbm3(px * 3 + 9, py * 3, pz * 3, 3)) , 0, 1);
      const lush = clamp(1 - dry * 1.15, 0, 1);

      let c;
      if (land > 0.5) {
        c = mix3(GRASS, FOREST, clamp(fbm3(px * 5, py * 5 + 3, pz * 5, 3) * 1.4 - 0.2 + (1 - tl) * 0.3, 0, 1));
        c = mix3(c, DESERT, dry);
        c = mix3(c, ROCK, smooth(0.55, 0.78, mtn * (0.5 + relief)));
        c = mix3(c, SNOW, smooth(0.78, 0.9, mtn * (0.4 + relief)) * 0.9);
      } else {
        const depth = clamp((SEA - e) / 0.22, 0, 1);
        c = mix3(OCEAN_SHALLOW, OCEAN_DEEP, Math.pow(depth, 0.55));
      }
      // polar ice
      const ice = smooth(0.80, 0.86, tl + (fbm3(px * 6, py * 6, pz * 6, 3) - 0.5) * 0.14);
      c = mix3(c, SNOW, ice);

      const k = (j * W + i) * 4;
      color[k] = c[0]; color[k + 1] = c[1]; color[k + 2] = c[2]; color[k + 3] = 255;

      // clouds: banded + swirly
      const cw = fbm3(px * 2.2 + 21, py * 2.2 + 4, pz * 2.2 + 8, 3) - 0.5;
      const cn = fbm3(px * 3.4 + cw * 1.6, py * 5.0 + cw, pz * 3.4 + 2.0, 6);
      const band = 0.55 + 0.35 * Math.cos(lat * 6.0) * 0.5 + 0.2 * Math.exp(-Math.pow(lat / 0.18, 2));
      const cloud = smooth(0.46, 0.72, cn * band + 0.1);

      // city lights on land, clustered, away from the poles
      const pop = fbm3(px * 4.2 + 31, py * 4.2, pz * 4.2 + 17, 4);
      const spark = noise3(px * 90, py * 90, pz * 90);
      const lights = land > 0.5 && tl < 0.72 && ice < 0.2 && dry < 0.7 ? smooth(0.56, 0.74, pop) * smooth(0.45, 0.9, spark) : 0;

      data[k] = land * 255;
      data[k + 1] = cloud * 255;
      data[k + 2] = lights * 255;
      data[k + 3] = 255;
    }
  }

  const mk = (arr) => {
    const t = new THREE.DataTexture(arr, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const colorTex = mk(color);
  colorTex.colorSpace = THREE.NoColorSpace; // shaders write display-referred values, so sample raw sRGB bytes
  const dataTex = mk(data);
  dataTex.colorSpace = THREE.NoColorSpace;
  return { colorTex, dataTex };
}
