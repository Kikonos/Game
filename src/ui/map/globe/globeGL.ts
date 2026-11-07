// v0.15 the 3D globe's three.js pieces: the Earth (the land from a coverage mask read with a smooth cubic filter, the
// coast drawn from the same field, anti-aliased ribbons for the borders, a soft graticule, the real sun's day and
// night, an atmosphere rim), flight arcs as ribbons on the sphere (screen-px wide, flown part solid,
// the rest dashed), airport dots and the aircraft silhouettes as textures. Loaded only with the globe (its own chunk).

import {
  AdditiveBlending, Color, MeshLambertMaterial, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, DataTexture, DoubleSide, Float32BufferAttribute, LinearFilter,
  LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, NormalBlending, Points, RedFormat, RepeatWrapping, ShaderMaterial, SphereGeometry, SRGBColorSpace, type Texture,
  UnsignedByteType, Vector2, Vector3, Vector4,
} from 'three';
import { silhouette, silSpec } from '../silhouettes';
import type { Ribbon } from './globeLand';
import { liftAt, NIGHT_S, type Vec3, sub, vecOf } from './globeLogic';
import { modelOf } from './globeModel';

export type RGBA = [number, number, number, number];

/** Theme colours the globe paints with (sRGB, 0..1), read from the page's CSS custom properties. */
export interface GlobeInk {
  ocean0: RGBA; ocean1: RGBA; land0: RGBA; land1: RGBA; coast: RGBA; border: RGBA; grid: RGBA;
  night: RGBA; atmo: RGBA; glint: number; dayLift: number; pin: RGBA; ring: RGBA; halo: RGBA;
}

const v4 = (c: RGBA) => new Vector4(c[0], c[1], c[2], c[3]);

// ---------- the land field ----------

/** v0.15 the land's coverage mask (globeLand.landField) as a one-channel texture, mipmapped, wrapping east–west. */
export function landTexture(data: Uint8Array, w: number, maxAniso: number): DataTexture {
  const tex = new DataTexture(data, w, w / 2, RedFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, maxAniso);
  tex.unpackAlignment = 1;
  // (The bytes stay with the texture: a lost WebGL context is restored from them.)
  tex.needsUpdate = true;
  return tex;
}

/*
 * The land field read with a cubic B-spline filter (four bilinear taps, GPU Gems 2 ch. 20): its 0.5 contour is a smooth
 * curve, not the corners of the bilinear filter, however far the globe is magnified. textureGrad keeps the mip level
 * of the surface (the taps' own coordinates jump at texel edges).
 */
const FIELD_GLSL = /* glsl */ `
vec4 bsW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
float landAt(sampler2D t, vec2 uv, vec2 size) {
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  vec2 st = uv * size - 0.5;
  vec2 f = fract(st);
  st -= f;
  vec4 xc = bsW(f.x);
  vec4 yc = bsW(f.y);
  vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  float s0 = textureGrad(t, o.xz, gx, gy).r;
  float s1 = textureGrad(t, o.yz, gx, gy).r;
  float s2 = textureGrad(t, o.xw, gx, gy).r;
  float s3 = textureGrad(t, o.yw, gx, gy).r;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}`;

// ---------- the Earth ----------

const EARTH_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const EARTH_FS = /* glsl */ `
uniform sampler2D uLand; uniform vec2 uLandSize; uniform float uLandOn;
uniform vec4 uOcean0; uniform vec4 uOcean1; uniform vec4 uLand0; uniform vec4 uLand1; uniform vec4 uGrid; uniform vec4 uNight; uniform vec4 uAtmo;
uniform vec4 uCoast; uniform float uCoastW;
uniform vec3 uSun; uniform vec2 uNightS; uniform float uGlint; uniform float uDayLift;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
${FIELD_GLSL}
float gridLine(float v, float step) {
  float f = abs(fract(v / step + 0.5) - 0.5) * step;
  float w = fwidth(v);
  return 1.0 - smoothstep(0.0, w * 1.2, f);
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  // The land edge from the smooth field. Magnified (a texel over a pixel or two): its signed distance in screen px
  // (the field over its screen gradient), so the edge is a pixel of anti-aliasing and the coast line is drawn on it a
  // constant width. Minified (the whole globe): the mipmapped field is itself the pixel's coverage, and the coast is
  // the band where it crosses one half (no screen derivatives there: they come per 2 × 2 pixels and would step).
  float m = landAt(uLand, vUv, uLandSize) * uLandOn;
  float gm = length(vec2(dFdx(m), dFdy(m)));
  float d = (m - 0.5) / max(gm, 1e-5);
  float rho = max(length(dFdx(vUv) * uLandSize), length(dFdy(vUv) * uLandSize));
  float mag = 1.0 - smoothstep(0.45, 0.9, rho);
  float land = mix(smoothstep(0.3, 0.7, m), clamp(d + 0.5, 0.0, 1.0), mag);
  float lit = pow(facing, 0.55);
  vec3 ocean = mix(uOcean1.rgb, uOcean0.rgb, lit);
  vec3 ground = mix(uLand1.rgb, uLand0.rgb, lit);
  vec3 col = mix(ocean, ground, land);
  // A 15° graticule, faint (fades out towards the poles where the meridians bunch up).
  float lon = vUv.x * 360.0;
  float lat = vUv.y * 180.0;
  float g = max(gridLine(lon, 15.0) * smoothstep(80.0, 70.0, abs(lat - 90.0)), gridLine(lat, 15.0));
  col = mix(col, uGrid.rgb, g * uGrid.a);
  // Day and night from the sun's real position (the flat map's twilight band).
  float s = dot(N, uSun);
  float t = clamp((uNightS.x - s) / (uNightS.x - uNightS.y), 0.0, 1.0);
  float night = t * t * (3.0 - 2.0 * t);
  // A soft sun glint on the water by day.
  vec3 H = normalize(uSun + V);
  float glint = pow(max(dot(N, H), 0.0), 90.0) * (1.0 - land) * (1.0 - night) * uGlint;
  col += glint * vec3(1.0, 0.97, 0.9);
  // The sunlit side a little brighter (on the dark theme the night alone would barely show).
  col *= 1.0 + uDayLift * (1.0 - night) * smoothstep(-0.05, 0.5, s);
  col = mix(col, uNight.rgb, night * uNight.a);
  // The atmosphere seen edge-on: a thin bright limb.
  float rim = pow(1.0 - facing, 3.0);
  col = mix(col, uAtmo.rgb, rim * uAtmo.a * 0.85);
  // The coast, on the land's edge (thinner than a pixel: fainter instead), easing out towards the limb.
  float hw = max(uCoastW, 0.5);
  float near = clamp(hw + 0.5 - abs(d), 0.0, 1.0) * min(1.0, uCoastW * 2.0) * step(1e-5, gm);
  float far = (1.0 - smoothstep(0.1, 0.34, abs(m - 0.5))) * min(1.0, uCoastW * 1.6) * uLandOn;
  float coast = mix(far, near, mag);
  col = mix(col, uCoast.rgb, coast * uCoast.a * smoothstep(0.0, 0.25, facing));
  gl_FragColor = vec4(col, 1.0);
}`;

/** The land field on the Earth (null: the sea alone, until it is drawn). */
export function setEarthLand(m: ShaderMaterial, tex: DataTexture | null) {
  const u = m.uniforms;
  u.uLand.value = tex;
  u.uLandOn.value = tex ? 1 : 0;
  if (tex) (u.uLandSize.value as Vector2).set(tex.image.width, tex.image.height);
}

export function earthMesh(tex: Texture | null): Mesh<SphereGeometry, ShaderMaterial> {
  const mat = new ShaderMaterial({
    vertexShader: EARTH_VS,
    fragmentShader: EARTH_FS,
    uniforms: {
      uLand: { value: tex }, uLandSize: { value: new Vector2(1, 1) }, uLandOn: { value: 0 }, uCoast: { value: new Vector4() }, uCoastW: { value: 0.5 },
      uOcean0: { value: new Vector4() }, uOcean1: { value: new Vector4() }, uLand0: { value: new Vector4() }, uLand1: { value: new Vector4() },
      uGrid: { value: new Vector4() }, uNight: { value: new Vector4() }, uAtmo: { value: new Vector4() },
      uSun: { value: new Vector3(1, 0, 0) }, uNightS: { value: new Vector2(NIGHT_S[0], NIGHT_S[1]) }, uGlint: { value: 0 }, uDayLift: { value: 0 },
    },
  });
  return new Mesh(new SphereGeometry(1, 160, 96), mat);
}

export function inkEarth(m: ShaderMaterial, ink: GlobeInk) {
  const u = m.uniforms;
  u.uOcean0.value = v4(ink.ocean0);
  u.uOcean1.value = v4(ink.ocean1);
  u.uLand0.value = v4(ink.land0);
  u.uLand1.value = v4(ink.land1);
  u.uGrid.value = v4(ink.grid);
  u.uNight.value = v4(ink.night);
  u.uAtmo.value = v4(ink.atmo);
  u.uCoast.value = v4(ink.coast);
  u.uGlint.value = ink.glint;
  u.uDayLift.value = ink.dayLift;
}

// ---------- the atmosphere ----------

const ATMO_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ATMO_FS = /* glsl */ `
uniform vec4 uAtmo;
uniform float uR;
varying vec3 vN;
varying vec3 vW;
void main() {
  // How far outside the Earth's disc this ray passes: 0 at the limb, 1 at the halo's outer edge.
  vec3 V = normalize(vW - cameraPosition);
  vec3 C = -cameraPosition;
  float along = dot(C, V);
  float miss = sqrt(max(0.0, dot(C, C) - along * along));
  float x = clamp((miss - 1.0) / (uR - 1.0), 0.0, 1.0);
  float a = pow(1.0 - x, 3.2) * uAtmo.a;
  gl_FragColor = vec4(uAtmo.rgb, a);
}`;

/** A soft glow round the Earth's limb (a back-facing shell, fading out with the distance from the disc). */
export function atmosphereMesh(): Mesh<SphereGeometry, ShaderMaterial> {
  const R = 1.11;
  const mat = new ShaderMaterial({
    vertexShader: ATMO_VS,
    fragmentShader: ATMO_FS,
    uniforms: { uAtmo: { value: new Vector4() }, uR: { value: R } },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
  return new Mesh(new SphereGeometry(R, 96, 48), mat);
}

export function inkAtmosphere(m: ShaderMaterial, ink: GlobeInk, additive: boolean) {
  m.uniforms.uAtmo.value = v4(ink.atmo);
  m.blending = additive ? AdditiveBlending : NormalBlending;
  m.needsUpdate = true;
}

// ---------- borders ----------

/*
 * Ribbons a constant width in screen px: each point's two vertices pushed apart across the line on screen (along the
 * mitre of the segments either side), the outer pixel faded for anti-aliasing. Hidden on the far side, easing out
 * towards the limb, and faded where the land field says sea (a border's end never pokes past the smoothed coast).
 */
const RIBBON_VS = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
uniform vec2 uRes;
uniform float uHalfW;
varying float vD;
varying float vFace;
varying vec3 vP;
vec2 scr(vec4 c) { return c.xy / c.w * uRes * 0.5; }
void main() {
  mat4 pv = projectionMatrix * viewMatrix * modelMatrix;
  vec4 c = pv * vec4(position, 1.0);
  vec2 s = scr(c);
  vec2 d1 = s - scr(pv * vec4(aPrev, 1.0));
  vec2 d2 = scr(pv * vec4(aNext, 1.0)) - s;
  float l1 = length(d1);
  float l2 = length(d2);
  vec2 t1 = l1 > 1e-4 ? d1 / l1 : (l2 > 1e-4 ? d2 / l2 : vec2(1.0, 0.0));
  vec2 t2 = l2 > 1e-4 ? d2 / l2 : t1;
  vec2 t = t1 + t2;
  t = length(t) > 1e-3 ? normalize(t) : t1;
  vec2 nrm = vec2(-t.y, t.x);
  float mitre = 1.0 / max(dot(nrm, vec2(-t1.y, t1.x)), 0.5);
  float e = max(uHalfW, 0.5) + 1.0;
  c.xy += nrm * (aSide * e * mitre) / (uRes * 0.5) * c.w;
  vD = aSide * e;
  vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
  vFace = dot(normalize(w), normalize(cameraPosition - w));
  vP = position;
  gl_Position = c;
}`;
const RIBBON_FS = /* glsl */ `
uniform vec4 uColor;
uniform float uHalfW;
uniform sampler2D uLand;
uniform float uLandOn;
varying float vD;
varying float vFace;
varying vec3 vP;
void main() {
  if (vFace < 0.0) discard;
  float hw = max(uHalfW, 0.5);
  float a = clamp(hw + 0.5 - abs(vD), 0.0, 1.0) * min(1.0, uHalfW * 2.0);
  vec3 n = normalize(vP);
  vec2 uv = vec2(atan(-n.z, n.x) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  float land = mix(1.0, smoothstep(0.3, 0.7, texture2D(uLand, uv).r), uLandOn);
  a *= uColor.a * smoothstep(0.0, 0.25, vFace) * land;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor.rgb, a);
}`;

/** Anti-aliased lines on the sphere from ribbon geometry (globeLand.ribbons). */
export function ribbonMesh(r: Ribbon): Mesh<BufferGeometry, ShaderMaterial> {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(r.pos, 3));
  geo.setAttribute('aPrev', new BufferAttribute(r.prev, 3));
  geo.setAttribute('aNext', new BufferAttribute(r.next, 3));
  geo.setAttribute('aSide', new BufferAttribute(r.side, 1));
  geo.setIndex(new BufferAttribute(r.idx, 1));
  const mat = new ShaderMaterial({
    vertexShader: RIBBON_VS,
    fragmentShader: RIBBON_FS,
    uniforms: { uColor: { value: new Vector4() }, uHalfW: { value: 0.5 }, uRes: { value: new Vector2(1, 1) }, uLand: { value: null }, uLandOn: { value: 0 } },
    transparent: true,
    depthWrite: false,
    // The strip's winding on screen follows the line's direction.
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** A ribbon's look this frame: colour, width in css px, the drawing buffer's size and its px per css px. */
export function styleRibbon(m: ShaderMaterial, color: RGBA, widthCss: number, bufW: number, bufH: number, pr: number, land: Texture | null) {
  const u = m.uniforms;
  (u.uColor.value as Vector4).set(color[0], color[1], color[2], color[3]);
  u.uHalfW.value = (widthCss * pr) / 2;
  (u.uRes.value as Vector2).set(bufW, bufH);
  u.uLand.value = land;
  u.uLandOn.value = land ? 1 : 0;
}

// ---------- flight arcs ----------

/*
 * v0.18 flight arcs lift off the surface (higher for longer sectors) and are drawn as screen-px ribbons (each point's
 * two vertices pushed apart across the line on screen, as the borders): a lifted arc seen side-on near the limb keeps
 * its width. Hidden where the Earth is in front of them (a ray test against the sphere, so an arc rising over the limb
 * still shows against space). The flown part is solid and brightens towards the aircraft; the part to go is dashed,
 * the dashes drifting gently towards the destination while the clock runs.
 */
const ARC_VS = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSign;
attribute float aT;
attribute float aLen;
uniform vec2 uRes;
uniform float uHalfW;
varying float vSign;
varying float vT;
varying float vLen;
varying vec3 vW;
vec2 scr(vec4 c) { return c.xy / c.w * uRes * 0.5; }
void main() {
  mat4 pv = projectionMatrix * viewMatrix * modelMatrix;
  vec4 c = pv * vec4(position, 1.0);
  vec2 s = scr(c);
  vec2 d1 = s - scr(pv * vec4(aPrev, 1.0));
  vec2 d2 = scr(pv * vec4(aNext, 1.0)) - s;
  float l1 = length(d1);
  float l2 = length(d2);
  vec2 t1 = l1 > 1e-4 ? d1 / l1 : (l2 > 1e-4 ? d2 / l2 : vec2(1.0, 0.0));
  vec2 t2 = l2 > 1e-4 ? d2 / l2 : t1;
  vec2 t = t1 + t2;
  t = length(t) > 1e-3 ? normalize(t) : t1;
  vec2 nrm = vec2(-t.y, t.x);
  float mitre = 1.0 / max(dot(nrm, vec2(-t1.y, t1.x)), 0.5);
  float e = max(uHalfW, 0.5) + 1.0;
  c.xy += nrm * (aSign * e * mitre) / (uRes * 0.5) * c.w;
  vSign = aSign * e;
  vT = aT;
  vLen = aLen;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = c;
}`;

const ARC_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSplit;
uniform vec2 uDashA;
uniform vec2 uDashB;
uniform float uHalfW;
uniform float uFlow;
uniform float uTail;
varying float vSign;
varying float vT;
varying float vLen;
varying vec3 vW;
float dashed(vec2 d, float len) {
  if (d.x <= 0.0) return 1.0;
  float m = mod(len, d.x + d.y);
  float w = fwidth(len) * 0.6;
  return 1.0 - smoothstep(d.x - w, d.x + w, m);
}
void main() {
  // Behind the Earth? (the ray from the camera meets the sphere first)
  vec3 o = cameraPosition;
  vec3 dv = vW - o;
  float L = length(dv);
  vec3 d = dv / L;
  float b = dot(o, d);
  float c = dot(o, o) - 0.996;
  float disc = b * b - c;
  if (disc > 0.0) {
    float t0 = -b - sqrt(disc);
    if (t0 > 0.0 && t0 < L) discard;
  }
  bool flown = vT <= uSplit;
  float on = flown ? dashed(uDashA, vLen) : dashed(uDashB, vLen - uFlow);
  float hw = max(uHalfW, 0.5);
  float edge = clamp(hw + 0.5 - abs(vSign), 0.0, 1.0) * min(1.0, uHalfW * 2.0);
  float tail = flown && uSplit > 0.0 ? mix(uTail, 1.0, smoothstep(0.0, uSplit, vT)) : 1.0;
  float a = uOpacity * on * edge * tail;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/**
 * Ribbon geometry along [lon, lat] samples at radius r, lifted `lift` (Earth radii) at its middle (liftAt): two
 * vertices per sample, with the neighbours either side for the screen-space width.
 */
export function arcGeometry(pts: [number, number][], r: number, lift = 0): BufferGeometry {
  const n = pts.length;
  const P: Vec3[] = pts.map(([lon, lat], i) => vecOf(lon, lat, r + liftAt(lift, n > 1 ? i / (n - 1) : 0)));
  const pos = new Float32Array(n * 6);
  const prev = new Float32Array(n * 6);
  const next = new Float32Array(n * 6);
  const sign = new Float32Array(n * 2);
  const tt = new Float32Array(n * 2);
  const len = new Float32Array(n * 2);
  let L = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) L += Math.hypot(...sub(P[i], P[i - 1]));
    const A = P[Math.max(0, i - 1)];
    const B = P[Math.min(n - 1, i + 1)];
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      pos.set(P[i], j * 3);
      prev.set(A, j * 3);
      next.set(B, j * 3);
      sign[j] = k ? 1 : -1;
      tt[j] = n > 1 ? i / (n - 1) : 0;
      len[j] = L;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPrev', new Float32BufferAttribute(prev, 3));
  geo.setAttribute('aNext', new Float32BufferAttribute(next, 3));
  geo.setAttribute('aSign', new Float32BufferAttribute(sign, 1));
  geo.setAttribute('aT', new Float32BufferAttribute(tt, 1));
  geo.setAttribute('aLen', new Float32BufferAttribute(len, 1));
  geo.setIndex(idx);
  return geo;
}

export interface ArcStyle {
  /** sRGB colour. */
  color: [number, number, number];
  opacity: number;
  /** Width in screen px. */
  width: number;
  /** Dash before and after the split (screen px, null = solid); split in 0..1 along the leg (-1: all `after`). */
  before: [number, number] | null;
  after: [number, number] | null;
  split: number;
  /** v0.18 the flown part's opacity at take-off (it brightens to the aircraft); 1: even. */
  tail?: number;
  /** v0.18 how far the dashes ahead have drifted (screen px; 0: still). */
  flow?: number;
}

export function arcMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: ARC_VS,
    fragmentShader: ARC_FS,
    uniforms: {
      uHalfW: { value: 1 }, uRes: { value: new Vector2(1, 1) }, uColor: { value: new Vector3(1, 1, 1) }, uOpacity: { value: 1 }, uSplit: { value: -1 },
      uDashA: { value: new Vector2(0, 0) }, uDashB: { value: new Vector2(0, 0) }, uFlow: { value: 0 }, uTail: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** The view an arc is drawn for this frame: world units per screen px, the drawing buffer (px) and its px per css px. */
export interface ArcView { wpp: number; bufW: number; bufH: number; pr: number }

/** Sets an arc's look for this frame. */
export function styleArc(m: ShaderMaterial, st: ArcStyle, v: ArcView) {
  const u = m.uniforms;
  u.uHalfW.value = (st.width * v.pr) / 2;
  (u.uRes.value as Vector2).set(v.bufW, v.bufH);
  (u.uColor.value as Vector3).set(st.color[0], st.color[1], st.color[2]);
  u.uOpacity.value = st.opacity;
  u.uSplit.value = st.split;
  u.uTail.value = st.tail ?? 1;
  u.uFlow.value = (st.flow ?? 0) * v.wpp;
  (u.uDashA.value as Vector2).set(st.before ? st.before[0] * v.wpp : 0, st.before ? st.before[1] * v.wpp : 0);
  (u.uDashB.value as Vector2).set(st.after ? st.after[0] * v.wpp : 0, st.after ? st.after[1] * v.wpp : 0);
}

// ---------- airports ----------

const AP_VS = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uDpr;
varying vec4 vColor;
varying float vSize;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float face = dot(normalize(w.xyz), normalize(cameraPosition - w.xyz));
  vColor = aColor;
  vSize = aSize * uDpr;
  gl_PointSize = face > 0.02 ? vSize : 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const AP_FS = /* glsl */ `
uniform vec4 uRing;
varying vec4 vColor;
varying float vSize;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float px = 2.0 / max(vSize, 1.0);
  float disc = 1.0 - smoothstep(1.0 - px, 1.0, d);
  float inner = 1.0 - smoothstep(0.62 - px, 0.62, d);
  vec3 c = mix(uRing.rgb, vColor.rgb, inner);
  float a = disc * mix(uRing.a, vColor.a, inner);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
}`;

/** Airport dots (screen-px sized, round, with a thin halo ring), hidden on the far side. */
export function airportPoints(): Points<BufferGeometry, ShaderMaterial> {
  const mat = new ShaderMaterial({ vertexShader: AP_VS, fragmentShader: AP_FS, uniforms: { uDpr: { value: 1 }, uRing: { value: new Vector4() } }, transparent: true, depthWrite: false });
  return new Points(new BufferGeometry(), mat);
}

export function setAirports(p: Points<BufferGeometry, ShaderMaterial>, list: { pos: Vec3; color: RGBA; size: number }[]) {
  const pos = new Float32Array(list.length * 3);
  const col = new Float32Array(list.length * 4);
  const size = new Float32Array(list.length);
  list.forEach((a, i) => {
    pos.set(a.pos, i * 3);
    col.set(a.color, i * 4);
    size[i] = a.size;
  });
  p.geometry.dispose();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new Float32BufferAttribute(col, 4));
  geo.setAttribute('aSize', new Float32BufferAttribute(size, 1));
  p.geometry = geo;
}

// ---------- aircraft ----------

/** Texture size (px) and the silhouette's largest dimension in it. */
const TEX = 128;
const TEX_SIL = 112;
/** Side of an aircraft's quad in units of its largest dimension. */
export const QUAD_PER_DIM = TEX / TEX_SIL;

/** Largest dimension of a type (m). */
export const dimM = (typeId: string) => {
  const s = silSpec(typeId);
  return Math.max(s.L, s.S);
};

/**
 * A top-down silhouette as a texture (nose up), painted like the flat map's icon: fill, a contrasting outline, the
 * engines and upper deck in their own shade. `kind` 'own' or 'airline' (the grey of an airline leg).
 */
export function silTexture(typeId: string, ink: { fill: string; edge: string; eng: string; deck: string }, maxAniso: number, edgeW = 2): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = TEX;
  cv.height = TEX;
  const c = cv.getContext('2d')!;
  const sil = silhouette(typeId, TEX_SIL);
  // The flat map's outline (2 px on a glyph built at 0.6 px per metre), scaled to this texture's size.
  const k = TEX_SIL / dimM(typeId);
  const sw = edgeW * (k / 0.6) * 0.62;
  c.translate(TEX / 2, TEX / 2);
  c.lineJoin = 'round';
  const eng = new Path2D(sil.engines);
  const body = new Path2D(sil.body);
  c.strokeStyle = ink.edge;
  c.lineWidth = sw * 0.6 * 2;
  c.stroke(eng);
  c.fillStyle = ink.eng;
  c.fill(eng);
  c.lineWidth = sw * 2;
  c.stroke(body);
  c.fillStyle = ink.fill;
  c.fill(body);
  if (sil.deck) {
    c.fillStyle = ink.deck;
    c.fill(new Path2D(sil.deck));
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = Math.min(4, maxAniso);
  return tex;
}

export function acMaterial(tex: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.02 });
}

// ---------- v0.18 3D aircraft ----------

const geoCache = new Map<string, BufferGeometry>();

/** A type's 3D model as a three.js geometry (metres; x to the right wing, y to the nose, z up), cached. */
export function modelGeometry(typeId: string): BufferGeometry {
  let g = geoCache.get(typeId);
  if (!g) {
    const m = modelOf(typeId);
    g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(m.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(m.col, 3));
    geoCache.set(typeId, g);
  }
  return g;
}

/** Frees the cached model geometries (the globe closing). */
export function disposeModels() {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}

/** A lit material in a livery colour (the model's per-vertex shades tint it: nacelles darker). */
export function modelMaterial(colour: string): MeshLambertMaterial {
  return new MeshLambertMaterial({ color: new Color(colour), vertexColors: true, side: DoubleSide });
}

/**
 * The soft shadow of a type seen from above (black, blurred), as a texture laid on the ground under the aircraft. Built
 * with the canvas's own shadow blur (drawn off the canvas, its shadow falls on it), which every browser supports.
 */
export function shadowTexture(typeId: string, maxAniso: number): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = TEX;
  cv.height = TEX;
  const c = cv.getContext('2d')!;
  const sil = silhouette(typeId, TEX_SIL * 0.92);
  c.translate(TEX / 2 - 1000, TEX / 2);
  c.shadowColor = 'rgba(0, 0, 0, 1)';
  c.shadowBlur = 5;
  c.shadowOffsetX = 1000;
  c.fillStyle = '#000';
  c.fill(new Path2D(sil.body));
  c.fill(new Path2D(sil.engines));
  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = Math.min(4, maxAniso);
  return tex;
}

/** A shadow's material at a darkness (0..1). */
export function shadowMaterial(tex: Texture, alpha: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: alpha, depthWrite: false });
}

/** Two soft white streaks fading out behind the engines (a contrail), along the texture's height (the engines at the top). */
export function trailTexture(): CanvasTexture {
  const W = 64;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  for (const x of [W * 0.3, W * 0.7]) {
    for (let y = 0; y < H; y++) {
      const f = y / H;
      const a = (f < 0.06 ? f / 0.06 : 1) * (1 - f) ** 1.6 * 0.9;
      const w = 2.2 + f * 5;
      const g = c.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(x - w, y, w * 2, 1);
    }
  }
  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}
