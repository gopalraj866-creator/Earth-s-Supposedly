// GLSL for the radiation-belt simulation.
// Units: 1 = one Earth radius (Re). Sun is on +X, magnetic/rotation axis is +Y.

export const COMMON = /* glsl */ `
uniform float uStorm;
// Storm-time distortion of the dipole: dayside compressed, nightside stretched (tail).
vec3 deform(vec3 p){
  float r = length(p);
  float k = smoothstep(3.0, 8.0, r);
  float day = smoothstep(-1.0, 4.0, p.x);
  float night = 1.0 - smoothstep(-4.0, 1.0, p.x);
  p.x *= 1.0 - uStorm*0.40*k*day + uStorm*0.60*k*night;
  return p;
}
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x), f.y), f.z);
}
`;

// ------------------------------------------------------------------ trapped particles
// Analytic guiding-centre motion in a dipole: every particle gyrates (implied), bounces along its field line
// (lambda = lambda_m * sin(w_b t)), and drifts around Earth in longitude (electrons east, protons west).
export const trappedVert = /* glsl */ `
${COMMON}
attribute vec4 aA;  // L, phi0, lambda_mirror, phase
attribute vec4 aB;  // kind, visibility threshold, energy, size seed
uniform float uTime; uniform vec2 uRes; uniform vec4 uVis; uniform float uPulse; uniform float uSize;
varying vec4 vCol;
void main(){
  float kind = aB.x, L = aA.x, en = aB.z;
  float wb = 0.9 + 0.7*en;
  float lam = aA.z*sin(uTime*wb + aA.w);
  float dirn = kind < 0.5 ? -1.0 : 1.0;
  float wd = dirn*(0.04 + 0.10*en)*(kind > 2.5 ? 1.5 : 1.0);
  float phi = aA.y + uTime*wd;
  float c = cos(lam), r = L*c*c, h = r*c;
  vec3 p = deform(vec3(h*cos(phi), r*sin(lam), h*sin(phi)));
  float vis = kind < 0.5 ? uVis.x : (kind < 1.5 ? uVis.y : (kind < 2.5 ? uVis.z : uVis.w));
  float a = smoothstep(aB.y, aB.y + 0.10, vis);
  vec3 col;
  if (kind < 0.5)      col = vec3(1.7, 0.85, 0.28);
  else if (kind < 1.5) col = vec3(0.30, 0.72, 1.7);
  else if (kind < 2.5) col = vec3(1.0, 1.5, 2.4);
  else                 col = mix(vec3(1.5, 0.28, 1.9), vec3(2.6, 2.1, 1.8), smoothstep(0.35, 0.9, en));
  float b = 0.75 + 0.25*sin(uTime*(2.0 + 3.0*en) + aA.w*7.0);
  if (kind > 1.5 && kind < 2.5) b *= 0.55 + 0.9*step(0.93, fract(sin(floor(uTime*8.0 + aA.w*40.0)*12.9898 + aB.w*78.233)*43758.5453));
  if (kind > 2.5) b *= 1.0 + uPulse*1.2;
  vCol = vec4(col*b, a);
  vec4 mv = modelViewMatrix*vec4(p, 1.0);
  float world = (0.018 + 0.030*aB.w)*(kind > 2.5 ? 1.3 : 1.0)*uSize;
  float px = uRes.y/1080.0;
  gl_PointSize = clamp(world*projectionMatrix[1][1]*uRes.y*0.5/max(-mv.z, 0.01), 1.5*px, 22.0*px);
  gl_Position = projectionMatrix*mv;
}`;

export const pointFrag = /* glsl */ `
varying vec4 vCol;
void main(){
  vec2 d = gl_PointCoord*2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2*5.0);
  gl_FragColor = vec4(vCol.rgb, vCol.a*core);
}`;

// ------------------------------------------------------------------ solar wind + CME cloud
// Particles follow the streamlines of potential flow around a sphere of radius Rm (the magnetopause):
//   rho^2 (1 - Rm^3/r^3) = b^2
export const windVert = /* glsl */ `
attribute vec4 aW;   // phase, impact parameter seed, azimuth, visibility seed
uniform float uTime, uMode, uCmeX, uSunX, uRm, uA; uniform vec2 uRes;
varying vec4 vCol;
void main(){
  float x, f, coneR;
  if (uMode < 0.5) { float range = 190.0; x = 140.0 - mod(aW.x*range + uTime*22.0, range); coneR = 46.0; f = 0.5; }
  else { f = fract(aW.x - uTime*0.22); x = uCmeX + 75.0*f; coneR = clamp((uSunX - x)*0.22, 3.0, 58.0); }
  float rho0 = sqrt(aW.y)*coneR;
  float near = smoothstep(95.0, 35.0, x);
  float rmin = uRm*1.06;
  float b = mix(rho0, rmin + rho0*(1.0 - rmin/max(coneR, rmin + 1.0)), near);
  float rho = b, r = sqrt(x*x + rho*rho);
  for (int i = 0; i < 6; i++) {
    float k = 1.0 - pow(uRm/max(r, uRm*1.0001), 3.0);
    rho = b/sqrt(max(k, 0.04));
    r = sqrt(x*x + rho*rho);
  }
  rho = mix(b, rho, near);
  float psi = aW.z + 0.08*sin(uTime*0.7 + aW.w*20.0);
  vec3 p = vec3(x, rho*cos(psi), rho*sin(psi));
  vec3 col = uMode < 0.5 ? vec3(0.95, 0.80, 0.50)*0.35 : mix(vec3(2.6, 2.0, 1.2), vec3(1.6, 0.55, 0.2), f);
  float edge = uMode < 0.5 ? 1.0 : smoothstep(0.0, 0.06, f)*(1.0 - smoothstep(0.7, 1.0, f));
  float a = smoothstep(aW.w, aW.w + 0.1, uA)*edge;
  vCol = vec4(col, a);
  vec4 mv = viewMatrix*modelMatrix*vec4(p, 1.0);
  float world = (0.12 + 0.14*aW.w)*(uMode < 0.5 ? 0.8 : 1.0);
  float px = uRes.y/1080.0;
  gl_PointSize = clamp(world*projectionMatrix[1][1]*uRes.y*0.5/max(-mv.z, 0.01), 1.5*px, 30.0*px);
  gl_Position = projectionMatrix*mv;
}`;

// ------------------------------------------------------------------ parametric shells
// mode 0: plasmasphere (L-shell), mode 1: the barrier (L-shell that can crack), mode 2: magnetopause (Shue model)
export const shellVert = /* glsl */ `
${COMMON}
attribute vec2 aUV;
uniform float uL, uRm, uMode;
varying vec3 vW; varying vec2 vUV;
void main(){
  vec3 p;
  if (uMode < 1.5) {
    float lamMax = acos(sqrt(1.0/uL));
    float lam = (aUV.x*2.0 - 1.0)*lamMax, phi = aUV.y*6.2831853;
    float c = cos(lam), r = uL*c*c, h = r*c;
    p = deform(vec3(h*cos(phi), r*sin(lam), h*sin(phi)));
  } else {
    float th = aUV.x*2.35, phi = aUV.y*6.2831853;
    float r = uRm*pow(2.0/(1.0 + cos(th)), 0.6);
    p = vec3(r*cos(th), r*sin(th)*cos(phi), r*sin(th)*sin(phi));
  }
  vec4 wp = modelMatrix*vec4(p, 1.0);
  vW = wp.xyz; vUV = aUV;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;

export const shellFrag = /* glsl */ `
${COMMON}
uniform vec3 uColor; uniform float uAlpha, uBreach, uTime, uMode;
varying vec3 vW; varying vec2 vUV;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = normalize(cameraPosition - vW);
  float fr = pow(1.0 - abs(dot(n, v)), 2.4);
  float gLat = smoothstep(0.86, 1.0, abs(sin(vUV.x*3.14159*(uMode > 1.5 ? 24.0 : 40.0))));
  float gm  = smoothstep(0.88, 1.0, abs(sin(vUV.y*6.2831853*24.0 + uTime*0.15*uMode)));
  float nz = vnoise(vW*1.6 + vec3(0.0, uTime*0.12, 0.0));
  float gridK = uMode > 1.5 ? 0.12 : 0.35;
  float a = uAlpha*(0.10 + 0.9*fr + gridK*max(gLat, gm)*(0.5 + 0.5*nz));
  vec3 col = uColor;
  if (uMode > 0.5 && uMode < 1.5) {
    float thr = uBreach*1.05;
    float nn = vnoise(vW*3.2 + 7.0)*0.6 + vnoise(vW*7.5)*0.4;
    if (nn < thr) discard;
    float rim = (1.0 - smoothstep(0.0, 0.07, nn - thr))*step(0.001, uBreach);
    col = mix(col, vec3(2.4, 0.8, 0.25), rim);
    a += rim*uAlpha*1.4;
  } else if (uMode < 0.5) {
    a *= 0.55 + 0.9*nz;
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

// ------------------------------------------------------------------ screen-space ribbons (field lines, orbit)
export const ribbonVert = /* glsl */ `
${COMMON}
attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute vec2 aInfo;
uniform vec2 uRes; uniform float uWidth, uDeform;
varying float vT, vSide, vR;
vec3 dfm(vec3 p){ return uDeform > 0.5 ? deform(p) : p; }
void main(){
  mat4 vp = projectionMatrix*viewMatrix*modelMatrix;
  vec4 c0 = vp*vec4(dfm(aPrev), 1.0), c1 = vp*vec4(dfm(position), 1.0), c2 = vp*vec4(dfm(aNext), 1.0);
  vec2 s0 = c0.xy/c0.w*uRes*0.5, s2 = c2.xy/c2.w*uRes*0.5;
  vec2 dir = normalize(s2 - s0 + vec2(1e-5));
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 pos = c1;
  pos.xy += nrm*aSide*uWidth*0.5/(uRes*0.5)*pos.w;
  gl_Position = pos;
  vT = aInfo.x; vSide = aSide; vR = aInfo.y;
}`;

export const ribbonFrag = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha, uTime, uFlow;
varying float vT, vSide, vR;
void main(){
  float edge = 1.0 - abs(vSide);
  float pulse = 0.55 + 0.45*sin(vT*40.0 - uTime*uFlow*3.0 + vR*30.0);
  float a = uAlpha*smoothstep(0.0, 0.9, edge)*mix(1.0, pulse, step(0.001, uFlow));
  gl_FragColor = vec4(uColor, a);
}`;

// chorus waves: expanding arcs in the equatorial plane (dawn sector)
export const chorusVert = /* glsl */ `
varying vec3 vP;
void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }`;

export const chorusFrag = /* glsl */ `
uniform float uTime, uA; uniform float uChirp[16]; uniform float uCen;
varying vec3 vP;
void main(){
  float r = length(vP.xz);
  float ang = atan(vP.z, vP.x);
  float dA = abs(mod(ang - uCen + 3.14159, 6.2831853) - 3.14159);
  float sector = 1.0 - smoothstep(0.55, 1.05, dA);
  float acc = 0.0; vec3 col = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float age = uTime - uChirp[i];
    if (age > 0.0 && age < 3.2) {
      float R = 6.6 - 1.15*age;
      float w = 0.10 + 0.05*age;
      float ring = exp(-pow((r - R)/w, 2.0));
      float fade = (1.0 - age/3.2);
      acc += ring*fade;
      col += ring*fade*mix(vec3(1.3, 0.5, 2.0), vec3(2.4, 1.9, 0.6), clamp(age/2.0, 0.0, 1.0));
    }
  }
  float a = clamp(acc, 0.0, 1.0)*sector*uA;
  gl_FragColor = vec4(col/max(acc, 0.001), a);
}`;

// ------------------------------------------------------------------ Earth, atmosphere, aurora
export const earthVert = /* glsl */ `
varying vec3 vN, vW; varying vec2 vUv;
void main(){
  vUv = uv; vN = normalize(mat3(modelMatrix)*normal);
  vec4 wp = modelMatrix*vec4(position, 1.0); vW = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;

export const earthFrag = /* glsl */ `
uniform sampler2D uColorMap, uDataMap; uniform float uTime, uLightning;
varying vec3 vN, vW; varying vec2 vUv;
void main(){
  vec3 N = normalize(vN), L = vec3(1.0, 0.0, 0.0), V = normalize(cameraPosition - vW);
  vec3 alb = texture2D(uColorMap, vUv).rgb, dat = texture2D(uDataMap, vUv).rgb;
  float cloud = texture2D(uDataMap, vUv + vec2(uTime*0.0009, 0.0)).g;
  float ndl = dot(N, L), lam = max(ndl, 0.0);
  float day = smoothstep(-0.12, 0.25, ndl);
  vec3 col = alb*(0.035 + 1.15*lam);
  vec3 H = normalize(L + V);
  col += vec3(0.8, 0.9, 1.0)*pow(max(dot(N, H), 0.0), 90.0)*(1.0 - dat.r)*lam*1.3;
  col = mix(col, vec3(0.92)*(0.05 + lam), cloud*0.85);
  float night = 1.0 - smoothstep(-0.05, 0.2, ndl);
  col += vec3(1.0, 0.72, 0.35)*dat.b*night*(1.0 - cloud*0.7)*1.5*(1.0 + uLightning*1.2);
  col += vec3(0.9, 0.35, 0.15)*0.15*smoothstep(0.0, 0.15, ndl)*(1.0 - smoothstep(0.15, 0.35, ndl));
  col += vec3(0.25, 0.5, 1.0)*pow(1.0 - max(dot(N, V), 0.0), 3.0)*(0.1 + 0.9*day)*0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

export const atmoFrag = /* glsl */ `
${COMMON}
uniform float uTime, uAurora, uAuroraLat;
varying vec3 vN, vW; varying vec2 vUv;
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float ndv = max(dot(N, V), 0.0);
  float fr = pow(1.0 - ndv, 2.6);
  float sunSide = 0.25 + 0.75*smoothstep(-0.4, 0.5, N.x);
  vec3 col = vec3(0.30, 0.55, 1.0)*fr*1.6*sunSide;
  float alat = abs(asin(clamp(N.y, -1.0, 1.0)));
  float oval = exp(-pow((alat - uAuroraLat)/0.05, 2.0));
  float ang = atan(N.z, N.x);
  float curtain = 0.55 + 0.45*vnoise(vec3(ang*9.0, alat*30.0, uTime*0.5));
  float nightF = 0.25 + 0.75*(1.0 - smoothstep(-0.3, 0.5, N.x));
  float au = oval*curtain*nightF*uAurora;
  vec3 acol = mix(vec3(0.1, 1.0, 0.45), vec3(0.75, 0.2, 0.9), smoothstep(0.5, 1.0, curtain*oval));
  col += acol*au*3.2*(0.4 + 0.6*sqrt(ndv));
  gl_FragColor = vec4(col, clamp(fr*0.8 + au, 0.0, 1.0));
}`;

// ------------------------------------------------------------------ Sun + stars
export const sunFrag = /* glsl */ `
${COMMON}
uniform float uTime, uA;
varying vec3 vN, vW; varying vec2 vUv;
void main(){
  vec3 q = (vW - vec3(260.0, 0.0, 0.0))*0.08;
  float n = vnoise(q*3.0 + uTime*0.08)*0.55 + vnoise(q*9.0 - uTime*0.15)*0.30 + vnoise(q*22.0 + uTime*0.30)*0.15;
  vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.82, 0.45), n)*(1.4 + 1.5*n);
  float limb = pow(max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0), 0.5);
  gl_FragColor = vec4(col*(0.6 + 0.8*limb)*1.5, uA);
}`;

export const starVert = /* glsl */ `
attribute vec4 aS; uniform vec2 uRes; uniform float uTime;
varying vec3 vCol;
void main(){
  vec3 warm = vec3(1.0, 0.85, 0.7), cool = vec3(0.7, 0.8, 1.0);
  vCol = mix(cool, warm, aS.z)*aS.x*(0.85 + 0.15*sin(uTime*1.3 + aS.w*50.0));
  gl_PointSize = aS.y*uRes.y/1080.0;
  gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position, 1.0);
}`;
