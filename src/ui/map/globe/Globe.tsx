// v0.15 the 3D globe on the Ops Map (lazy: three.js and this file load only when the player opens the globe). The Earth
// from the same world atlas as the flat map, the real sun's day and night, our aircraft as their to-scale silhouettes on
// their great circles (the flat map's positions: aircraftLive, the dry-lease show legs, the airline legs our crew and
// travellers ride), airport dots, the selected aircraft's track and next legs, world tours. Drag to spin (with inertia),
// pinch or wheel to zoom, tap to select (the same panels as the flat map), double tap or the house button for home.
// Renders only when something moved: the camera, the game clock or the data; never while the page is hidden.

import { House, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type BufferGeometry, CanvasTexture, type DataTexture, Group, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, type MeshBasicMaterial, type ShaderMaterial } from 'three';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import type { Flight, GameState, Ref } from '../../../engine/core/types';
import { commercialFlightsBetween, commercialProgress, type CommercialFlight, type FlightType, flightType } from '../../../engine/ops';
import { registerCaptureCanvas } from '../../bugShot';
import { liveMinute, store } from '../../store';
import type { Theme } from '../../theme';
import { isTouch } from '../../useMedia';
import { airlineType } from '../airlineTypes';
import { HIT_R, inkOf } from '../LiveLayers';
import { groupCommercial, type LegArc, pickNearest, placeLabels, regMark, standOffsets, TYPE_STROKE, type LabelBox } from '../mapLogic';
import { loadMapData, worldGeo } from '../mapData';
import { silColour } from '../silhouettes';
import type { MapAirport, MapRoute } from '../WorldMap';
import {
  acMaterial, airportPoints, arcGeometry, arcMaterial, type ArcStyle, atmosphereMesh, dimM, earthMesh, type GlobeInk, inkAtmosphere, inkEarth, landTexture, QUAD_PER_DIM,
  ribbonMesh, type RGBA, setAirports, setEarthLand, silTexture, styleArc, styleRibbon,
} from './globeGL';
import { borderLines, drawLandField, fieldWidth, landFieldHere, ribbons } from './globeLand';
import {
  aimAt, angleBetween, camOf, clampDist, clampLat, dashOf, degPerPx, DIST_START, FOV, facing, gcTrack, globeFleet, globePxPerM, headingVec, IDLE_AFTER_MS, IDLE_SPIN_DEG_S, legTrack,
  lerpOrbit, type Orbit, parseColour, project, stepInertia, sunVec, tangentsAt, vecOf, worldPerPx, wrap180, type GlobeAc, type Vec3,
} from './globeLogic';
import './globe.css';

export interface GlobeProps {
  g: GameState;
  airports: MapAirport[];
  /** The selected aircraft's next legs (not the one it is flying). */
  nextArcs: LegArc[];
  /** World tours under way. */
  tours: MapRoute[];
  sel?: Ref;
  theme: Theme;
  /** The airline's accent (hub dots), as on the flat map. */
  accent: string;
  /** A panel is open on the right: selections are brought into view clear of it. */
  panelOpen: boolean;
  onFlat: () => void;
  /** No WebGL 2 here (the globe needs it): back to the flat map, quietly (not an error). */
  onUnavailable?: () => void;
}

/** Can this browser draw the globe? (three.js needs WebGL 2; a throwaway canvas, released at once.) */
function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Panel width (px) a selection is kept clear of, as on the flat map. */
const PANEL_W = 360;
/** Coast and border widths (css px; the coast is drawn in the Earth's own shader, on the land field's edge). */
const COAST_W = 0.8;
const BORDER_W = 0.7;
/** The small land field shown while the full one is drawn (texels round the world). */
const FIELD_FIRST = 1024;
/** Radii (Earth radii) of what lies on the globe, lowest first. */
const R_BORDER = 1.0003;
const R_ARC = 1.0011;
const R_AP = 1.0016;
const R_AC = 1.0024;
/** Labels, rings and taps only where the ground faces the camera well (not foreshortened at the limb). */
const LABEL_COS = 0.28;
/** Airline legs are fetched for this many game minutes at a time, as on the flat map. */
const CM_BUCKET = 10;
/** Dash of the part still to fly (screen px), as on the flat map. */
const AHEAD_DASH: Record<FlightType, string> = { operating: '6 5', positioning: TYPE_STROKE.positioning.dash, ferry: TYPE_STROKE.ferry.dash, deadhead: TYPE_STROKE.deadhead.dash };

/** The camera per game, so closing and reopening the globe (or a tab switch) comes back to the same view. */
const orbits = new WeakMap<GameState, Orbit>();

/** Frame cost stats for perf checks (console: __bhGlobe); `aim` turns the open globe to a place (checks, screenshots). */
const stats = { frames: 0, avgMs: 0, maxMs: 0, landMs: 0, reset() { this.frames = 0; this.avgMs = 0; this.maxMs = 0; }, aim: null as null | ((lon: number, lat: number, dist?: number) => void) };
(globalThis as unknown as { __bhGlobe?: typeof stats }).__bhGlobe = stats;

const cssVar = (name: string) => (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name) : '');
/** A colour token ('var(--x)' or a colour) as sRGB 0..1. */
const colourOf = (s: string, dflt: RGBA = [1, 1, 1, 1]): RGBA => {
  const m = /^var\((--[\w-]+)\)$/.exec(s.trim());
  return parseColour(m ? cssVar(m[1]) : s, dflt);
};

function readInk(theme: Theme): GlobeInk {
  const dark = theme !== 'light';
  const nightRgb = parseColour(cssVar('--map-night-rgb'), [0.01, 0.02, 0.06, 1]);
  const nightA = Number.parseFloat(cssVar('--map-night-a'));
  const coast = colourOf('var(--map-coast)', [0.47, 0.63, 0.9, 0.28]);
  // On light the sea a shade deeper than the flat map's, so white land still reads on a lit sphere.
  const sea = (c: RGBA): RGBA => (dark ? c : [c[0] * 0.93, c[1] * 0.95, c[2] * 0.98, c[3]]);
  return {
    ocean0: sea(colourOf('var(--map-ocean-0)', [0.05, 0.08, 0.16, 1])),
    ocean1: sea(colourOf('var(--map-ocean-1)', [0.02, 0.035, 0.07, 1])),
    land0: colourOf('var(--map-land-0)', [0.1, 0.15, 0.25, 1]),
    land1: colourOf('var(--map-land-1)', [0.07, 0.11, 0.2, 1]),
    // Coasts a touch stronger than on the flat map: the globe has no fill gradient to show the shore.
    coast: [coast[0], coast[1], coast[2], Math.min(1, coast[3] * (dark ? 1.9 : 1.5))],
    border: colourOf('var(--map-border)', [0.6, 0.7, 0.9, 0.13]),
    grid: colourOf('var(--map-grid)', [0.47, 0.59, 0.82, 0.07]),
    night: [nightRgb[0], nightRgb[1], nightRgb[2], Number.isFinite(nightA) ? (dark ? nightA * 1.15 : nightA * 1.6) : 0.5],
    atmo: dark ? [0.36, 0.62, 1, 0.62] : [0.42, 0.6, 0.92, 0.5],
    glint: dark ? 0.16 : 0.08,
    dayLift: dark ? 0.45 : 0,
    pin: colourOf('var(--map-pin)', [1, 1, 1, 1]),
    ring: colourOf('var(--map-ring)', [1, 1, 1, 1]),
    halo: [...parseColour(cssVar('--halo-rgb'), [0.02, 0.035, 0.07, 1]).slice(0, 3), 0.85] as RGBA,
  };
}

interface AcObj { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; typeId: string; label: HTMLSpanElement; dim: number }
interface ArcObj { mesh: Mesh; key: string; mat: ShaderMaterial }
interface CmObj { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; arc: ArcObj; cf: CommercialFlight; typeId: string; dim: number; pts: [number, number][] }

export default function Globe(props: GlobeProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const selRingRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** The loop's hooks for the buttons and the props effects. */
  const api = useRef<{ kick: () => void; zoom: (f: number) => void; home: () => void; propsChanged: () => void } | null>(null);
  const [fail, setFail] = useState<Error | null>(null);
  if (fail) throw fail;

  useEffect(() => {
    const stage = stageRef.current!;
    const labelsEl = labelsRef.current!;
    const selRing = selRingRef.current!;
    if (!hasWebGL2()) {
      console.info('[Block Hours] no WebGL 2 here: the Map stays flat');
      propsRef.current.onUnavailable?.();
      return;
    }
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      setFail(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const touch = isTouch();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'globe-canvas';
    stage.appendChild(renderer.domElement);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new Scene();
    const camera = new PerspectiveCamera(FOV, 1, 0.01, 40);
    // v0.17.1 the bug button's screenshot draws a fresh frame and reads it at once (no picture is kept after showing).
    const unCapture = registerCaptureCanvas(renderer.domElement, () => renderer.render(scene, camera));
    const g0 = propsRef.current.g;
    const home = AIRPORT_BY_CODE[g0.company.homeBase];
    let orbit: Orbit = orbits.get(g0) ?? { lon: home?.lon ?? 0, lat: clampLat(home?.lat ?? 30), dist: DIST_START };

    // ---------- the Earth ----------
    let landTex: DataTexture | null = null;
    const earth = earthMesh(null);
    const atmo = atmosphereMesh();
    scene.add(atmo, earth);
    let borders: Mesh<BufferGeometry, ShaderMaterial> | null = null;
    let disposed = false;
    const loadEarth = async () => {
      try {
        await loadMapData();
        const geo = worldGeo();
        if (!geo || disposed) return;
        // The land as a smooth field (the coast drawn on its edge), the borders as smoothed vector ribbons. A small
        // field first (a few ms) so the land shows at once; the full one is drawn in a worker and takes over.
        borders = ribbonMesh(ribbons(borderLines(geo.borders.coordinates), R_BORDER));
        scene.add(borders);
        const useField = (data: Uint8Array, fw: number) => {
          const old = landTex;
          landTex = landTexture(data, fw, maxAniso);
          setEarthLand(earth.material, landTex);
          old?.dispose();
          dirty = true;
          kick();
        };
        useField(landFieldHere(geo.land, FIELD_FIRST), FIELD_FIRST);
        const tl = performance.now();
        const fw = fieldWidth(renderer.capabilities.maxTextureSize, touch && Math.min(screen.width, screen.height) < 500);
        const data = await drawLandField(geo.land, fw);
        stats.landMs = performance.now() - tl;
        if (disposed) return;
        useField(data, fw);
      } catch (e) {
        console.error('[Block Hours] the globe could not load the world map', e);
      }
    };

    // ---------- what flies ----------
    const quad = new PlaneGeometry(1, 1);
    const acGroup = new Group();
    const arcGroup = new Group();
    const staticArcs = new Group();
    scene.add(staticArcs, arcGroup, acGroup);
    const aps = airportPoints();
    scene.add(aps);
    const texCache = new Map<string, CanvasTexture>();
    const matCache = new Map<string, MeshBasicMaterial>();
    const acMat = (key: string, typeId: string, ink: () => { fill: string; edge: string; eng: string; deck: string }) => {
      let m = matCache.get(key);
      if (!m) {
        const tex = silTexture(typeId, ink(), maxAniso);
        texCache.set(key, tex);
        m = acMaterial(tex);
        matCache.set(key, m);
      }
      return m;
    };
    const acs = new Map<string, AcObj>();
    const ownArcs = new Map<string, ArcObj>();
    const cms = new Map<string, CmObj>();
    let statics: { obj: ArcObj; st: ArcStyle }[] = [];

    const dropArc = (a: ArcObj) => {
      a.mesh.removeFromParent();
      a.mesh.geometry.dispose();
      a.mat.dispose();
    };
    const newArc = (pts: [number, number][], key: string, parent: Group): ArcObj => {
      const mat = arcMaterial();
      const mesh = new Mesh(arcGeometry(pts, R_ARC), mat);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return { mesh, key, mat };
    };

    // ---------- state ----------
    let w = 1;
    let h = 1;
    let raf = 0;
    let running = false;
    let dirty = true;
    let inked = '';
    let ink = readInk(propsRef.current.theme);
    let lastT = NaN;
    let lastFrame = 0;
    let lastRender = 0;
    let lastInteract = performance.now();
    let vel: [number, number] = [0, 0];
    let fly: { from: Orbit; to: Orbit; t0: number; dur: number } | null = null;
    let typeVersion = -1;
    const typeOf = new Map<string, FlightType>();
    let cmKey = '';
    let cmList: CommercialFlight[] = [];
    let staticKey: unknown[] = [];
    let apKey: unknown[] = [];
    let selKey = '';
    let prevLabels = new Set<string>();
    const apLabels = new Map<string, HTMLSpanElement>();
    let fleetNow: GlobeAc[] = [];
    const acScreen = new Map<string, { x: number; y: number; r: number }>();
    const cmScreen = new Map<string, { x: number; y: number; r: number }>();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let spinTimer = 0;
    /** The optional idle spin: a few seconds untouched, nothing selected, no dialog, no reduced motion. */
    const spinning = (now: number) => store.settings.globeSpin && !reduced && !gesture && !propsRef.current.sel && !store.modal && now - lastInteract > IDLE_AFTER_MS;

    const resize = () => {
      // In the page's own css px (labels, taps); Settings › Size zooms the page, so the buffer follows the screen px.
      const r = stage.getBoundingClientRect();
      w = Math.max(1, stage.offsetWidth || Math.round(r.width));
      h = Math.max(1, stage.offsetHeight || Math.round(r.height));
      renderer.setPixelRatio(Math.min(2.5, dpr * (r.width / w || 1)));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
      kick();
    };

    const kick = () => {
      if (running || disposed) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };

    const flyTo = (to: Orbit, dur = 900) => {
      vel = [0, 0];
      if (reduced) {
        orbit = to;
        fly = null;
      } else fly = { from: { ...orbit }, to, t0: performance.now(), dur };
      dirty = true;
      kick();
    };
    const goHome = () => {
      const b = AIRPORT_BY_CODE[store.game?.company.homeBase ?? ''];
      if (!b) return;
      const dist = Math.min(orbit.dist, DIST_START);
      const shift = propsRef.current.panelOpen ? PANEL_W / 2 : 0;
      flyTo({ ...aimAt([b.lon, b.lat], dist, h, shift), dist });
    };

    // ---------- the frame ----------
    const frame = (now: number) => {
      raf = 0;
      if (disposed) return;
      if (document.visibilityState === 'hidden') {
        running = false;
        return;
      }
      const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
      lastFrame = now;
      const game = store.game;
      if (!game) {
        running = false;
        return;
      }
      // The camera: a fly-to, the drag's inertia, or the idle spin.
      let moving = false;
      // v0.15.1 (perf) the idle spin alone: drawn at the clock's rate on touch devices (battery), not every frame.
      let idleSpin = false;
      if (fly) {
        const f = (now - fly.t0) / fly.dur;
        orbit = lerpOrbit(fly.from, fly.to, f);
        if (f >= 1) fly = null;
        moving = true;
      } else if (vel[0] || vel[1]) {
        orbit = { ...orbit, lon: wrap180(orbit.lon + vel[0] * dt), lat: clampLat(orbit.lat + vel[1] * dt) };
        vel = stepInertia(vel, dt);
        moving = true;
      } else if (spinning(now)) {
        orbit = { ...orbit, lon: wrap180(orbit.lon + (IDLE_SPIN_DEG_S * dt) / 1000) };
        moving = true;
        idleSpin = true;
      }
      if (moving) dirty = true;
      const t = liveMinute();
      const timeMoved = t !== lastT && !store.modal;
      if (!dirty && !timeMoved) {
        // Nothing to draw: the loop sleeps until a gesture, a store change or the clock wakes it (or the idle spin is due).
        running = false;
        if (store.settings.globeSpin && !reduced) {
          window.clearTimeout(spinTimer);
          spinTimer = window.setTimeout(kick, Math.max(0, IDLE_AFTER_MS - (now - lastInteract)) + 60);
        }
        return;
      }
      raf = requestAnimationFrame(frame);
      // Only the clock moved (or the idle spin): 30 fps on touch (the flat map's rate); a gesture or fly-to draws every frame.
      if ((!dirty || idleSpin) && touch && now - lastRender < 1000 / 30 - 3) return;
      lastRender = now;
      const t0 = performance.now();
      draw(game, timeMoved || Number.isNaN(lastT) ? t : lastT);
      lastT = timeMoved || Number.isNaN(lastT) ? t : lastT;
      dirty = false;
      const ms = performance.now() - t0;
      stats.frames++;
      stats.avgMs += (ms - stats.avgMs) / Math.min(stats.frames, 120);
      stats.maxMs = Math.max(stats.maxMs, ms);
    };

    const draw = (game: GameState, t: number) => {
      const p = propsRef.current;
      orbits.set(p.g, orbit);
      const cam = camOf(orbit);
      camera.position.set(cam[0], cam[1], cam[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      const wpp = worldPerPx(orbit.dist, h);
      const pxPerM = globePxPerM(orbit.dist, w, h);
      // Theme.
      if (inked !== p.theme) {
        inked = p.theme;
        ink = readInk(p.theme);
        inkEarth(earth.material, ink);
        inkAtmosphere(atmo.material, ink, p.theme !== 'light');
        aps.material.uniforms.uRing.value.set(...ink.halo);
        // Airline greys and route colours are theme tokens too.
        for (const [k, m] of matCache) if (k.startsWith('cm:')) { m.dispose(); texCache.get(k)?.dispose(); matCache.delete(k); texCache.delete(k); }
        for (const c of cms.values()) c.mesh.material = cmMat(c.typeId);
        apKey = [];
        staticKey = [];
      }
      earth.material.uniforms.uSun.value.set(...sunVec(t));
      const pr = renderer.getPixelRatio();
      aps.material.uniforms.uDpr.value = pr;
      earth.material.uniforms.uCoastW.value = (COAST_W * pr) / 2;
      if (borders) styleRibbon(borders.material, ink.border, BORDER_W, w * pr, h * pr, pr, landTex);
      // Airports (rebuilt when the list or the theme changes).
      if (apKey[0] !== p.airports || apKey[1] !== p.accent || apKey[2] !== p.sel?.id) {
        apKey = [p.airports, p.accent, p.sel?.id];
        const accent = colourOf(p.accent, [0.24, 0.9, 1, 1]);
        setAirports(aps, p.airports.flatMap((a) => {
          const ap = AIRPORT_BY_CODE[a.code];
          if (!ap) return [];
          const hub = a.state === 'hub';
          const sel = p.sel?.kind === 'airport' && p.sel.id === a.code;
          return [{ pos: vecOf(ap.lon, ap.lat, R_AP), color: hub ? accent : ink.pin, size: (hub ? 11 : 8) + (sel ? 4 : 0) }];
        }));
        for (const [code, el] of apLabels) if (!p.airports.some((a) => a.code === code)) { el.remove(); apLabels.delete(code); }
      }
      // Static arcs: the selected aircraft's next legs and the world tours.
      if (staticKey[0] !== p.nextArcs || staticKey[1] !== p.tours) {
        staticKey = [p.nextArcs, p.tours];
        for (const s of statics) dropArc(s.obj);
        statics = [];
        p.tours.forEach((r) => {
          const pts = gcTrack(r.from, r.to);
          if (pts.length < 2) return;
          const c = colourOf(r.color ?? 'var(--map-route)');
          statics.push({ obj: newArc(pts, r.id, staticArcs), st: { color: [c[0], c[1], c[2]], opacity: 0.75, width: 1.6, before: null, after: r.dashed ? [5, 5] : null, split: -1 } });
        });
        p.nextArcs.forEach((l, i) => {
          const pts = gcTrack(l.from, l.to);
          if (pts.length < 2) return;
          const c = colourOf(l.color ?? 'var(--map-route)');
          statics.push({ obj: newArc(pts, l.id, staticArcs), st: { color: [c[0], c[1], c[2]], opacity: Math.max(0.3, 0.6 - i * 0.08), width: 1.5, before: null, after: l.dashed ? [5, 5] : null, split: -1 } });
        });
      }
      for (const s of statics) styleArc(s.obj.mat, s.st, wpp);

      // Our aircraft.
      if (typeVersion !== store.version) {
        typeVersion = store.version;
        typeOf.clear();
      }
      const selAc = p.sel?.kind === 'aircraft' ? p.sel.id : undefined;
      const selCm = p.sel?.kind === 'flight' ? p.sel.id : undefined;
      fleetNow = globeFleet(game, t);
      const seen = new Set<string>();
      const seenArcs = new Set<string>();
      // Stands at each airport (screen px, as on the flat map), laid out east and north of the airport.
      const byAp = new Map<string, GlobeAc[]>();
      for (const a of fleetNow) if (!a.airborne && a.at) byAp.set(a.at, [...(byAp.get(a.at) ?? []), a]);
      const stand = new Map<string, [number, number]>();
      for (const list of byAp.values()) {
        const offs = standOffsets(list.map((a) => ({ w: Math.max(dimM(a.typeId) * pxPerM * 1.0, 26), h: dimM(a.typeId) * pxPerM })), 14);
        list.forEach((a, i) => stand.set(a.id, offs[i]));
      }
      acScreen.clear();
      const boxes: (LabelBox & { el: HTMLSpanElement; x0: number; y0: number })[] = [];
      for (const a of fleetNow) {
        const ac = game.fleet[a.id];
        if (!ac) continue;
        seen.add(a.id);
        let o = acs.get(a.id);
        if (!o || o.typeId !== a.typeId) {
          if (o) { o.mesh.removeFromParent(); o.label.remove(); }
          const mat = acMat(`own:${a.typeId}`, a.typeId, () => inkOf(silColour(a.typeId)));
          const mesh = new Mesh(quad, mat);
          mesh.matrixAutoUpdate = false;
          mesh.frustumCulled = false;
          acGroup.add(mesh);
          const label = document.createElement('span');
          label.className = 'gl-reg';
          labelsEl.appendChild(label);
          o = { mesh, typeId: a.typeId, label, dim: dimM(a.typeId) };
          acs.set(a.id, o);
        }
        const mark = regMark(ac.reg, game.company.regPrefix);
        if (o.label.textContent !== mark) o.label.textContent = mark;
        const n = vecOf(a.pos[0], a.pos[1]);
        let at: Vec3 = n;
        let fwd: Vec3;
        if (a.airborne) fwd = headingVec(a.pos, a.ahead);
        else {
          const off = stand.get(a.id) ?? [20, 0];
          const { east, north } = tangentsAt(a.pos);
          at = [n[0] + (east[0] * off[0] - north[0] * off[1]) * wpp, n[1] + (east[1] * off[0] - north[1] * off[1]) * wpp, n[2] + (east[2] * off[0] - north[2] * off[1]) * wpp];
          fwd = north;
        }
        const nn = new Vector3(...at).normalize();
        const side = o.dim * pxPerM * QUAD_PER_DIM * wpp;
        placeQuad(o.mesh, nn, fwd, R_AC, side);
        const visible = facing(at, cam, 0);
        o.mesh.visible = visible;
        const q = facing(at, cam, LABEL_COS) ? project([nn.x * R_AC, nn.y * R_AC, nn.z * R_AC], cam, w, h) : null;
        const rPx = (o.dim * pxPerM) / 2;
        if (q) {
          acScreen.set(a.id, { x: q.x, y: q.y, r: rPx });
          const fs = touch ? 11 : 10;
          boxes.push({ id: a.id, x: q.x, y: q.y + rPx + 8, w: mark.length * fs * 0.62 + 4, h: fs + 2, el: o.label, x0: q.x, y0: q.y + rPx + 3 });
        } else o.label.style.display = 'none';
        // Its track: flown solid, still to fly dashed.
        if (a.airborne) {
          const f = a.flight;
          const key = f ? `${f.id}|${f.atd ?? f.std + f.delay}|${f.ata ?? f.eta ?? ''}|${f.to}|${f.div?.at ?? ''}` : `show:${a.id}|${a.show!.dep}`;
          seenArcs.add(a.id);
          let arc = ownArcs.get(a.id);
          if (!arc || arc.key !== key) {
            if (arc) dropArc(arc);
            const pts = f ? legTrack(f) : gcTrack(a.show!.from, a.show!.to);
            arc = newArc(pts.length > 1 ? pts : [a.pos, a.pos], key, arcGroup);
            ownArcs.set(a.id, arc);
          }
          const type = f ? typeOfFlight(game, f) : 'operating';
          const st = TYPE_STROKE[type];
          const c = colourOf(st.color);
          const sel = selAc === a.id;
          styleArc(arc.mat, { color: [c[0], c[1], c[2]], opacity: sel ? 1 : type === 'operating' ? 0.6 : 0.75, width: sel ? 2.8 : st.width, before: null, after: dashOf(AHEAD_DASH[type]), split: a.progress }, wpp);
          arc.mesh.renderOrder = sel ? 2 : 1;
        }
      }
      for (const [id, o] of acs) if (!seen.has(id)) { o.mesh.removeFromParent(); o.label.remove(); acs.delete(id); }
      for (const [id, arc] of ownArcs) if (!seenArcs.has(id)) { dropArc(arc); ownArcs.delete(id); }

      // Airline legs carrying our crew or a traveller: grey, their path dotted.
      const b = Math.floor(t / CM_BUCKET) * CM_BUCKET;
      const ck = `${store.version}:${b}`;
      if (ck !== cmKey) {
        cmKey = ck;
        cmList = groupCommercial(commercialFlightsBetween(game, b, b + CM_BUCKET));
      }
      const up = new Set<string>();
      cmScreen.clear();
      for (const cf of cmList) {
        if (cf.leg.dep > t || cf.leg.arr <= t) continue;
        const A = AIRPORT_BY_CODE[cf.leg.from];
        const B = AIRPORT_BY_CODE[cf.leg.to];
        if (!A || !B) continue;
        up.add(cf.id);
        let x = cms.get(cf.id);
        if (!x) {
          const typeId = cf.leg.jet ? 'a320ceo' : airlineType(cf.leg.iata, cf.leg.from, cf.leg.to);
          const mesh = new Mesh(quad, cmMat(typeId));
          mesh.matrixAutoUpdate = false;
          mesh.frustumCulled = false;
          acGroup.add(mesh);
          const track = gcTrack(cf.leg.from, cf.leg.to);
          x = { mesh, typeId, cf, pts: track, dim: cf.leg.jet ? 22 : dimM(typeId) * 0.85, arc: newArc(track, cf.id, arcGroup) };
          cms.set(cf.id, x);
        }
        const pr = commercialProgress(cf, t);
        const pts = x.pts;
        const i = Math.min(pts.length - 2, Math.floor(pr * (pts.length - 1)));
        const pos = interp(pts, pr);
        const n = new Vector3(...vecOf(...pos)).normalize();
        placeQuad(x.mesh, n, headingVec(pos, pts[i + 1]), R_AC - 0.0002, x.dim * pxPerM * QUAD_PER_DIM * wpp);
        const vis = facing(vecOf(...pos), cam, 0);
        x.mesh.visible = vis;
        const q = facing(vecOf(...pos), cam, LABEL_COS) ? project(vecOf(pos[0], pos[1], R_AC), cam, w, h) : null;
        if (q) cmScreen.set(cf.id, { ...q, r: (x.dim * pxPerM) / 2 });
        const st = TYPE_STROKE.deadhead;
        const c = colourOf(st.color);
        const sel = selCm === cf.id;
        styleArc(x.arc.mat, { color: [c[0], c[1], c[2]], opacity: sel ? 1 : 0.8, width: sel ? 1.8 : st.width, before: null, after: dashOf(st.dash), split: -1 }, wpp);
      }
      for (const [id, x] of cms) if (!up.has(id)) { x.mesh.removeFromParent(); dropArc(x.arc); cms.delete(id); }

      // Labels: the tail marks (thinned, the selected one first) and the airport codes.
      const fs = touch ? 12 : 10.5;
      const apBoxes: (LabelBox & { el: HTMLSpanElement; x0: number; y0: number })[] = [];
      for (const a of p.airports) {
        const ap = AIRPORT_BY_CODE[a.code];
        if (!ap) continue;
        const v = vecOf(ap.lon, ap.lat, R_AP);
        const want = a.label || a.state === 'hub' || (p.sel?.kind === 'airport' && p.sel.id === a.code);
        let el = apLabels.get(a.code);
        if (!want || !facing(v, cam, LABEL_COS)) {
          if (el) el.style.display = 'none';
          continue;
        }
        const q = project(v, cam, w, h);
        if (!q) continue;
        if (!el) {
          el = document.createElement('span');
          el.className = 'gl-ap';
          el.textContent = a.code;
          labelsEl.appendChild(el);
          apLabels.set(a.code, el);
        }
        el.classList.toggle('hub', a.state === 'hub');
        apBoxes.push({ id: `ap:${a.code}`, x: q.x, y: q.y - 12, w: a.code.length * fs * 0.62 + 2, h: fs, el, x0: q.x, y0: q.y - 12 - fs / 2 });
      }
      const order = [...boxes.filter((x) => x.id === selAc), ...apBoxes.filter((x) => p.sel?.kind === 'airport' && x.id === `ap:${p.sel.id}`), ...boxes.filter((x) => x.id !== selAc && prevLabels.has(x.id)), ...apBoxes, ...boxes.filter((x) => x.id !== selAc && !prevLabels.has(x.id))];
      const dots = [...acScreen.entries()].map(([id, s]) => ({ id: `d:${id}`, x: s.x, y: s.y, w: s.r * 1.6, h: s.r * 1.6 }));
      const shown = placeLabels([...dots, ...order.filter((x, i, arr) => arr.indexOf(x) === i)], 1);
      prevLabels = shown;
      for (const bx of [...boxes, ...apBoxes]) {
        const on = shown.has(bx.id);
        bx.el.style.display = on ? '' : 'none';
        if (on) bx.el.style.transform = `translate(${bx.x0.toFixed(1)}px, ${bx.y0.toFixed(1)}px) translateX(-50%)`;
      }
      // The selected aircraft's (or airline leg's) ring.
      const ss = selAc ? acScreen.get(selAc) : selCm ? cmScreen.get(selCm) : undefined;
      if (ss) {
        const r = Math.max(15, ss.r + 5);
        selRing.style.display = '';
        selRing.style.width = selRing.style.height = `${(r * 2).toFixed(0)}px`;
        selRing.style.transform = `translate(${(ss.x - r).toFixed(1)}px, ${(ss.y - r).toFixed(1)}px)`;
      } else selRing.style.display = 'none';

      renderer.render(scene, camera);
    };

    const typeOfFlight = (game: GameState, f: Flight): FlightType => {
      let ty = typeOf.get(f.id);
      if (!ty) {
        try { ty = flightType(game, f); } catch { ty = 'operating'; }
        typeOf.set(f.id, ty);
      }
      return ty;
    };
    const cmMat = (typeId: string) => acMat(`cm:${typeId}`, typeId, () => {
      const grey = cssVar('--c-mark-848ea2').trim() || '#848ea2';
      const edge = cssVar('--c-line-d3d9e4').trim() || '#d3d9e4';
      return { fill: grey, edge, eng: grey, deck: grey };
    });
    const m4 = new Matrix4();
    const vx = new Vector3();
    const vy = new Vector3();
    /** A quad lying on the sphere at unit normal n, its top towards `fwd`, `side` world units across, at radius r. */
    const placeQuad = (mesh: Mesh, n: Vector3, fwd: Vec3, r: number, side: number) => {
      vy.set(fwd[0], fwd[1], fwd[2]);
      vy.addScaledVector(n, -vy.dot(n)).normalize();
      vx.crossVectors(vy, n);
      m4.makeBasis(vx.multiplyScalar(side), vy.multiplyScalar(side), n.clone().multiplyScalar(side));
      m4.setPosition(n.x * r, n.y * r, n.z * r);
      mesh.matrix.copy(m4);
      mesh.matrixWorldNeedsUpdate = true;
    };
    const interp = (pts: [number, number][], f: number): [number, number] => {
      const x = Math.max(0, Math.min(1, f)) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(x));
      const A = vecOf(...pts[i]);
      const B = vecOf(...pts[i + 1]);
      const k = x - i;
      const P = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k] as Vec3;
      const [lon, lat] = [Math.atan2(-P[2], P[0]) * (180 / Math.PI), Math.asin(Math.max(-1, Math.min(1, P[1] / Math.hypot(...P)))) * (180 / Math.PI)];
      return [lon, lat];
    };

    // ---------- gestures ----------
    const pts = new Map<number, { x: number; y: number }>();
    let gesture: null | { kind: 'drag' | 'pinch'; x: number; y: number; d0: number; dist0: number; moved: number; t0: number; hist: { t: number; lon: number; lat: number }[] } = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    const local = (e: PointerEvent | WheelEvent) => {
      const r = stage.getBoundingClientRect();
      // Settings › Size zooms the page: rects are screen px, pointer positions the page's.
      const k = r.width / Math.max(1, stage.offsetWidth || r.width);
      return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    };
    const mid = () => {
      const l = [...pts.values()];
      return { x: (l[0].x + l[1].x) / 2, y: (l[0].y + l[1].y) / 2, d: Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y) };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button > 0) return;
      stage.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, local(e));
      vel = [0, 0];
      fly = null;
      lastInteract = performance.now();
      if (pts.size === 1) {
        const p = local(e);
        gesture = { kind: 'drag', x: p.x, y: p.y, d0: 0, dist0: orbit.dist, moved: 0, t0: performance.now(), hist: [{ t: performance.now(), lon: orbit.lon, lat: orbit.lat }] };
      } else if (pts.size === 2) {
        const m = mid();
        gesture = { kind: 'pinch', x: m.x, y: m.y, d0: m.d, dist0: orbit.dist, moved: 99, t0: performance.now(), hist: [] };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || !gesture) return;
      pts.set(e.pointerId, local(e));
      lastInteract = performance.now();
      const dpp = degPerPx(orbit.dist, h);
      if (gesture.kind === 'drag' && pts.size === 1) {
        const p = local(e);
        const dx = p.x - gesture.x;
        const dy = p.y - gesture.y;
        gesture.moved += Math.hypot(dx, dy);
        gesture.x = p.x;
        gesture.y = p.y;
        orbit = { ...orbit, lon: wrap180(orbit.lon - (dx * dpp) / Math.max(0.25, Math.cos((orbit.lat * Math.PI) / 180))), lat: clampLat(orbit.lat + dy * dpp) };
        const now = performance.now();
        gesture.hist.push({ t: now, lon: orbit.lon, lat: orbit.lat });
        while (gesture.hist.length > 2 && now - gesture.hist[0].t > 90) gesture.hist.shift();
      } else if (gesture.kind === 'pinch' && pts.size === 2) {
        const m = mid();
        orbit = { ...orbit, dist: clampDist(1 + (gesture.dist0 - 1) * (gesture.d0 / Math.max(10, m.d))) };
        const dx = m.x - gesture.x;
        const dy = m.y - gesture.y;
        gesture.x = m.x;
        gesture.y = m.y;
        orbit = { ...orbit, lon: wrap180(orbit.lon - (dx * dpp) / Math.max(0.25, Math.cos((orbit.lat * Math.PI) / 180))), lat: clampLat(orbit.lat + dy * dpp) };
      }
      dirty = true;
      kick();
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.delete(e.pointerId);
      lastInteract = performance.now();
      if (!gesture) return;
      if (gesture.kind === 'drag' && pts.size === 0) {
        const now = performance.now();
        if (gesture.moved < 9 && now - gesture.t0 < 450 && e.type === 'pointerup') tap(p.x, p.y, e.pointerType !== 'mouse');
        else {
          const hst = gesture.hist.filter((x) => now - x.t < 90);
          if (hst.length >= 2 && !reduced) {
            const a = hst[0];
            const z = hst[hst.length - 1];
            const span = Math.max(16, now - a.t);
            vel = [wrap180(z.lon - a.lon) / span, (z.lat - a.lat) / span];
          }
        }
        gesture = null;
      } else if (pts.size === 1) {
        // Pinch over, one finger still down: carry on as a drag from here.
        const q = [...pts.values()][0];
        gesture = { kind: 'drag', x: q.x, y: q.y, d0: 0, dist0: orbit.dist, moved: 99, t0: performance.now(), hist: [] };
      } else if (pts.size === 0) gesture = null;
      dirty = true;
      kick();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteract = performance.now();
      fly = null;
      orbit = { ...orbit, dist: clampDist(1 + (orbit.dist - 1) * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))) };
      dirty = true;
      kick();
    };
    const tap = (x: number, y: number, finger: boolean) => {
      const r = finger ? HIT_R.touch : HIT_R.mouse;
      const game = store.game;
      if (!game) return;
      const cam = camOf(orbit);
      const items: { x: number; y: number; item: Ref }[] = [];
      for (const [id, s] of acScreen) items.push({ x: s.x, y: s.y, item: { kind: 'aircraft', id } });
      for (const [id, s] of cmScreen) items.push({ x: s.x, y: s.y, item: { kind: 'flight', id } });
      // Airports are a smaller target than aircraft (they sit under them at a stand).
      for (const a of propsRef.current.airports) {
        const ap = AIRPORT_BY_CODE[a.code];
        if (!ap) continue;
        const v = vecOf(ap.lon, ap.lat, R_AP);
        if (!facing(v, cam, LABEL_COS)) continue;
        const q = project(v, cam, w, h);
        if (q) items.push({ x: q.x, y: q.y, item: { kind: 'airport', id: a.code } });
      }
      const hit = pickNearest(items, x, y, r);
      const now = performance.now();
      if (hit) {
        store.select(hit);
        lastTap = { t: 0, x, y };
        return;
      }
      if (now - lastTap.t < 340 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
        lastTap = { t: 0, x, y };
        goHome();
        return;
      }
      lastTap = { t: now, x, y };
      if (store.nav.sel) store.select(undefined);
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    const onVis = () => { if (document.visibilityState === 'visible') { lastFrame = 0; dirty = true; kick(); } };
    document.addEventListener('visibilitychange', onVis);
    const unsub = store.subscribe(() => { dirty = true; kick(); });
    const unsubClock = store.subscribeClock(kick);
    const onLost = (e: Event) => { e.preventDefault(); running = false; cancelAnimationFrame(raf); };
    const onRestored = () => { dirty = true; inked = ''; kick(); };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);

    api.current = {
      kick: () => { dirty = true; kick(); },
      zoom: (f: number) => {
        lastInteract = performance.now();
        const to = { ...orbit, dist: clampDist(1 + (orbit.dist - 1) * f) };
        // Zooming in with something selected in view closes in on it (kept clear of the panel), not on the middle.
        const at = selPos(propsRef.current.sel);
        if (at && f < 1 && facing(vecOf(...at), camOf(orbit), LABEL_COS)) {
          const k = 1 - (to.dist - 1) / (orbit.dist - 1);
          const aim = aimAt(at, to.dist, h, propsRef.current.panelOpen ? PANEL_W / 2 : 0);
          to.lon = wrap180(orbit.lon + wrap180(aim.lon - orbit.lon) * k);
          to.lat = clampLat(orbit.lat + (aim.lat - orbit.lat) * k);
        }
        flyTo(to, 350);
      },
      home: () => { lastInteract = performance.now(); goHome(); },
      propsChanged: () => {
        const p = propsRef.current;
        const k = p.sel ? `${p.sel.kind}:${p.sel.id}` : '';
        if (k !== selKey) {
          selKey = k;
          // Bring a new selection into view (clear of the panel) when it is behind or near the edge of the globe.
          const at = selPos(p.sel);
          if (at) {
            const centre: [number, number] = [orbit.lon, orbit.lat];
            const horizon = (Math.acos(1 / orbit.dist) * 180) / Math.PI;
            if (angleBetween(centre, at) > horizon * 0.55) flyTo({ ...aimAt(at, orbit.dist, h, p.panelOpen ? PANEL_W / 2 : 0), dist: orbit.dist });
          }
        }
        dirty = true;
        kick();
      },
    };
    const selPos = (s: Ref | undefined): [number, number] | null => {
      if (!s) return null;
      if (s.kind === 'aircraft') {
        const a = fleetNow.find((x) => x.id === s.id) ?? (store.game ? globeFleet(store.game, liveMinute()).find((x) => x.id === s.id) : undefined);
        return a ? a.pos : null;
      }
      if (s.kind === 'airport') {
        const ap = AIRPORT_BY_CODE[s.id];
        return ap ? [ap.lon, ap.lat] : null;
      }
      if (s.kind === 'flight') {
        const c = cms.get(s.id);
        if (c) {
          const A = AIRPORT_BY_CODE[c.cf.leg.to];
          return A ? [A.lon, A.lat] : null;
        }
      }
      return null;
    };
    stats.aim = (lon, lat, dist) => flyTo({ lon: wrap180(lon), lat: clampLat(lat), dist: clampDist(dist ?? orbit.dist) }, 600);
    selKey = propsRef.current.sel ? `${propsRef.current.sel.kind}:${propsRef.current.sel.id}` : '';
    resize();
    void loadEarth();

    return () => {
      disposed = true;
      unCapture();
      api.current = null;
      stats.aim = null;
      cancelAnimationFrame(raf);
      window.clearTimeout(spinTimer);
      ro.disconnect();
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('wheel', onWheel);
      document.removeEventListener('visibilitychange', onVis);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      unsub();
      unsubClock();
      // Every GPU resource goes with the globe.
      for (const s of statics) dropArc(s.obj);
      for (const a of ownArcs.values()) dropArc(a);
      for (const c of cms.values()) dropArc(c.arc);
      for (const o of acs.values()) o.label.remove();
      for (const el of apLabels.values()) el.remove();
      for (const m of matCache.values()) m.dispose();
      for (const t of texCache.values()) t.dispose();
      quad.dispose();
      earth.geometry.dispose();
      earth.material.dispose();
      atmo.geometry.dispose();
      atmo.material.dispose();
      if (borders) { borders.geometry.dispose(); borders.material.dispose(); }
      aps.geometry.dispose();
      aps.material.dispose();
      landTex?.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  // Props reach the loop by ref; a change wakes it (and a new selection may turn the globe to it).
  useEffect(() => { api.current?.propsChanged(); }, [props.sel?.kind, props.sel?.id, props.airports, props.nextArcs, props.tours, props.theme, props.accent, props.panelOpen, props.g]);

  return (
    <div className="globe-view">
      <div className="globe-stage" ref={stageRef} />
      <div className="globe-labels" ref={labelsRef} aria-hidden>
        <div className="gl-sel" ref={selRingRef} style={{ display: 'none' }} />
      </div>
      <div className="map-zoom globe-zoom">
        <button className="btn btn-icon btn-sm" onClick={props.onFlat} aria-label="Flat map" title="Flat map"><MapIcon /></button>
        <button className="btn btn-icon btn-sm" onClick={() => api.current?.zoom(1 / 1.8)} aria-label="Zoom in"><Plus /></button>
        <button className="btn btn-icon btn-sm" onClick={() => api.current?.zoom(1.8)} aria-label="Zoom out"><Minus /></button>
        <button className="btn btn-icon btn-sm" onClick={() => api.current?.home()} aria-label="Home base" title="Home base"><House /></button>
      </div>
    </div>
  );
}
