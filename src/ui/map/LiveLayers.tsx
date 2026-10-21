// Ops Map (B4) SVG layers: night terminator (WorldMap backdrop: its own composited layer, slid
// sideways by the sun without a repaint), flight paths and selected-aircraft arcs (under the airports),
// offer pins, airline legs carrying our crew (grey) and our aircraft glyphs (above). Aircraft, airline
// legs, their paths and the terminator move in one imperative rAF loop (30 fps on touch, full rate while
// zooming; no React render per frame); the rest re-renders with the hourly emit.
// v0.5.2: every airborne leg draws its whole great circle from take-off to landing (one path element,
// built once per leg and dropped on landing): operating solid green, positioning/ferry dotted amber,
// airline deadheads thin grey dotted.

import { geoInterpolate, geoPath } from 'd3-geo';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { aircraftLive, type AircraftLive } from '../../engine/core/query';
import type { GameState, Livery } from '../../engine/core/types';
import { commercialFlightsBetween, commercialProgress, type CommercialFlight, type FlightType, flightType, liveryOf } from '../../engine/ops';
import { PLANE_PATH } from '../components/Logo';
import { liveMinute, store } from '../store';
import { isTouch } from '../useMedia';
import { MAP_H, MAP_W } from './mapData';
import { headingDeg, type LabelBox, groupCommercial, lerpAngle, parkOffset, downSide, legLabelSide, placeLabels, trackCovered, trackLabelAt, type LegArc, type PinGroup, sunPoint, terminator, TYPE_STROKE } from './mapLogic';
import type { MapLayerCtx } from './WorldMap';

/** Live positions shared with tap picking and focus (map units, as last drawn). */
export interface LiveShared {
  ac: Map<string, [number, number]>;
  /** Airline legs with our crew aboard, by CommercialFlight id. */
  cm: Map<string, [number, number]>;
  night: SVGPathElement | null;
  /** Subsolar point the night path was built for (it is then slid by the sun's longitude change). */
  nightSun: [number, number] | null;
  /** Path groups (underlay): airline legs under ours. */
  pathsCm: SVGGElement | null;
  pathsOwn: SVGGElement | null;
  /** Grey airline icons (above the pins, under our aircraft). */
  cmRoot: SVGGElement | null;
  /** Airports on the map (map units; `code` when it is labelled): airline flight numbers keep clear of them. */
  aps: { p: [number, number]; code: boolean }[];
}

export const newShared = (): LiveShared => ({ ac: new Map(), cm: new Map(), night: null, nightSun: null, pathsCm: null, pathsOwn: null, cmRoot: null, aps: [] });

/** Frame cost stats for perf checks (console: __contrailMap). */
const stats = { frames: 0, avgMs: 0, maxMs: 0, reset() { this.frames = 0; this.avgMs = 0; this.maxMs = 0; } };
(globalThis as unknown as { __contrailMap?: typeof stats }).__contrailMap = stats;

const WRENCH = 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z';
/** Hit radius in screen px (44 px target on touch). */
export const HIT_R = { touch: 22, mouse: 14 };
const GLYPH_PX = 22;
/** Airline icons: a little smaller than ours. */
const CM_GLYPH_PX = 20;
/** Airline legs are fetched for this many game minutes at a time, then filtered per frame. */
const CM_BUCKET = 10;
const NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e;
}

/** A flight path element styled for its type (dash and width are screen px: non-scaling stroke). */
function stylePath(e: SVGPathElement, type: FlightType) {
  const st = TYPE_STROKE[type];
  e.setAttribute('class', `ops-path ${type}`);
  e.setAttribute('stroke', st.color);
  e.setAttribute('stroke-width', String(st.width));
  if (st.dash) e.setAttribute('stroke-dasharray', st.dash);
  else e.removeAttribute('stroke-dasharray');
}
/** Taxi easing time constant (ms) between the runway point and a parking stand. */
const TAXI_MS = 140;
const PARK_ANGLE = 0;

// ---------- night ----------

/**
 * Night polygon path (map units) for a subsolar point on the (cylindrical, unrotated) ops projection,
 * three world widths wide so it can slide a whole world sideways as the sun moves.
 */
export function nightPath(proj: MapLayerCtx['proj'], sun: [number, number]): string {
  const { pts, northNight } = terminator(sun, 3);
  const xy = pts.map((p) => proj(p)).filter(Boolean) as [number, number][];
  let d = '';
  for (const c of [-1, 0, 1]) for (const q of xy) d += `${d ? 'L' : 'M'}${(q[0] + c * MAP_W).toFixed(1)} ${q[1].toFixed(1)}`;
  const edge = northNight ? -MAP_H : MAP_H * 2;
  return `${d}L${(xy[xy.length - 1][0] + MAP_W).toFixed(1)} ${edge}L${(xy[0][0] - MAP_W).toFixed(1)} ${edge}Z`;
}

/** Sideways shift (map units) of a night path built for sun0 to where the sun is now. */
export const nightShift = (sun0: [number, number], sun: [number, number]) => (((((sun[0] - sun0[0] + 180) % 360) + 360) % 360) - 180) / 360 * MAP_W;

/** Rebuilds the night path for game minute t (one repaint of the backdrop layer only). */
function buildNight(shared: LiveShared, proj: MapLayerCtx['proj'], t: number, shift: MapLayerCtx['backShift']) {
  if (!shared.night) return;
  const sun = sunPoint(t);
  shared.night.setAttribute('d', nightPath(proj, sun));
  shared.nightSun = sun;
  shift(0);
}

/** Night terminator: render it as the WorldMap `backdrop`. */
export const NightLayer = memo(function NightLayer({ shared, proj, shift }: { shared: LiveShared; proj: MapLayerCtx['proj']; shift: MapLayerCtx['backShift'] }) {
  const ref = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    shared.night = ref.current;
    buildNight(shared, proj, liveMinute(), shift);
    return () => { shared.night = null; shared.nightSun = null; };
  }, [shared, proj, shift]);
  return (
    <g className="ops-night" pointerEvents="none">
      <path ref={ref} />
    </g>
  );
});

// ---------- always-on flight paths ----------

/** Groups the live loop fills with one path per airborne leg (render as the WorldMap `underlay`, under the arcs). */
export const PathsLayer = memo(function PathsLayer({ shared }: { shared: LiveShared }) {
  const cm = useRef<SVGGElement>(null);
  const own = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    shared.pathsCm = cm.current;
    shared.pathsOwn = own.current;
    return () => { shared.pathsCm = null; shared.pathsOwn = null; };
  }, [shared]);
  return (
    <g className="ops-paths" pointerEvents="none">
      <g ref={cm} className="cm" />
      <g ref={own} className="own" />
    </g>
  );
});

/** Group the live loop fills with grey airline icons (render between the pins and our aircraft). */
export const CommercialLayer = memo(function CommercialLayer({ shared }: { shared: LiveShared }) {
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    shared.cmRoot = ref.current;
    return () => { shared.cmRoot = null; };
  }, [shared]);
  return <g ref={ref} className="ops-cm" />;
});

// ---------- arcs ----------

export const ArcsLayer = memo(function ArcsLayer({ legs, proj }: { legs: LegArc[]; proj: MapLayerCtx['proj'] }) {
  const path = useMemo(() => geoPath(proj), [proj]);
  return (
    <g className="ops-arcs" pointerEvents="none">
      {legs.map((l, i) => {
        const A = AIRPORT_BY_CODE[l.from];
        const B = AIRPORT_BY_CODE[l.to];
        const d = A && B ? path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] }) : null;
        if (!d) return null;
        const color = l.color ?? '#dfe8fb';
        return (
          <path
            key={l.id}
            d={d}
            className={l.current ? 'cur' : 'next'}
            stroke={color}
            strokeOpacity={l.current ? 0.95 : Math.max(0.22, 0.42 - i * 0.06)}
            strokeWidth={l.current ? 2.2 : 1.4}
            strokeDasharray={l.dashed ? '5 5' : undefined}
          />
        );
      })}
    </g>
  );
});

// ---------- offer pins ----------

/** Pin offset in screen px: left of the dot at airports we already mark (code above, parked aircraft right). */
export const pinOffset = (marked: boolean): [number, number] => (marked ? [-20, 0] : [0, 0]);

/** Pin code label: font px and baseline below the diamond. */
const PIN_FS = 10.5;
const PIN_LABEL_Y = 21;

/**
 * Offer diamonds; pins away from our own airports carry their airport code (dropped where codes
 * would overlap). Drawn in screen px inside a `.mk` group that WorldMap counter-scales live.
 */
export const PinsLayer = memo(function PinsLayer({ pins, marked, proj, unit, selected }: {
  pins: PinGroup[]; marked: Set<string>; proj: MapLayerCtx['proj']; unit: number; selected?: string;
}) {
  const pts = useMemo(() => pins.map((p) => {
    const a = AIRPORT_BY_CODE[p.code];
    return { p, q: proj([a.lon, a.lat]), off: pinOffset(marked.has(p.code)), marked: marked.has(p.code) };
  }), [pins, marked, proj]);
  const labels = useMemo(() => {
    const boxes: LabelBox[] = [];
    for (const { p, q, off, marked: m } of pts) {
      if (!q) continue;
      const x = q[0] / unit + off[0];
      const y = q[1] / unit + off[1];
      // Diamonds block labels too; marked airports already show their code.
      boxes.push({ id: `d:${p.code}`, x, y, w: 17, h: 17 });
      if (!m) boxes.push({ id: p.code, x, y: y + PIN_LABEL_Y - PIN_FS * 0.35, w: p.code.length * PIN_FS * 0.62 + 2, h: PIN_FS });
    }
    // Diamonds first so a code never covers another pin.
    return placeLabels([...boxes.filter((b) => b.id.startsWith('d:')), ...boxes.filter((b) => !b.id.startsWith('d:'))], 1);
  }, [pts, unit]);
  return (
    <g className="ops-pins">
      {pts.map(({ p, q, off }) => {
        if (!q) return null;
        const sel = selected !== undefined && (selected === p.code || p.offers.some((o) => o.id === selected));
        return (
          <g key={p.code} transform={`translate(${q[0]} ${q[1]})`} className={`ops-pin ${p.urgent ? 'urgent' : ''} ${sel ? 'sel' : ''}`}>
            <g className="mk" transform={`scale(${unit})`}>
              <g transform={`translate(${off[0]} ${off[1]})`}>
                <circle className="hit" r={HIT_R.touch} />
                {p.urgent && <circle className="ring" r={13} />}
                {sel && <circle className="sel-ring" r={16} />}
                <path className="dia" d="M0 -8.5L8.5 0L0 8.5L-8.5 0Z" />
                {p.offers.length > 1 && <text className="count" x={11} y={-7}>{p.offers.length}</text>}
                {(labels.has(p.code) || sel) && <text className="code" y={PIN_LABEL_Y}>{p.code}</text>}
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
});

// ---------- aircraft ----------

/** Map glyph fill and outline for a livery: the primary with a readable edge; all white = light fill, dark outline. */
function glyphInk(l: Livery): [string, string] {
  if (l.plain) return ['#eef2f8', '#1b2436'];
  const edge = luminance(l.secondary) > 0.3 && Math.abs(luminance(l.secondary) - luminance(l.primary)) > 0.2 ? l.secondary : '#f4f7ff';
  return [l.primary, edge];
}

/** Relative luminance (0–1) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

interface Glide { ox: number; oy: number; ang: number }

/** Our airborne leg's path element. */
interface OwnPath { el: SVGPathElement; acId: string; type: FlightType; from: string; to: string }
/** An airline leg on the map: icon group, rotating glyph and path. */
interface CmEl { el: SVGGElement; glyph: SVGGElement; no: SVGTextElement; side: 1 | -1; pref: 1 | -1; sideK: number; sideAps: LiveShared['aps'] | null; at: string; hide: boolean[]; hidden: boolean; path: SVGPathElement | null; gi: (t: number) => [number, number]; cf: CommercialFlight }

export function AircraftLayer({ ctx, g, shared, selected, selectedFlight }: { ctx: MapLayerCtx; g: GameState; shared: LiveShared; selected?: string; selectedFlight?: string }) {
  const ref = useRef<SVGGElement>(null);
  const ids = Object.keys(g.fleet);
  const idsKey = ids.join(',');
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const selRef = useRef(selected);
  selRef.current = selected;
  const selFRef = useRef(selectedFlight);
  selFRef.current = selectedFlight;
  /** Bumped by React renders so the loop redraws once even when time stands still. */
  const dirty = useRef(true);
  dirty.current = true;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = new Map<string, { el: SVGGElement; glyph: SVGGElement; crowd: boolean }>();
    for (const el of Array.from(root.children) as SVGGElement[]) {
      const id = el.dataset.id!;
      els.set(id, { el, glyph: el.querySelector('.glyph') as SVGGElement, crowd: false });
    }
    const glide = new Map<string, Glide>();
    const minFrame = isTouch() ? 1000 / 30 - 3 : 0;
    const NO_FS = isTouch() ? 11.5 : 10.5; // .ops-cmf .no font size
    let raf = 0;
    let last = 0;
    let lastT = NaN;
    let lastK = NaN;
    let lastSunT = NaN;
    let lastSun: [number, number] | null = null;
    let labels: boolean | null = null;
    let settling = true;
    // Paths and airline legs (built once per leg; d rebuilt only when the projection changes).
    const own = new Map<string, OwnPath>();
    const cms = new Map<string, CmEl>();
    let ownRoot: SVGGElement | null = null;
    let cmPathRoot: SVGGElement | null = null;
    let cmRoot: SVGGElement | null = null;
    let projUsed: MapLayerCtx['proj'] | null = null;
    let gen: ReturnType<typeof geoPath> | null = null;
    let cmKey = '';
    let cmGame: GameState | null = null;
    let cmList: CommercialFlight[] = [];
    let selKey = '';
    const lineD = (from: string, to: string) => {
      const A = AIRPORT_BY_CODE[from];
      const B = AIRPORT_BY_CODE[to];
      return (A && B && gen!({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] })) || '';
    };
    const dropCm = (id: string, c: CmEl) => { c.el.remove(); c.path?.remove(); cms.delete(id); shared.cm.delete(id); };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.visibilityState === 'hidden') return;
      // 30 fps on touch, but every frame while the zoom moves (glyphs are counter-scaled per frame).
      if (now - last < minFrame && ctxRef.current.liveK() === lastK) return;
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      const game = store.game;
      // Frozen while a modal is open (time is held; blurred backdrops over motion are expensive).
      if (!game || store.modal) return;
      const c = ctxRef.current;
      const t = liveMinute();
      const k = c.liveK();
      const rooted = shared.pathsOwn === ownRoot && shared.pathsCm === cmPathRoot && shared.cmRoot === cmRoot;
      if (t === lastT && k === lastK && !settling && !dirty.current && rooted && c.proj === projUsed) return;
      const t0 = performance.now();
      const fresh = dirty.current;
      dirty.current = false;
      lastT = t;
      lastK = k;
      const proj = c.proj;
      if (!rooted || proj !== projUsed) {
        // (Re)mounted groups or a new projection: rebuild every path and icon.
        for (const p of own.values()) p.el.remove();
        own.clear();
        for (const [id, x] of cms) dropCm(id, x);
        ownRoot = shared.pathsOwn;
        cmPathRoot = shared.pathsCm;
        cmRoot = shared.cmRoot;
        projUsed = proj;
        gen = geoPath(proj);
        selKey = '';
      }
      // Terminator: slid sideways on the compositor as the sun moves; rebuilt (one backdrop repaint)
      // when the slide nears the layer's margin (also after a zoom: the margin is in screen px) or the declination has drifted.
      if (shared.night) {
        const sun = t === lastSunT && lastSun ? lastSun : sunPoint(t);
        lastSunT = t;
        lastSun = sun;
        const s0 = shared.nightSun;
        if (!s0 || Math.abs(sun[1] - s0[1]) > 0.05) buildNight(shared, proj, t, c.backShift);
        else if (Math.abs(c.backShift(nightShift(s0, sun))) > c.margin / 2) buildNight(shared, proj, t, c.backShift);
      }
      const u = 1 / (c.px * k); // map units per screen px right now
      const wantLabels = k / (c.fitK || 1) >= 2;
      if (wantLabels !== labels) {
        labels = wantLabels;
        root.classList.toggle('labels', wantLabels);
      }
      // Pass 1: where each aircraft is; parked ones are grouped per airport for their stands.
      const lives: AircraftLive[] = [];
      const parked = new Map<string, number>();
      for (const id of ids) {
        const ac = game.fleet[id];
        if (!ac || !AIRPORT_BY_CODE[ac.at]) continue;
        const live = aircraftLive(game, ac, t);
        if (live.phase !== 'airborne') parked.set(live.at!, (parked.get(live.at!) ?? 0) + 1);
        lives.push(live);
      }
      const slot = new Map<string, number>();
      const f = 1 - Math.exp(-dt / TAXI_MS);
      settling = false;
      for (const live of lives) {
        const id = live.aircraft.id;
        const e = els.get(id);
        const p = proj(live.pos);
        if (!e || !p) continue;
        let tox = 0;
        let toy = 0;
        let tang = PARK_ANGLE;
        let crowd = false;
        if (live.phase === 'airborne' && live.flight) {
          const A = AIRPORT_BY_CODE[live.flight.from];
          const B = AIRPORT_BY_CODE[live.flight.to];
          const gi = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
          const a = proj(gi(Math.max(0, live.progress - 0.004)));
          const b = proj(gi(Math.min(1, live.progress + 0.004)));
          if (a && b && (a[0] !== b[0] || a[1] !== b[1])) tang = headingDeg(a, b, MAP_W);
        } else {
          const n = slot.get(live.at!) ?? 0;
          const of = parked.get(live.at!) ?? 1;
          slot.set(live.at!, n + 1);
          [tox, toy] = parkOffset(n, of);
          crowd = of > 1;
        }
        let s = glide.get(id);
        if (!s) glide.set(id, (s = { ox: tox, oy: toy, ang: tang }));
        // Planes always fly true to the great circle; the stand offset and nose ease (taxi in/out).
        s.ox += (tox - s.ox) * f;
        s.oy += (toy - s.oy) * f;
        s.ang = lerpAngle(s.ang, tang, live.phase === 'airborne' && Math.abs(s.ox) + Math.abs(s.oy) < 1 ? 1 : f);
        if (Math.abs(tox - s.ox) + Math.abs(toy - s.oy) > 0.3) settling = true;
        else { s.ox = tox; s.oy = toy; }
        e.el.setAttribute('transform', `translate(${p[0].toFixed(2)} ${p[1].toFixed(2)}) scale(${u.toPrecision(4)}) translate(${s.ox.toFixed(1)} ${s.oy.toFixed(1)})`);
        e.glyph.setAttribute('transform', `rotate(${s.ang.toFixed(1)})`);
        if (e.el.dataset.phase !== live.phase) e.el.dataset.phase = live.phase;
        if (e.crowd !== crowd) e.el.classList.toggle('crowd', (e.crowd = crowd));
        shared.ac.set(id, [p[0] + s.ox * u, p[1] + s.oy * u]);
      }
      // Our airborne legs: one path each from take-off to landing (types refreshed with each React render).
      const seen = new Set<string>();
      for (const live of lives) {
        const f = live.phase === 'airborne' ? live.flight : undefined;
        const e = els.get(live.aircraft.id);
        if (!f) {
          if (e && e.el.dataset.type) e.el.dataset.type = '';
          continue;
        }
        seen.add(f.id);
        let op = own.get(f.id);
        if (!op && ownRoot) {
          const type = flightType(game, f);
          const el = svgEl('path', { d: lineD(f.from, f.to) }, ownRoot);
          stylePath(el, type);
          own.set(f.id, (op = { el, acId: live.aircraft.id, type, from: f.from, to: f.to }));
          selKey = '';
        } else if (op && fresh) {
          const type = flightType(game, f);
          if (type !== op.type) stylePath(op.el, (op.type = type));
          if (op.from !== f.from || op.to !== f.to) op.el.setAttribute('d', lineD((op.from = f.from), (op.to = f.to)));
          selKey = '';
        }
        if (e && op && e.el.dataset.type !== op.type) e.el.dataset.type = op.type;
      }
      for (const [id, op] of own) if (!seen.has(id)) { op.el.remove(); own.delete(id); }
      // Airline legs carrying our crew: fetched per CM_BUCKET minutes (and per emit), filtered to the airborne ones.
      if (cmRoot) {
        const b = Math.floor(t / CM_BUCKET) * CM_BUCKET;
        const key = `${store.version}:${b}`;
        if (key !== cmKey || cmGame !== game) {
          cmKey = key;
          cmGame = game;
          cmList = groupCommercial(commercialFlightsBetween(game, b, b + CM_BUCKET));
        }
        const up = new Set<string>();
        for (const cf of cmList) {
          if (cf.leg.dep > t || cf.leg.arr <= t) continue;
          const A = AIRPORT_BY_CODE[cf.leg.from];
          const B = AIRPORT_BY_CODE[cf.leg.to];
          if (!A || !B) continue;
          up.add(cf.id);
          let x = cms.get(cf.id);
          if (!x) {
            const el = svgEl('g', { class: 'ops-cmf', 'data-id': cf.id }, cmRoot);
            svgEl('circle', { class: 'hit', r: HIT_R.touch }, el);
            svgEl('circle', { class: 'sel-ring', r: 14 }, el);
            const glyph = svgEl('g', { class: 'glyph' }, el);
            svgEl('path', { d: PLANE_PATH, transform: `scale(${CM_GLYPH_PX / 24}) translate(-12 -12)` }, glyph);
            const no = svgEl('text', { class: 'no' }, el);
            no.textContent = cf.leg.no;
            const path = cmPathRoot ? svgEl('path', { d: lineD(cf.leg.from, cf.leg.to) }, cmPathRoot) : null;
            if (path) stylePath(path, 'deadhead');
            // Preferred side: below the track (right of a north–south one), from the leg's chord.
            const pa = proj([A.lon, A.lat]);
            const pb = proj([B.lon, B.lat]);
            const pref = pa && pb ? downSide(headingDeg(pa, pb, MAP_W)) : 1;
            no.setAttribute('text-anchor', 'middle');
            cms.set(cf.id, (x = { el, glyph, no, side: pref, pref, sideK: 0, sideAps: null, at: '', hide: [], hidden: false, path, gi: geoInterpolate([A.lon, A.lat], [B.lon, B.lat]), cf }));
            selKey = '';
          }
          x.cf = cf;
          const pr = commercialProgress(cf, t);
          const p = proj(x.gi(pr));
          if (!p) continue;
          const a = proj(x.gi(Math.max(0, pr - 0.004)));
          const q = proj(x.gi(Math.min(1, pr + 0.004)));
          const ang = a && q && (a[0] !== q[0] || a[1] !== q[1]) ? headingDeg(a, q, MAP_W) : 0;
          x.el.setAttribute('transform', `translate(${p[0].toFixed(2)} ${p[1].toFixed(2)}) scale(${u.toPrecision(4)})`);
          x.glyph.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
          // The flight number rides across the track on one side per leg (re-chosen after a zoom): the
          // preferred one unless the other covers clearly fewer airport codes and dots over the whole leg.
          // Where it would still sit on an airport code (passing close by one), it fades out for that stretch.
          const w = cf.leg.no.length * NO_FS * 0.62 + 2;
          if (!x.sideK || Math.abs(k / x.sideK - 1) > 0.12 || x.sideAps !== shared.aps) {
            x.sideK = k;
            x.sideAps = shared.aps;
            const track: { x: number; y: number; ang: number }[] = [];
            for (let i = 0; i <= 32; i++) {
              const f0 = i / 32;
              const s0 = proj(x.gi(f0));
              const s1 = proj(x.gi(f0 + 0.004));
              if (s0 && s1) track.push({ x: s0[0] / u, y: s0[1] / u, ang: headingDeg(s0, s1, MAP_W) });
            }
            const xs = track.map((s) => s.x);
            const ys = track.map((s) => s.y);
            const [x0, x1, y0, y1] = [Math.min(...xs) - 90, Math.max(...xs) + 90, Math.min(...ys) - 60, Math.max(...ys) + 60];
            const obs: LabelBox[] = [];
            const codes: LabelBox[] = [];
            for (const ap of shared.aps) {
              const ax = ap.p[0] / u;
              const ay = ap.p[1] / u;
              if (ax < x0 || ax > x1 || ay < y0 || ay > y1) continue;
              obs.push({ id: '', x: ax, y: ay, w: 10, h: 10 });
              if (ap.code) codes.push({ id: '', x: ax, y: ay - 15, w: 28, h: 15 });
            }
            x.side = legLabelSide(track, w, NO_FS, [...obs, ...codes], x.pref);
            x.hide = trackCovered(track, x.side, w, NO_FS, codes);
            x.el.dataset.dbg = JSON.stringify({ side: x.side, pref: x.pref, hide: x.hide.map(Number).join(''), codes: codes.map((c) => [Math.round(c.x - track[0].x), Math.round(c.y - track[0].y)]), t0: [Math.round(track[0].x), Math.round(track[0].y)], t1: [Math.round(track[32]?.x), Math.round(track[32]?.y)], n: shared.aps.length }); // DBGX
          }
          const hidden = !!x.hide[Math.round(pr * 32)];
          if (hidden !== x.hidden) x.no.classList.toggle('off', (x.hidden = hidden));
          const [cx, cy] = trackLabelAt(ang, x.side, w, NO_FS);
          const at = `${cx.toFixed(1)} ${(cy + NO_FS * 0.35).toFixed(1)}`;
          if (at !== x.at) {
            x.at = at;
            x.no.setAttribute('x', cx.toFixed(1));
            x.no.setAttribute('y', (cy + NO_FS * 0.35).toFixed(1));
          }
          shared.cm.set(cf.id, p);
        }
        for (const [id, x] of cms) if (!up.has(id)) dropCm(id, x);
      }
      // Selection: highlight the selected aircraft's path, or the selected airline leg and its path.
      const sk = `${selRef.current ?? ''}|${selFRef.current ?? ''}`;
      if (sk !== selKey) {
        selKey = sk;
        for (const op of own.values()) op.el.classList.toggle('sel', op.acId === selRef.current);
        for (const [id, x] of cms) {
          const on = id === selFRef.current;
          x.el.classList.toggle('sel', on);
          x.path?.classList.toggle('sel', on);
        }
      }
      const ms = performance.now() - t0;
      stats.frames++;
      stats.avgMs += (ms - stats.avgMs) / Math.min(stats.frames, 120);
      stats.maxMs = Math.max(stats.maxMs, ms);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idsKey, shared]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <g ref={ref} className="ops-aircraft">
      {ids.map((id) => {
        const ac = g.fleet[id];
        const [fill, outline] = glyphInk(liveryOf(g, ac).livery);
        return (
          <g key={id} data-id={id} data-phase="parked" className={`ops-ac ${selected === id ? 'sel' : ''}`}>
            <circle className="hit" r={HIT_R.touch} />
            <path className="hangar" d="M-15 11V-1Q0 -17 15 -1V11Z" />
            <circle className="sel-ring" r={16} />
            <circle className="aog-ring" r={14} />
            <g className="glyph">
              <path d={PLANE_PATH} transform={`scale(${GLYPH_PX / 24}) translate(-12 -12)`} fill={fill} stroke={outline} strokeWidth={1.4} strokeLinejoin="round" />
            </g>
            <g className="badge maint" transform="translate(11 -11)">
              <circle r={7.5} />
              <path d={WRENCH} transform="scale(0.42) translate(-12 -12)" />
            </g>
            <g className="badge aog" transform="translate(11 -11)">
              <circle r={7.5} />
              <path d="M0 -4V1M0 3.6V3.7" />
            </g>
            <text className="reg" y={25}>{ac.reg}</text>
            <text className="tag" y={-16}>FERRY</text>
          </g>
        );
      })}
    </g>
  );
}
