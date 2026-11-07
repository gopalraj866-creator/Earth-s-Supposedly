import * as THREE from 'three';
import { createWorld } from './scene.js';
import { buildSampler } from './tracks.js';
import { createHud } from './hud.js';

let world, renderer, sampler, hud, tl;

// Called once by the renderer script (puppeteer) with the output size and the timeline.
window.initSim = async ({ W, H, timeline, texSize = 2048, captions = false, msaa = true }) => {
  tl = timeline;
  const canvas = document.getElementById('gl');
  canvas.width = W; canvas.height = H;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  renderer = new THREE.WebGLRenderer({ canvas, antialias: msaa, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000004, 1);
  world = createWorld(W, H, texSize, tl.chirps);
  sampler = buildSampler(tl);
  hud = createHud(document.getElementById('hud'), tl, { W, H, captions });
  window.frameReady = true;
  return { gl: renderer.getContext().getParameter(renderer.getContext().VERSION), maxPoint: renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1] };
};

// Deterministic: the picture depends only on t.
window.drawFrame = (t) => {
  const st = sampler.sample(t);
  world.update(st, t);
  renderer.render(world.scene, world.camera);
  hud(t, st);
  return true;
};
