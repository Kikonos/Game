// v0.15 the 3D globe on the Ops Map (lazy: three.js and this file load only when the player opens the globe). The Earth
// from the same world atlas as the flat map, the real sun's day and night, our aircraft as their to-scale silhouettes on
// their great circles (the flat map's positions: aircraftLive, the dry-lease show legs, the airline legs our crew and
// travellers ride), airport dots, the selected aircraft's track and next legs, world tours. Drag to spin (with inertia),
// pinch or wheel to zoom, tap to select (the same panels as the flat map), double tap or the house button for home.
// Renders only when something moved: the camera, the game clock or the data; never while the page is hidden.

import { House, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AmbientLight, type BufferGeometry, CanvasTexture, type DataTexture, DirectionalLight, Group, Matrix4, Mesh, type MeshLambertMaterial, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, type ShaderMaterial } from 'three';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import type { Flight, GameState, Ref } from '../../../engine/core/types';
import { commercialFlightsBetween, commercialProgress, type CommercialFlight, type FlightType, flightType } from '../../../engine/ops';
import { registerCaptureCanvas } from '../../bugShot';
import { liveMinute, store } from '../../store';
import type { Theme } from '../../theme';
import { isTouch } from '../../useMedia';
import { airlineType } from '../airlineTypes';
import { HIT_R } from '../LiveLayers';
import { groupCommercial, type LegArc, pickNearest, placeLabels, regMark, type SlipArc, standOffsets, TYPE_STROKE, type LabelBox } from '../mapLogic';
import { contrailWindow } from '../spotter';
import { loadMapData, worldGeo } from '../mapData';
import { silColour } from '../silhouettes';
import type { MapAirport, MapRoute } from '../WorldMap';
import {
  airportPoints, arcGeometry, arcMaterial, type ArcStyle, type ArcView, atmosphereMesh, dimM, disposeModels, earthMesh, type GlobeInk, inkAtmosphere, inkEarth, landTexture, modelGeometry,
  modelMaterial, QUAD_PER_DIM, ribbonMesh, type RGBA, setAirports, setEarthLand, shadowMaterial, shadowTexture, styleArc, styleRibbon, trailTexture,
} from './globeGL';
import { GlobeMarks, type GlobeMarkProps } from './GlobeMarks';
import { modelOf } from './globeModel';
import { borderLines, drawLandField, fieldWidth, landFieldHere, ribbons } from './globeLand';
import {
  aimAt, angleBetween, arcLift, camView, type CamView, globeTilt, projectView, clampDist, clampLat, cross, dashOf, degPerPx, DIST_START, FOV, facing, gcTrack, globeFleet, globePxPerM, headingVec, IDLE_AFTER_MS, IDLE_SPIN_DEG_S, legTrack,
  lerpOrbit, liftAt, norm, occluded, type Orbit, parseColour, stepInertia, sub, sunVec, tangentsAt, vecOf, worldPerPx, wrap180, type GlobeAc, type Vec3,
} from './globeLogic';
import './globe.css';

export interface GlobeProps {
  g: GameState;
  airports: MapAirport[];
  /** The selected aircraft's next legs (not the one it is flying). */
  nextArcs: LegArc[];
  /** World tours under way. */
  tours: MapRoute[];
  /** v0.18 the flat map's marks (offer pins, weather, events, crew changes, diversions, zones), placed on the globe. */
  marks: Omit<GlobeMarkProps, 'selected' | 'touch'>;
  /** v0.18 the selected aircraft's slip crews' airline legs (as on the flat map). */
  slipLegs: SlipArc[];
  /** v0.18 spotter mode: the camera follows this aircraft (a new key flies to it first). */
  follow?: { key: string; id: string } | null;
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
/** v0.18 aircraft shadows, on the ground under the arcs. */
const R_SHADOW = 1.0013;
/** v0.18 shadow darkness on the ground and at the top of the highest arc. */
const SHADOW_A: [number, number] = [0.5, 0.2];
const SHADOW_STEPS = 5;
/** v0.18 how far a shadow falls (down and right on screen) at the top of an arc: at most this many css px. */
const SHADOW_PX = 12;
/** v0.18 the dashes ahead drift this many screen px a second while the clock runs (map animations on). */
const FLOW_PX_S = 7;
/** v0.18 spotter: the camera's distance while it follows (closer than this stays), and the pause after a drag. */
const FOLLOW_DIST = 1.9;
const FOLLOW_WAIT_MS = 4000;
/** Labels, rings and taps only where the ground faces the camera well (not foreshortened at the limb). */
const LABEL_COS = 0.28;
/** Airline legs are fetched for this many game minutes at a time, as on the flat map. */
const CM_BUCKET = 10;
/** Dash of the part still to fly (screen px), as on the flat map. */
const AHEAD_DASH: Record<FlightType, string> = { operating: '6 5', positioning: TYPE_STROKE.positioning.dash, ferry: TYPE_STROKE.ferry.dash, deadhead: TYPE_STROKE.deadhead.dash };

/** The camera per game, so closing and reopening the globe (or a tab switch) comes back to the same view. */
const orbits = new WeakMap<GameState, Orbit>();

/** Frame cost stats for perf checks (console: __bhGlobe); `aim` turns the open globe to a place (checks, screenshots). */
const stats = { frames: 0, avgMs: 0, maxMs: 0, landMs: 0, reset() { this.frames = 0; this.avgMs = 0; this.maxMs = 0; }, aim: null as null | ((lon: number, lat: number, dist?: number) => void), orbit: null as null | (() => Orbit), fleet: null as null | (() => { id: string; pos: [number, number]; airborne: boolean; progress: number }[]) };
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

/** v0.18 an aircraft on the globe: its 3D model (and contrail) in one group, its shadow on the ground. */
interface AcObj { group: Group; model: Mesh<BufferGeometry, MeshLambertMaterial>; trail: Mesh; shadow: Mesh<PlaneGeometry, MeshBasicMaterial>; typeId: string; label: HTMLSpanElement; dim: number }
interface ArcObj { mesh: Mesh; key: string; mat: ShaderMaterial; pts: [number, number][]; lift: number }
interface CmObj { ac: AcObj; arc: ArcObj; cf: CommercialFlight; typeId: string; pts: [number, number][]; scale: number }
/** v0.18 a mark placed by the loop: its element, where it stands, how far it must face the camera to show. */
interface MarkEl { el: SVGGElement; key: string; at: Vec3; face: number; off: [number, number] }

export default function Globe(props: GlobeProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const selRingRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** The loop's hooks for the buttons and the props effects. */
  const api = useRef<{ marks: (list: MarkEl[]) => void; kick: () => void; zoom: (f: number) => void; home: () => void; propsChanged: () => void } | null>(null);
  const marksRef = useRef<SVGSVGElement>(null);
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
    const shadeGroup = new Group();
    const arcGroup = new Group();
    const staticArcs = new Group();
    scene.add(staticArcs, shadeGroup, arcGroup, acGroup);
    const aps = airportPoints();
    scene.add(aps);
    // v0.18 the models are lit from just above and left of the camera (they read on the night side too), with a soft fill.
    const fill = new AmbientLight(0xffffff, 1.35);
    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(-0.9, 1.4, 0.6);
    camera.add(keyLight);
    scene.add(camera, fill);
    const texCache = new Map<string, CanvasTexture>();
    const matCache = new Map<string, MeshLambertMaterial | MeshBasicMaterial>();
    const modelMat = (colour: string) => {
      const k = `m:${colour}`;
      let m = matCache.get(k) as MeshLambertMaterial | undefined;
      if (!m) matCache.set(k, (m = modelMaterial(colour)));
      return m;
    };
    const shadeMat = (typeId: string, step: number) => {
      const k = `s:${typeId}:${step}`;
      let m = matCache.get(k) as MeshBasicMaterial | undefined;
      if (!m) {
        let tex = texCache.get(`s:${typeId}`);
        if (!tex) texCache.set(`s:${typeId}`, (tex = shadowTexture(typeId, maxAniso)));
        const f = step / (SHADOW_STEPS - 1);
        matCache.set(k, (m = shadowMaterial(tex, SHADOW_A[0] + (SHADOW_A[1] - SHADOW_A[0]) * f)));
      }
      return m;
    };
    const trailTex = trailTexture();
    const trailMat = new MeshBasicMaterial({ map: trailTex, transparent: true, depthWrite: false, opacity: 0.55 });
    /** A new aircraft (ours or an airline's): model, contrail and shadow, in the scene. */
    const newAc = (typeId: string, colour: string, label: HTMLSpanElement | null): AcObj => {
      const md = modelOf(typeId);
      const group = new Group();
      group.matrixAutoUpdate = false;
      const model = new Mesh(modelGeometry(typeId), modelMat(colour));
      model.frustumCulled = false;
      const trail = new Mesh(quad, trailMat);
      // Behind the engines, in the wing's plane (metres, the model's frame).
      trail.scale.set(Math.max(6, md.engX * 2.4), md.L * 1.35, 1);
      trail.position.set(0, -md.L / 2 - md.L * 0.62, -0.4);
      trail.renderOrder = 3;
      trail.frustumCulled = false;
      trail.visible = false;
      group.add(model, trail);
      acGroup.add(group);
      const shadow = new Mesh(quad, shadeMat(typeId, 0));
      shadow.matrixAutoUpdate = false;
      shadow.frustumCulled = false;
      shadeGroup.add(shadow);
      return { group, model, trail, shadow, typeId, label: label ?? document.createElement('span'), dim: dimM(typeId) };
    };
    const dropAc = (o: AcObj) => { o.group.removeFromParent(); o.shadow.removeFromParent(); o.label.remove(); };
    const acs = new Map<string, AcObj>();
    const ownArcs = new Map<string, ArcObj>();
    const cms = new Map<string, CmObj>();
    let statics: { obj: ArcObj; st: ArcStyle }[] = [];
    let marks: MarkEl[] = [];
    const markScreen = new Map<string, { x: number; y: number }>();

    const dropArc = (a: ArcObj) => {
      a.mesh.removeFromParent();
      a.mesh.geometry.dispose();
      a.mat.dispose();
    };
    /** An arc along samples [lon, lat]; v0.18 `lifted`: it rises with the sector's length (flights), else it lies on the ground. */
    const newArc = (pts: [number, number][], key: string, parent: Group, lifted = true): ArcObj => {
      const mat = arcMaterial();
      const lift = lifted && pts.length > 1 ? arcLift(angleBetween(pts[0], pts[pts.length - 1])) : 0;
      const mesh = new Mesh(arcGeometry(pts, R_ARC, lift), mat);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return { mesh, key, mat, pts, lift };
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
    let fleetAt: { t: number; v: number; g: GameState | null } = { t: NaN, v: -1, g: null };
    /** v0.19 (perf) theme colour tokens as read (cleared with the theme), and the airline grey. */
    const tones = new Map<string, RGBA>();
    const toneOf = (s: string) => {
      let c = tones.get(s);
      if (!c) tones.set(s, (c = colourOf(s)));
      return c;
    };
    let greyInk = cssVar('--c-mark-848ea2').trim() || '#848ea2';
    const acScreen = new Map<string, { x: number; y: number; r: number }>();
    const cmScreen = new Map<string, { x: number; y: number; r: number }>();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let spinTimer = 0;
    /** v0.19 (perf) a drag holds back the screens' hourly refresh (store.mapGesture) until it and its inertia end. */
    let held = false;
    /** The optional idle spin: a few seconds untouched, nothing selected, no dialog, no reduced motion. */
    const spinning = (now: number) => store.settings.globeSpin && !reduced && !gesture && !propsRef.current.sel && !propsRef.current.follow && !store.modal && now - lastInteract > IDLE_AFTER_MS;
    /** v0.18 the dashes' drift (screen px), moved on with the game clock; the spotter's aircraft and its fly-in. */
    let flow = 0;
    let flowT = NaN;
    let followed = '';
    /** v0.18 the camera as last drawn (taps and labels use the same one) and its tilt (deg). */
    let tiltNow = 0;
    let cv: CamView = camView(orbit, 0);

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
      } else if (followStep(now, dt)) {
        moving = true;
      } else if (spinning(now)) {
        orbit = { ...orbit, lon: wrap180(orbit.lon + (IDLE_SPIN_DEG_S * dt) / 1000) };
        moving = true;
        idleSpin = true;
      }
      if (moving) dirty = true;
      if (held && !gesture && !fly && !vel[0] && !vel[1]) { held = false; store.mapGesture(false); }
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
      // v0.18 close up the camera leans back (Map tilt setting; not with reduced motion): the ground runs to a horizon.
      tiltNow = store.settings.mapTilt && !reduced ? globeTilt(orbit.dist) : 0;
      cv = camView(orbit, tiltNow);
      const cam = cv.pos;
      camera.position.set(cam[0], cam[1], cam[2]);
      camera.up.set(cv.up[0], cv.up[1], cv.up[2]);
      camera.lookAt(cv.target[0], cv.target[1], cv.target[2]);
      const wpp = worldPerPx(orbit.dist, h);
      const pxPerM = globePxPerM(orbit.dist, w, h);
      // Theme.
      if (inked !== p.theme) {
        inked = p.theme;
        ink = readInk(p.theme);
        inkEarth(earth.material, ink);
        inkAtmosphere(atmo.material, ink, p.theme !== 'light');
        aps.material.uniforms.uRing.value.set(...ink.halo);
        // Airline greys and route colours are theme tokens too. v0.19 (perf) read once per theme (was per frame and
        // per aircraft: each read forced a style pass after the frame's label writes).
        tones.clear();
        greyInk = cssVar('--c-mark-848ea2').trim() || '#848ea2';
        for (const c of cms.values()) c.ac.model.material = modelMat(greyInk);
        apKey = [];
        staticKey = [];
      }
      earth.material.uniforms.uSun.value.set(...sunVec(t));
      const dprNow = renderer.getPixelRatio();
      aps.material.uniforms.uDpr.value = dprNow;
      earth.material.uniforms.uCoastW.value = (COAST_W * dprNow) / 2;
      if (borders) styleRibbon(borders.material, ink.border, BORDER_W, w * dprNow, h * dprNow, dprNow, landTex);
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
      const pr = renderer.getPixelRatio();
      const av: ArcView = { wpp, bufW: w * pr, bufH: h * pr, pr };
      // v0.18 the dashes ahead drift towards the destination while the clock runs (Map animations on, no reduced motion).
      if (store.settings.mapAnimations && !reduced) {
        if (!Number.isNaN(flowT) && t !== flowT && !store.modal) flow += (FLOW_PX_S * Math.min(120, Math.abs(t - flowT))) / 2;
      }
      flowT = t;
      // Static arcs: the selected aircraft's next legs, the world tours, v0.18 the slip crews' airline legs, the
      // diversions (alternate to the planned airport, on the ground) and the world-event zones' edges (on the ground).
      if (staticKey[0] !== p.nextArcs || staticKey[1] !== p.tours || staticKey[2] !== p.slipLegs || staticKey[3] !== p.marks.divs || staticKey[4] !== p.marks.zones || staticKey[5] !== p.sel?.id) {
        staticKey = [p.nextArcs, p.tours, p.slipLegs, p.marks.divs, p.marks.zones, p.sel?.id];
        for (const s of statics) dropArc(s.obj);
        statics = [];
        const add = (pts: [number, number][], id: string, st: ArcStyle, lifted = true) => { if (pts.length > 1) statics.push({ obj: newArc(pts, id, staticArcs, lifted), st }); };
        const rgb = (c: RGBA): [number, number, number] => [c[0], c[1], c[2]];
        p.tours.forEach((r) => add(gcTrack(r.from, r.to), r.id, { color: rgb(colourOf(r.color ?? 'var(--map-route)')), opacity: 0.75, width: 1.6, before: null, after: r.dashed ? [5, 5] : null, split: -1 }));
        p.nextArcs.forEach((l, i) => add(gcTrack(l.from, l.to), l.id, { color: rgb(colourOf(l.color ?? 'var(--map-route)')), opacity: Math.max(0.3, 0.6 - i * 0.08), width: 1.5, before: null, after: l.dashed ? [5, 5] : null, split: -1 }));
        const dh = TYPE_STROKE.deadhead;
        p.slipLegs.forEach((l) => add(gcTrack(l.from, l.to), l.id, { color: rgb(colourOf(dh.color)), opacity: l.dir === 'out' ? 0.5 : 0.95, width: 1.8, before: null, after: dashOf(dh.dash), split: -1 }));
        const warn = rgb(colourOf('var(--warn)', [0.96, 0.7, 0.25, 1]));
        p.marks.divs.forEach((m) => add(gcTrack(m.at, m.to0), `dv:${m.id}`, { color: warn, opacity: 0.9, width: 1.2, before: null, after: [2, 4], split: -1 }, false));
        for (const z of p.marks.zones) {
          if (z.ring.length < 3) continue;
          const ring = [...z.ring, z.ring[0]];
          const pts: [number, number][] = [];
          // Each edge as a great circle, a sample every degree or so.
          for (let i = 0; i < ring.length - 1; i++) {
            const n = Math.max(1, Math.ceil(angleBetween(ring[i], ring[i + 1]) / 1.2));
            const A = vecOf(...ring[i]);
            const B = vecOf(...ring[i + 1]);
            for (let k = 0; k < n; k++) {
              const f = k / n;
              pts.push(lonLat(norm([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f])));
            }
          }
          pts.push(ring[ring.length - 1]);
          const sel = p.sel?.kind === 'event' && p.sel.id === z.eventId;
          const tone: RGBA = z.style === 'closed' ? [0.91, 0.46, 0.42, 0.75] : z.style === 'warRisk' ? [0.96, 0.7, 0.27, 0.85] : [0.75, 0.78, 0.83, 0.6];
          add(pts, `zone:${z.eventId}`, { color: sel ? rgb(ink.ring) : rgb(tone), opacity: sel ? 0.85 : tone[3], width: sel ? 1.8 : 1.2, before: null, after: z.style === 'warRisk' ? [6, 4] : null, split: -1 }, false);
        }
      }
      for (const s of statics) styleArc(s.obj.mat, s.st, av);

      // Our aircraft.
      if (typeVersion !== store.version) {
        typeVersion = store.version;
        typeOf.clear();
      }
      const selAc = p.sel?.kind === 'aircraft' ? p.sel.id : undefined;
      const selCm = p.sel?.kind === 'flight' ? p.sel.id : undefined;
      // v0.19 (perf) the fleet worked out again only when time or the game moved (not for every frame of a drag).
      if (t !== fleetAt.t || store.version !== fleetAt.v || game !== fleetAt.g) {
        fleetNow = globeFleet(game, t);
        fleetAt = { t, v: store.version, g: game };
      }
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
      // The camera's screen axes in the world (shadows fall down and right on screen).
      const crt = cv.right;
      const cup = cv.up;
      const anim = store.settings.mapAnimations && !reduced;
      acScreen.clear();
      const boxes: (LabelBox & { el: HTMLSpanElement; x0: number; y0: number })[] = [];
      for (const a of fleetNow) {
        const ac = game.fleet[a.id];
        if (!ac) continue;
        seen.add(a.id);
        let o = acs.get(a.id);
        if (!o || o.typeId !== a.typeId) {
          if (o) dropAc(o);
          const label = document.createElement('span');
          label.className = 'gl-reg';
          labelsEl.appendChild(label);
          o = newAc(a.typeId, silColour(a.typeId), label);
          acs.set(a.id, o);
        }
        const mark = regMark(ac.reg, game.company.regPrefix);
        if (o.label.textContent !== mark) o.label.textContent = mark;
        // Its track: flown solid, still to fly dashed; v0.18 lifted off the ground, the aircraft riding it.
        let arc: ArcObj | undefined;
        if (a.airborne) {
          const f = a.flight;
          const key = f ? `${f.id}|${f.atd ?? f.std + f.delay}|${f.ata ?? f.eta ?? ''}|${f.to}|${f.div?.at ?? ''}` : `show:${a.id}|${a.show!.dep}`;
          seenArcs.add(a.id);
          arc = ownArcs.get(a.id);
          if (!arc || arc.key !== key) {
            if (arc) dropArc(arc);
            const pts = f ? legTrack(f) : gcTrack(a.show!.from, a.show!.to);
            arc = newArc(pts.length > 1 ? pts : [a.pos, a.pos], key, arcGroup);
            ownArcs.set(a.id, arc);
          }
          const type = f ? typeOfFlight(game, f) : 'operating';
          const st = TYPE_STROKE[type];
          const c = toneOf(st.color);
          const sel = selAc === a.id;
          styleArc(arc.mat, { color: [c[0], c[1], c[2]], opacity: sel ? 1 : type === 'operating' ? 0.7 : 0.8, width: sel ? 2.8 : st.width, before: null, after: dashOf(AHEAD_DASH[type]), split: a.progress, tail: 0.35, flow: anim ? flow : 0 }, av);
          arc.mesh.renderOrder = sel ? 2 : 1;
        }
        const q = placeAc(o, a.pos, a.airborne ? a.progress : -1, arc, a.airborne ? undefined : stand.get(a.id) ?? [20, 0], 1, cam, wpp, pxPerM, crt, cup);
        // Contrails only while high enough (as on the flat map).
        let tr = false;
        if (anim && a.airborne && a.flight) {
          const win = trailWin(a.flight, a.typeId);
          tr = !!win && t >= win[0] && t < win[1];
        }
        o.trail.visible = tr;
        const rPx = (o.dim * pxPerM) / 2;
        if (q) {
          acScreen.set(a.id, { x: q.x, y: q.y, r: rPx });
          const fs = touch ? 11 : 10;
          boxes.push({ id: a.id, x: q.x, y: q.y + rPx + 8, w: mark.length * fs * 0.62 + 4, h: fs + 2, el: o.label, x0: q.x, y0: q.y + rPx + 3 });
        } else if (o.label.style.display !== 'none') o.label.style.display = 'none';
      }
      for (const [id, o] of acs) if (!seen.has(id)) { dropAc(o); acs.delete(id); }
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
      const grey = greyInk;
      for (const cf of cmList) {
        if (cf.leg.dep > t || cf.leg.arr <= t) continue;
        const A = AIRPORT_BY_CODE[cf.leg.from];
        const B = AIRPORT_BY_CODE[cf.leg.to];
        if (!A || !B) continue;
        up.add(cf.id);
        let x = cms.get(cf.id);
        if (!x) {
          const typeId = cf.leg.jet ? 'a320ceo' : airlineType(cf.leg.iata, cf.leg.from, cf.leg.to);
          const track = gcTrack(cf.leg.from, cf.leg.to);
          // A private jet is drawn as a small airliner (22 m across); an airline's type at 85 % of ours, as on the flat map.
          const scale = cf.leg.jet ? 22 / dimM(typeId) : 0.85;
          x = { ac: newAc(typeId, grey, null), typeId, cf, pts: track, scale, arc: newArc(track, cf.id, arcGroup) };
          cms.set(cf.id, x);
        }
        const pr0 = commercialProgress(cf, t);
        const pos = interp(x.pts, pr0);
        const q = placeAc(x.ac, pos, pr0, x.arc, undefined, x.scale, cam, wpp, pxPerM, crt, cup);
        if (q) cmScreen.set(cf.id, { ...q, r: (x.ac.dim * x.scale * pxPerM) / 2 });
        const st = TYPE_STROKE.deadhead;
        const c = toneOf(st.color);
        const sel = selCm === cf.id;
        styleArc(x.arc.mat, { color: [c[0], c[1], c[2]], opacity: sel ? 1 : 0.8, width: sel ? 1.8 : st.width, before: null, after: dashOf(st.dash), split: -1 }, av);
      }
      for (const [id, x] of cms) if (!up.has(id)) { dropAc(x.ac); dropArc(x.arc); cms.delete(id); }

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
          if (el && el.style.display !== 'none') el.style.display = 'none';
          continue;
        }
        const q = projectView(v, cv, w, h);
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
        // v0.19 (perf) written only when it changes (a same-value write still costs a style pass).
        const d = on ? '' : 'none';
        if (bx.el.style.display !== d) bx.el.style.display = d;
        if (on) {
          const tf = `translate(${bx.x0.toFixed(1)}px, ${bx.y0.toFixed(1)}px) translateX(-50%)`;
          if (bx.el.style.transform !== tf) bx.el.style.transform = tf;
        }
      }
      // v0.18 the marks (pins, weather, events, crew changes, diversions, zone names) where they stand on screen.
      markScreen.clear();
      for (const m of marks) {
        const q = facing(m.at, cam, m.face) ? projectView(m.at, cv, w, h) : null;
        if (!q) {
          if (m.el.style.display !== 'none') m.el.style.display = 'none';
          continue;
        }
        if (m.el.style.display) m.el.style.display = '';
        m.el.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`);
        markScreen.set(m.key, { x: q.x + m.off[0], y: q.y + m.off[1] });
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
    const m4 = new Matrix4();
    const vx = new Vector3();
    const vy = new Vector3();
    // v0.19 (perf) scratch vectors: no allocations per aircraft per frame.
    const vz = new Vector3();
    const vn = new Vector3();
    /** A quad lying on the sphere at unit normal n, its top towards `fwd`, `side` world units across, at radius r. */
    const placeQuad = (mesh: Mesh, n: Vector3, fwd: Vec3, r: number, side: number, shift?: Vec3) => {
      vy.set(fwd[0], fwd[1], fwd[2]);
      vy.addScaledVector(n, -vy.dot(n)).normalize();
      vx.crossVectors(vy, n);
      m4.makeBasis(vx.multiplyScalar(side), vy.multiplyScalar(side), vz.copy(n).multiplyScalar(side));
      m4.setPosition(n.x * r + (shift?.[0] ?? 0), n.y * r + (shift?.[1] ?? 0), n.z * r + (shift?.[2] ?? 0));
      mesh.matrix.copy(m4);
      mesh.matrixWorldNeedsUpdate = true;
    };
    /** The point at share f along an arc, at its height (world). */
    const onArc = (arc: ArcObj, f: number, r: number): Vec3 => {
      const ff = Math.max(0, Math.min(1, f));
      return vecOf(...interp(arc.pts, ff), r + liftAt(arc.lift, ff));
    };
    /**
     * v0.18 places an aircraft: airborne (`progress` 0..1) at its arc's height, nose along the arc (it pitches up in the
     * climb and down on the descent), its shadow on the ground under it, a little down and right on screen as it climbs;
     * on the ground at its stand (`stand`, screen px east and south of the airport), nose north. Returns where it shows
     * on screen (null: behind the Earth or near the limb).
     */
    const placeAc = (o: AcObj, pos: [number, number], progress: number, arc: ArcObj | undefined, stand: [number, number] | undefined, k: number, cam: Vec3, wpp: number, pxPerM: number, crt: Vec3, cup: Vec3) => {
      const n0 = vecOf(pos[0], pos[1]);
      let ground: Vec3 = n0;
      let P: Vec3;
      let fwd: Vec3;
      let up: Vec3;
      let alt = 0;
      if (progress >= 0 && arc && arc.pts.length > 1) {
        alt = liftAt(arc.lift, progress);
        P = vecOf(pos[0], pos[1], R_AC + alt);
        const a = onArc(arc, progress - 0.004, R_AC);
        const b = onArc(arc, progress + 0.004, R_AC);
        const d = sub(b, a);
        fwd = Math.hypot(...d) > 1e-9 ? norm(d) : headingVec(pos, arc.pts[arc.pts.length - 1]);
        const nn = norm(P);
        // Up: the local vertical, square to the nose.
        const along = fwd[0] * nn[0] + fwd[1] * nn[1] + fwd[2] * nn[2];
        up = norm([nn[0] - fwd[0] * along, nn[1] - fwd[1] * along, nn[2] - fwd[2] * along]);
      } else {
        const off = stand ?? [20, 0];
        const { east, north } = tangentsAt(pos);
        ground = norm([n0[0] + (east[0] * off[0] - north[0] * off[1]) * wpp, n0[1] + (east[1] * off[0] - north[1] * off[1]) * wpp, n0[2] + (east[2] * off[0] - north[2] * off[1]) * wpp]);
        P = [ground[0] * R_AC, ground[1] * R_AC, ground[2] * R_AC];
        fwd = norm(sub(north, [ground[0] * (north[0] * ground[0] + north[1] * ground[1] + north[2] * ground[2]), ground[1] * (north[0] * ground[0] + north[1] * ground[1] + north[2] * ground[2]), ground[2] * (north[0] * ground[0] + north[1] * ground[1] + north[2] * ground[2])]));
        up = ground;
      }
      // The model: metres → world units at the map's px per metre (to scale, as the flat map and the shadow).
      const sc = pxPerM * wpp * k;
      const right = cross(fwd, up);
      m4.makeBasis(vx.set(right[0] * sc, right[1] * sc, right[2] * sc), vy.set(fwd[0] * sc, fwd[1] * sc, fwd[2] * sc), vz.set(up[0] * sc, up[1] * sc, up[2] * sc));
      m4.setPosition(P[0], P[1], P[2]);
      o.group.matrix.copy(m4);
      o.group.matrixWorldNeedsUpdate = true;
      // The shadow: under it (on its stand, right under), falling down-right on screen as it climbs.
      const lf = arc && arc.lift > 0 ? Math.min(1, alt / 0.06) : 0;
      const fall = Math.min(SHADOW_PX, (alt / Math.max(1e-6, wpp)) * 0.35) * wpp;
      const gN = progress >= 0 ? norm(n0) : ground;
      const shift: Vec3 = [(crt[0] - cup[0]) * fall * 0.7, (crt[1] - cup[1]) * fall * 0.7, (crt[2] - cup[2]) * fall * 0.7];
      const step = Math.round(lf * (SHADOW_STEPS - 1));
      const sm = shadeMat(o.typeId, step);
      if (o.shadow.material !== sm) o.shadow.material = sm;
      placeQuad(o.shadow, vn.set(gN[0], gN[1], gN[2]), fwd, R_SHADOW, o.dim * pxPerM * QUAD_PER_DIM * wpp * k, shift);
      o.shadow.visible = !occluded(vecOf(...lonLatOf(gN), R_SHADOW), cam);
      const nn = norm(P);
      const vis = !occluded(P, cam) && (alt > 0.004 || facing(ground, cam, LABEL_COS));
      return vis && facing(nn, cam, alt > 0.004 ? -0.2 : LABEL_COS) ? projectView(P, cv, w, h) : null;
    };
    const trailWins = new Map<string, { key: string; w: [number, number] | null }>();
    /** The contrail window of a leg (game minutes), cached by its times. */
    const trailWin = (f: Flight, typeId: string) => {
      const k = `${f.atd ?? f.std}|${f.ata ?? f.eta ?? f.sta}|${f.to}`;
      let e = trailWins.get(f.id);
      if (!e || e.key !== k) trailWins.set(f.id, (e = { key: k, w: contrailWindow(f, typeId) }));
      return e.w;
    };
    const lonLat = (v: Vec3): [number, number] => [Math.atan2(-v[2], v[0]) * (180 / Math.PI), Math.asin(Math.max(-1, Math.min(1, v[1]))) * (180 / Math.PI)];
    const lonLatOf = lonLat;
    /**
     * v0.18 spotter: the camera eases after the followed aircraft (clear of the panel), after a fly-in to it when a new one
     * is picked; a drag or pinch by the player pauses it for a few seconds. Reduced motion: it jumps when the aircraft
     * nears the edge. True while it moved the camera.
     */
    const followStep = (now: number, dt: number) => {
      const fo = propsRef.current.follow;
      if (!fo) { followed = ''; return false; }
      if (gesture || now - lastInteract < FOLLOW_WAIT_MS) return false;
      const a = fleetNow.find((x) => x.id === fo.id) ?? (store.game ? globeFleet(store.game, liveMinute()).find((x) => x.id === fo.id) : undefined);
      if (!a) return false;
      const dist = Math.min(orbit.dist, FOLLOW_DIST);
      const aim = { ...aimAt(a.pos, dist, h, PANEL_W / 2), dist };
      if (followed !== fo.key) {
        followed = fo.key;
        flyTo(aim, 1100);
        return true;
      }
      const off = angleBetween([orbit.lon, orbit.lat], [aim.lon, aim.lat]);
      if (reduced) {
        if (off > 8) { orbit = aim; return true; }
        return false;
      }
      if (off < 0.002) return false;
      const f = 1 - Math.exp(-dt / 600);
      orbit = { lon: wrap180(orbit.lon + wrap180(aim.lon - orbit.lon) * f), lat: clampLat(orbit.lat + (aim.lat - orbit.lat) * f), dist: orbit.dist + (aim.dist - orbit.dist) * f };
      return true;
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
        orbit = { ...orbit, lon: wrap180(orbit.lon - (dx * dpp) / Math.max(0.25, Math.cos((orbit.lat * Math.PI) / 180))), lat: clampLat(orbit.lat + (dy * dpp) / Math.cos(tiltNow * (Math.PI / 180))) };
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
      // v0.19 (perf) the screens' hourly refresh waits for the drag and its inertia to end (the frame loop sends it).
      if (gesture.moved > 8) { held = true; store.mapGesture(true); }
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
      const cam = cv.pos;
      const items: { x: number; y: number; item: Ref | (() => void) }[] = [];
      // v0.18 the marks first, as on the flat map: weather (opens what the game has on it), pins, events, crew changes.
      const mk = propsRef.current.marks;
      for (const [key, sp] of markScreen) {
        const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        if (kind === 'wx') {
          const m = mk.wx.find((x) => x.at === id);
          if (!m) continue;
          const tp = m.tap;
          items.push({ ...sp, item: 'decision' in tp ? () => { if (game.decisions.some((d) => d.id === tp.decision)) store.openModal({ kind: 'decision', decisionId: tp.decision }); } : tp.sel });
        } else if (kind === 'pin') {
          const pg = mk.pins.find((x) => x.code === id);
          if (pg) items.push({ ...sp, item: pg.offers.length === 1 ? { kind: 'offer', id: pg.offers[0].id } : { kind: 'airport', id: pg.code } });
        } else if (kind === 'ev') items.push({ ...sp, item: { kind: 'event', id } });
        else if (kind === 'slip') items.push({ ...sp, item: { kind: 'flight', id } });
      }
      for (const [id, s] of acScreen) items.push({ x: s.x, y: s.y, item: { kind: 'aircraft', id } });
      for (const [id, s] of cmScreen) items.push({ x: s.x, y: s.y, item: { kind: 'flight', id } });
      // Airports are a smaller target than aircraft (they sit under them at a stand).
      for (const a of propsRef.current.airports) {
        const ap = AIRPORT_BY_CODE[a.code];
        if (!ap) continue;
        const v = vecOf(ap.lon, ap.lat, R_AP);
        if (!facing(v, cam, LABEL_COS)) continue;
        const q = projectView(v, cv, w, h);
        if (q) items.push({ x: q.x, y: q.y, item: { kind: 'airport', id: a.code } });
      }
      const hit = pickNearest(items, x, y, r);
      const now = performance.now();
      if (hit) {
        if (typeof hit === 'function') hit();
        else store.select(hit);
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
      marks: (list: MarkEl[]) => { marks = list; dirty = true; kick(); },
      kick: () => { dirty = true; kick(); },
      zoom: (f: number) => {
        lastInteract = performance.now();
        const to = { ...orbit, dist: clampDist(1 + (orbit.dist - 1) * f) };
        // Zooming in with something selected in view closes in on it (kept clear of the panel), not on the middle.
        const at = selPos(propsRef.current.sel);
        if (at && f < 1 && facing(vecOf(...at), cv.pos, LABEL_COS)) {
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
        // v0.18 a crew change: its mark at the fuel stop.
        const m = propsRef.current.marks.slipMarks.find((x) => x.id === s.id);
        const A = m && AIRPORT_BY_CODE[m.at];
        return A ? [A.lon, A.lat] : null;
      }
      // v0.18 an offer: its pin; an event: its pin.
      const at = s.kind === 'offer' ? store.game?.offers[s.id]?.pin : s.kind === 'event' ? propsRef.current.marks.evPins.find((x) => x.eventId === s.id)?.at : undefined;
      const A = at ? AIRPORT_BY_CODE[at] : undefined;
      return A ? [A.lon, A.lat] : null;
    };
    stats.orbit = () => ({ ...orbit });
    stats.fleet = () => fleetNow.map((a) => ({ id: a.id, pos: a.pos, airborne: a.airborne, progress: a.progress }));
    stats.aim = (lon, lat, dist) => flyTo({ lon: wrap180(lon), lat: clampLat(lat), dist: clampDist(dist ?? orbit.dist) }, 600);
    selKey = propsRef.current.sel ? `${propsRef.current.sel.kind}:${propsRef.current.sel.id}` : '';
    resize();
    void loadEarth();

    return () => {
      disposed = true;
      if (held) store.mapGesture(false);
      unCapture();
      api.current = null;
      stats.aim = null;
      stats.fleet = null;
      stats.orbit = null;
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
      for (const c of cms.values()) { dropArc(c.arc); dropAc(c.ac); }
      for (const o of acs.values()) dropAc(o);
      trailTex.dispose();
      trailMat.dispose();
      disposeModels();
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
  useEffect(() => { api.current?.propsChanged(); }, [props.sel?.kind, props.sel?.id, props.airports, props.nextArcs, props.tours, props.theme, props.accent, props.panelOpen, props.g, props.marks, props.slipLegs, props.follow?.key]);
  // v0.18 the marks React drew: the loop places them every frame.
  useLayoutEffect(() => {
    const svg = marksRef.current;
    if (!svg) return;
    const list: MarkEl[] = [];
    for (const el of Array.from(svg.querySelectorAll('[data-gm]')) as SVGGElement[]) {
      const [lon, lat] = (el.dataset.ll ?? '').split(',').map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) { el.style.display = 'none'; continue; }
      const off = (el.dataset.off ?? '0,0').split(',').map(Number) as [number, number];
      list.push({ el, key: el.dataset.gm!, at: vecOf(lon, lat, R_AP), face: Number(el.dataset.face ?? LABEL_COS), off });
    }
    api.current?.marks(list);
  });
  const selId = props.sel && props.sel.kind !== 'aircraft' ? props.sel.id : undefined;

  return (
    <div className="globe-view">
      <div className="globe-stage" ref={stageRef} />
      <svg className="globe-marks" ref={marksRef} aria-hidden>
        <GlobeMarks {...props.marks} selected={selId} touch={isTouch()} />
      </svg>
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
