// v0.15 the 3D globe's three.js pieces: the Earth (land mask texture, vector coasts and borders, a soft graticule, the
// real sun's day and night, an atmosphere rim), flight arcs as ribbons on the sphere (screen-px wide, flown part solid,
// the rest dashed), airport dots and the aircraft silhouettes as textures. Loaded only with the globe (its own chunk).

import { geoEquirectangular, geoPath } from 'd3-geo';
import type { MultiLineString, MultiPolygon } from 'geojson';
import {
  AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, LinearMipmapLinearFilter, LineSegments, Mesh, MeshBasicMaterial,
  NormalBlending, Points, ShaderMaterial, SphereGeometry, SRGBColorSpace, type Texture, Vector2, Vector3, Vector4,
} from 'three';
import { silhouette, silSpec } from '../silhouettes';
import { NIGHT_S, type Vec3, cross, norm, sub, vecOf } from './globeLogic';

export type RGBA = [number, number, number, number];

/** Theme colours the globe paints with (sRGB, 0..1), read from the page's CSS custom properties. */
export interface GlobeInk {
  ocean0: RGBA; ocean1: RGBA; land0: RGBA; land1: RGBA; coast: RGBA; border: RGBA; grid: RGBA;
  night: RGBA; atmo: RGBA; glint: number; dayLift: number; pin: RGBA; ring: RGBA; halo: RGBA;
}

const v4 = (c: RGBA) => new Vector4(c[0], c[1], c[2], c[3]);

// ---------- the land mask ----------

/** v0.15 the land as a mask (red = land) on an equirectangular canvas, `w` × w/2. */
export function landMask(land: MultiPolygon, w: number): HTMLCanvasElement {
  const h = w / 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  const proj = geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]).precision(0.1);
  c.beginPath();
  geoPath(proj, c)(land);
  c.fillStyle = '#f00';
  c.fill();
  return cv;
}

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
uniform sampler2D uLand;
uniform vec4 uOcean0; uniform vec4 uOcean1; uniform vec4 uLand0; uniform vec4 uLand1; uniform vec4 uGrid; uniform vec4 uNight; uniform vec4 uAtmo;
uniform vec3 uSun; uniform vec2 uNightS; uniform float uGlint; uniform float uDayLift;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
float gridLine(float v, float step) {
  float f = abs(fract(v / step + 0.5) - 0.5) * step;
  float w = fwidth(v);
  return 1.0 - smoothstep(0.0, w * 1.2, f);
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  // The land edge drawn crisp from a soft mask (the bilinear contour at 0.5, a pixel wide at any zoom).
  float m = texture2D(uLand, vUv).r;
  float aw = max(fwidth(m) * 0.7, 0.002);
  float land = smoothstep(0.5 - aw, 0.5 + aw, m);
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
  gl_FragColor = vec4(col, 1.0);
}`;

export function earthMesh(tex: Texture | null): Mesh<SphereGeometry, ShaderMaterial> {
  const mat = new ShaderMaterial({
    vertexShader: EARTH_VS,
    fragmentShader: EARTH_FS,
    uniforms: {
      uLand: { value: tex },
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

// ---------- coasts and borders ----------

const LINE_VS = /* glsl */ `
varying float vFace;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vFace = dot(normalize(w.xyz), normalize(cameraPosition - w.xyz));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LINE_FS = /* glsl */ `
uniform vec4 uColor;
varying float vFace;
void main() {
  if (vFace < 0.0) discard;
  gl_FragColor = vec4(uColor.rgb, uColor.a * smoothstep(0.0, 0.25, vFace));
}`;

const nearSeam = (a: number[], b: number[]) => (Math.abs(a[0]) > 179.99 && Math.abs(b[0]) > 179.99) || (a[1] < -89.9 && b[1] < -89.9);

/** Line segments on the sphere (coastlines from the land's rings, or the borders), skipping the antimeridian cut. */
export function geoLines(lines: number[][][], r: number): LineSegments<BufferGeometry, ShaderMaterial> {
  const pos: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (nearSeam(a, b)) continue;
      pos.push(...vecOf(a[0], a[1], r), ...vecOf(b[0], b[1], r));
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new ShaderMaterial({ vertexShader: LINE_VS, fragmentShader: LINE_FS, uniforms: { uColor: { value: new Vector4() } }, transparent: true, depthWrite: false });
  return new LineSegments(geo, mat);
}

export const coastLines = (land: MultiPolygon) => land.coordinates.flat();
export const borderLines = (b: MultiLineString) => b.coordinates;

// ---------- flight arcs ----------

const ARC_VS = /* glsl */ `
attribute vec3 aSide;
attribute float aSign;
attribute float aT;
attribute float aLen;
uniform float uHalfW;
varying float vSign;
varying float vT;
varying float vLen;
varying float vFace;
void main() {
  vSign = aSign;
  vT = aT;
  vLen = aLen;
  vec4 w = modelMatrix * vec4(position + aSide * aSign * uHalfW, 1.0);
  vFace = dot(normalize(position), normalize(cameraPosition - w.xyz));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ARC_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSplit;
uniform vec2 uDashA;
uniform vec2 uDashB;
varying float vSign;
varying float vT;
varying float vLen;
varying float vFace;
float dashed(vec2 d, float len) {
  if (d.x <= 0.0) return 1.0;
  float m = mod(len, d.x + d.y);
  float w = fwidth(len) * 0.6;
  return 1.0 - smoothstep(d.x - w, d.x + w, m);
}
void main() {
  if (vFace < 0.0) discard;
  float on = vT <= uSplit ? dashed(uDashA, vLen) : dashed(uDashB, vLen);
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSign));
  float a = uOpacity * on * edge * smoothstep(0.0, 0.2, vFace);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** Ribbon geometry along [lon, lat] samples at radius r: two vertices per sample (left and right of the track). */
export function arcGeometry(pts: [number, number][], r: number): BufferGeometry {
  const n = pts.length;
  const P: Vec3[] = pts.map(([lon, lat]) => vecOf(lon, lat, r));
  const pos = new Float32Array(n * 6);
  const side = new Float32Array(n * 6);
  const sign = new Float32Array(n * 2);
  const tt = new Float32Array(n * 2);
  const len = new Float32Array(n * 2);
  let L = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) L += Math.hypot(...sub(P[i], P[i - 1]));
    const T = norm(sub(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]));
    const S = norm(cross(norm(P[i]), T));
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      pos.set(P[i], j * 3);
      side.set(S, j * 3);
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
  geo.setAttribute('aSide', new Float32BufferAttribute(side, 3));
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
}

export function arcMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: ARC_VS,
    fragmentShader: ARC_FS,
    uniforms: {
      uHalfW: { value: 0.001 }, uColor: { value: new Vector3(1, 1, 1) }, uOpacity: { value: 1 }, uSplit: { value: -1 },
      uDashA: { value: new Vector2(0, 0) }, uDashB: { value: new Vector2(0, 0) },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** Sets an arc's look for this frame (`wpp`: world units per screen px). */
export function styleArc(m: ShaderMaterial, st: ArcStyle, wpp: number) {
  const u = m.uniforms;
  u.uHalfW.value = (st.width / 2) * wpp * 1.35;
  (u.uColor.value as Vector3).set(st.color[0], st.color[1], st.color[2]);
  u.uOpacity.value = st.opacity;
  u.uSplit.value = st.split;
  (u.uDashA.value as Vector2).set(st.before ? st.before[0] * wpp : 0, st.before ? st.before[1] * wpp : 0);
  (u.uDashB.value as Vector2).set(st.after ? st.after[0] * wpp : 0, st.after ? st.after[1] * wpp : 0);
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
