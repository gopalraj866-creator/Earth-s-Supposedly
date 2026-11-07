// The radiation-belt world. Everything here is a pure function of (state, t): no accumulated simulation state,
// so any frame can be rendered independently (which is what lets GitHub Actions render chunks in parallel).
import * as THREE from 'three';
import { mulberry32, clamp, lerp } from './noise.js';
import { generateEarthTextures } from './earthtex.js';
import * as S from './shaders.js';

const TAU = Math.PI * 2;
const SUN_X = 260;

export function createWorld(W, H, texSize, chirps) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 4000);
  const res = new THREE.Vector2(W, H);

  // uniforms shared by every material
  const U = {
    uTime: { value: 0 }, uStorm: { value: 0 }, uRes: { value: res }, uRm: { value: 10.5 },
  };
  const mat = (o) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...o });
  const add = THREE.AdditiveBlending;
  const rnd = mulberry32(20240510);
  const R = () => rnd();

  // ---------------------------------------------------------------- stars
  {
    const N = 6000, pos = new Float32Array(N * 3), aS = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      let u, v;
      do { u = R() * 2 - 1; v = R() * TAU; // milky-way band: favour low galactic latitude
        const band = Math.exp(-Math.pow(u / 0.28, 2));
        if (R() < 0.35 + 0.65 * band) break; } while (true);
      const s = Math.sqrt(1 - u * u);
      // tilt the band
      let x = s * Math.cos(v), y = u, z = s * Math.sin(v);
      const t = 0.9, yy = y * Math.cos(t) - z * Math.sin(t), zz = y * Math.sin(t) + z * Math.cos(t);
      pos.set([x * 2200, yy * 2200, zz * 2200], i * 3);
      const m = Math.pow(R(), 6);
      aS.set([0.25 + 1.4 * m, 1.3 + 2.6 * m, R(), R()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aS', new THREE.BufferAttribute(aS, 4));
    const m = mat({ uniforms: { uRes: U.uRes, uTime: U.uTime }, vertexShader: S.starVert, fragmentShader: S.pointFrag.replace('vCol.a*core', 'core*vCol.a'), blending: add });
    // stars use vec3 colour varying; wrap it so the shared point fragment shader can be reused
    m.vertexShader = S.starVert.replace('varying vec3 vCol;', 'varying vec4 vCol;').replace(/vCol = (.*);\n/, 'vCol = vec4($1, 1.0);\n');
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  // ---------------------------------------------------------------- Earth, atmosphere, aurora
  const { colorTex, dataTex } = generateEarthTextures(texSize);
  const earthU = { uColorMap: { value: colorTex }, uDataMap: { value: dataTex }, uTime: U.uTime, uLightning: { value: 0 } };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96),
    new THREE.ShaderMaterial({ uniforms: earthU, vertexShader: S.earthVert, fragmentShader: S.earthFrag }));
  scene.add(earth);
  const atmoU = { uTime: U.uTime, uStorm: U.uStorm, uAurora: { value: 0 }, uAuroraLat: { value: 1.17 } };
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 128, 64),
    mat({ uniforms: atmoU, vertexShader: S.earthVert, fragmentShader: S.atmoFrag, blending: add, side: THREE.FrontSide }));
  scene.add(atmo);

  // ---------------------------------------------------------------- trapped radiation particles
  const popCfg = [
    { kind: 0, n: 5000, L: () => 1.3 + 1.0 * (R() + R()) / 2, en: () => R() * 0.5, thr: () => R() },
    { kind: 1, n: 9000, L: () => 3.2 + 3.4 * (R() + R()) / 2, en: () => R() * 0.8, thr: () => R() },
    { kind: 2, n: 4500, L: () => Math.min(2.82 - Math.log(1 - R() * 0.97) * 0.55, 5.6), en: () => 0.7 + R() * 0.3, thr: () => R() },
    { kind: 3, n: 7000, L: () => { const g = (R() + R() + R() - 1.5) * 0.9; return clamp(2.5 + g * 0.55, 1.9, 2.78); }, en: null, thr: null },
  ];
  const total = popCfg.reduce((a, p) => a + p.n, 0);
  const aA = new Float32Array(total * 4), aB = new Float32Array(total * 4), zeros = new Float32Array(total * 3);
  {
    let k = 0;
    for (const p of popCfg) for (let i = 0; i < p.n; i++, k++) {
      const L = p.L();
      const lamMax = Math.acos(1 / Math.sqrt(L));
      const en = p.kind === 3 ? R() : p.en();
      const thr = p.kind === 3 ? en * 0.65 + R() * 0.2 : p.thr();
      aA.set([L, R() * TAU, lamMax * (0.12 + 0.85 * R()), R() * TAU], k * 4);
      aB.set([p.kind, thr, en, R()], k * 4);
    }
  }
  const trapG = new THREE.BufferGeometry();
  trapG.setAttribute('position', new THREE.BufferAttribute(zeros, 3));
  trapG.setAttribute('aA', new THREE.BufferAttribute(aA, 4));
  trapG.setAttribute('aB', new THREE.BufferAttribute(aB, 4));
  const trapU = { uTime: U.uTime, uStorm: U.uStorm, uRes: U.uRes, uVis: { value: new THREE.Vector4() }, uPulse: { value: 0 }, uSize: { value: 1 } };
  const trapped = new THREE.Points(trapG, mat({ uniforms: trapU, vertexShader: S.trappedVert, fragmentShader: S.pointFrag, blending: add }));
  trapped.frustumCulled = false;
  scene.add(trapped);

  // ---------------------------------------------------------------- solar wind + CME cloud
  const mkWind = (n, mode) => {
    const w = new Float32Array(n * 4), z = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) w.set([R(), R(), R() * TAU, R()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(z, 3));
    g.setAttribute('aW', new THREE.BufferAttribute(w, 4));
    const u = { uTime: U.uTime, uRes: U.uRes, uRm: U.uRm, uMode: { value: mode }, uCmeX: { value: 200 }, uSunX: { value: SUN_X }, uA: { value: 0 } };
    const p = new THREE.Points(g, mat({ uniforms: u, vertexShader: S.windVert, fragmentShader: S.pointFrag, blending: add }));
    p.frustumCulled = false;
    scene.add(p);
    return u;
  };
  const windU = mkWind(7000, 0), cmeU = mkWind(11000, 1);

  // ---------------------------------------------------------------- parametric shells
  const gridGeom = (nu, nv) => {
    const uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) uv.push(i / nu, j / nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  };
  const mkShell = (mode, color, nu, nv) => {
    const u = { uTime: U.uTime, uStorm: U.uStorm, uRm: U.uRm, uL: { value: 2.8 }, uMode: { value: mode }, uColor: { value: new THREE.Color(...color) }, uAlpha: { value: 0 }, uBreach: { value: 0 } };
    const m = new THREE.Mesh(gridGeom(nu, nv), mat({ uniforms: u, vertexShader: S.shellVert, fragmentShader: S.shellFrag, blending: add, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    scene.add(m);
    return { u, m };
  };
  const plasma = mkShell(0, [0.25, 1.0, 0.85], 160, 96);
  const barrier = mkShell(1, [0.55, 0.85, 2.2], 200, 120);
  const mpause = mkShell(2, [0.45, 0.75, 1.8], 90, 96);
  barrier.u.uL.value = 2.8;

  // ---------------------------------------------------------------- ribbons: field lines + Arase orbit
  const ribbon = (lines, color, width, deform, flow) => {
    // lines: array of {pts: Vector3[], rnd}
    const pos = [], prev = [], next = [], side = [], info = [], idx = [];
    let base = 0;
    for (const ln of lines) {
      const n = ln.pts.length;
      for (let i = 0; i < n; i++) {
        const p = ln.pts[i], a = ln.pts[Math.max(i - 1, 0)], b = ln.pts[Math.min(i + 1, n - 1)];
        for (const s of [-1, 1]) {
          pos.push(p.x, p.y, p.z); prev.push(a.x, a.y, a.z); next.push(b.x, b.y, b.z); side.push(s); info.push(i / (n - 1), ln.rnd);
        }
      }
      for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      base += n * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aPrev', new THREE.Float32BufferAttribute(prev, 3));
    g.setAttribute('aNext', new THREE.Float32BufferAttribute(next, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
    g.setIndex(idx);
    const u = { uTime: U.uTime, uStorm: U.uStorm, uRes: U.uRes, uWidth: { value: width }, uDeform: { value: deform ? 1 : 0 }, uColor: { value: new THREE.Color(...color) }, uAlpha: { value: 0 }, uFlow: { value: flow } };
    const m = new THREE.Mesh(g, mat({ uniforms: u, vertexShader: S.ribbonVert, fragmentShader: S.ribbonFrag, blending: add, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    scene.add(m);
    return u;
  };
  const fieldLines = [];
  for (const L of [1.4, 1.8, 2.4, 3.2, 4.2, 5.5, 7.0, 9.0]) {
    const lamMax = Math.acos(1 / Math.sqrt(L));
    const naz = L < 3 ? 12 : 16;
    for (let a = 0; a < naz; a++) {
      const phi = (a + (L > 4 ? 0.5 : 0)) / naz * TAU, pts = [];
      for (let i = 0; i <= 72; i++) {
        const lam = (i / 72 * 2 - 1) * lamMax, c = Math.cos(lam), r = L * c * c, h = r * c;
        pts.push(new THREE.Vector3(h * Math.cos(phi), r * Math.sin(lam), h * Math.sin(phi)));
      }
      fieldLines.push({ pts, rnd: R() });
    }
  }
  const fieldU = ribbon(fieldLines, [0.35, 0.6, 1.3], 1.6 * H / 1080, true, 0.5);
  fieldU.uWidth.value = Math.max(1.2, 1.6 * H / 1080);

  // Arase: real orbital elements (perigee ~440 km, apogee ~32,100 km altitude, inclination ~31 deg)
  const rp = 1.07, ra = 6.04, aSM = (rp + ra) / 2, ecc = (ra - rp) / (ra + rp), bSM = aSM * Math.sqrt(1 - ecc * ecc);
  const INC = 31 * Math.PI / 180, RAAN = -70 * Math.PI / 180;
  const orbitPos = (E) => {
    const xp = aSM * (Math.cos(E) - ecc), yp = bSM * Math.sin(E);
    const x1 = xp, y1 = -yp * Math.sin(INC), z1 = yp * Math.cos(INC);
    return new THREE.Vector3(x1 * Math.cos(RAAN) + z1 * Math.sin(RAAN), y1, -x1 * Math.sin(RAAN) + z1 * Math.cos(RAAN));
  };
  const orbPts = [];
  for (let i = 0; i <= 240; i++) orbPts.push(orbitPos(i / 240 * TAU));
  const orbitU = ribbon([{ pts: orbPts, rnd: 0.3 }], [1.0, 0.85, 0.4], Math.max(1.5, 2.2 * H / 1080), false, 0);

  const sat = new THREE.Group();
  {
    const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.5), transparent: true });
    const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.5, 1.6), transparent: true });
    sat.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.7), gold));
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2.0), blue); p.position.set(0, 0, s * 1.55); sat.add(p); }
    sat.scale.setScalar(0.16);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const ctx = cv.getContext('2d'), gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,230,160,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,0.35)'); gr.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: add, depthWrite: false, transparent: true, color: new THREE.Color(2, 1.6, 0.9) }));
    glow.scale.setScalar(9);
    sat.add(glow);
  }
  sat.visible = false;
  scene.add(sat);

  // ---------------------------------------------------------------- chorus waves
  const chorusU = { uTime: U.uTime, uA: { value: 0 }, uChirp: { value: new Float32Array(16).fill(-100) }, uCen: { value: -Math.PI / 2 } };
  {
    const g = new THREE.RingGeometry(1.4, 7.4, 160, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat({ uniforms: chorusU, vertexShader: S.chorusVert, fragmentShader: S.chorusFrag, blending: add, side: THREE.DoubleSide }));
    m.frustumCulled = false; scene.add(m);
  }

  // ---------------------------------------------------------------- the Sun
  const sunU = { uTime: U.uTime, uStorm: U.uStorm, uA: { value: 0 } };
  const sun = new THREE.Mesh(new THREE.SphereGeometry(30, 96, 48), mat({ uniforms: sunU, vertexShader: S.earthVert, fragmentShader: S.sunFrag }));
  sun.position.set(SUN_X, 0, 0);
  scene.add(sun);
  let corona;
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d'), gr = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,220,150,1)'); gr.addColorStop(0.2, 'rgba(255,160,60,0.55)'); gr.addColorStop(0.5, 'rgba(255,100,30,0.15)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 256);
    corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: add, depthWrite: false, transparent: true, color: new THREE.Color(1.6, 1.2, 0.8) }));
    corona.scale.setScalar(190); corona.position.set(SUN_X, 0, 0);
    scene.add(corona);
  }

  // ---------------------------------------------------------------- per-frame update
  const chirpT = (chirps || []).map((c) => c.t);
  const tmpV = new THREE.Vector3();

  function update(st, t) {
    U.uTime.value = t;
    U.uStorm.value = st.storm;
    U.uRm.value = 10.5 - 4.7 * st.storm;

    // camera: spherical orbit around a moving target; widen for portrait frames
    const aspect = W / H;
    const fit = aspect < 1 ? lerp(1, 1 / aspect, 0.66) : 1;
    const el = st.el * Math.PI / 180, az = st.az * Math.PI / 180, d = st.dist * fit;
    camera.position.set(st.tx + d * Math.cos(el) * Math.cos(az), st.ty + d * Math.sin(el), st.tz + d * Math.cos(el) * Math.sin(az));
    camera.lookAt(st.tx, st.ty, st.tz);
    camera.fov = st.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);

    earth.rotation.y = t * 0.025;
    earthU.uLightning.value = st.lightning;
    atmoU.uAurora.value = st.aurora;
    atmoU.uAuroraLat.value = lerp(1.17, 0.84, clamp(st.aurora, 0, 1));

    // belts
    let pulse = 0;
    for (const ct of chirpT) { const a = t - ct; if (a > 0 && a < 1.5) pulse += Math.exp(-a * 3.5); }
    trapU.uVis.value.set(st.vIn, st.vOut, st.vKill, st.vAcc);
    trapU.uPulse.value = Math.min(pulse, 1.5) * st.chorusA;
    trapped.visible = st.vIn + st.vOut + st.vKill + st.vAcc > 0.001;

    // solar wind / CME
    windU.uA.value = st.windA; windU.uCmeX.value = st.cmeX;
    cmeU.uA.value = st.cmeA; cmeU.uCmeX.value = st.cmeX;

    // shells
    plasma.u.uL.value = st.plL; plasma.u.uAlpha.value = st.plA; plasma.m.visible = st.plA > 0.002;
    barrier.u.uAlpha.value = st.barA; barrier.u.uBreach.value = st.breach; barrier.m.visible = st.barA > 0.002;
    mpause.u.uAlpha.value = st.mpA * 0.6; mpause.m.visible = st.mpA > 0.002;
    fieldU.uAlpha.value = st.fieldA * 0.55;

    // Arase on its Kepler orbit (mean anomaly advances faster than reality so the motion is visible)
    orbitU.uAlpha.value = st.araA * 0.5;
    sat.visible = st.araA > 0.01;
    if (sat.visible) {
      const M = (t * TAU / 38 + 1.2) % TAU;
      let E = M; for (let i = 0; i < 8; i++) E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
      sat.position.copy(orbitPos(E));
      sat.children.forEach((c) => { if (c.material && c.material.opacity !== undefined && !c.isSprite) c.material.opacity = st.araA; });
      sat.lookAt(0, 0, 0);
    }

    // chorus
    chorusU.uA.value = st.chorusA;
    const arr = chorusU.uChirp.value; arr.fill(-100);
    let k = 0;
    for (let i = chirpT.length - 1; i >= 0 && k < 16; i--) if (chirpT[i] <= t && t - chirpT[i] < 3.2) arr[k++] = chirpT[i];
    chorusU.uCen.value = Math.atan2(-1, 0.0);

    // sun
    sunU.uA.value = st.sunA; sun.visible = st.sunA > 0.01;
    corona.material.opacity = st.sunA; corona.visible = sun.visible;
  }

  // world-space anchor on a magnetic shell, facing the camera: used by the HUD labels
  function anchorOnShell(L, lamFrac, azOffsetDeg, st) {
    const lamMax = Math.acos(1 / Math.sqrt(L)), lam = lamFrac * lamMax, c = Math.cos(lam), r = L * c * c, h = r * c;
    const phi = st.az * Math.PI / 180 + azOffsetDeg * Math.PI / 180;
    tmpV.set(h * Math.cos(phi), r * Math.sin(lam), h * Math.sin(phi));
    return tmpV.clone();
  }

  return { scene, camera, update, anchorOnShell, sat, SUN_X };
}
