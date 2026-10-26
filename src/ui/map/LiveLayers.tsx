// Ops Map (B4) SVG layers: night terminator (WorldMap backdrop: its own composited layer, slid
// sideways by the sun without a repaint), flight paths and selected-aircraft arcs (under the airports),
// offer pins, airline legs carrying our crew (grey) and our aircraft glyphs (above). Aircraft, airline
// legs, their paths and the terminator move in one imperative rAF loop (30 fps on touch, full rate while
// zooming; no React render per frame); the rest re-renders with the hourly emit.
// v0.5.2: every airborne leg draws its whole great circle from take-off to landing (one path element,
// built once per leg and dropped on landing): operating solid green, positioning/ferry dotted amber,
// airline deadheads thin grey dotted.
// v0.7: an aircraft is drawn once handed over (at its handover site, possibly abroad), with a static DELIVERY tag
// until its delivery ferry is home; before the handover it is not drawn.
// v0.8: an aircraft dry-leased out stands at the lessee's base (in their paint when painted) with a grey LEASED tag.
// v0.9 §W.4: with an aircraft (or its crew change) selected, its slip crews' airline legs (static, deadhead style at
// selected weight) and a static crew-change mark at the fuel stop. Both re-render with the hourly emit only.

import { geoInterpolate, geoPath } from 'd3-geo';
import { Ban, CloudFog, CloudLightning, type LucideIcon, Moon } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { aircraftLive, type AircraftLive, divPos, flightTimes } from '../../engine/core/query';
import { interpolateGC } from '../../engine/core/geo';
import type { Flight, GameState, Livery } from '../../engine/core/types';
import { commercialFlightsBetween, commercialProgress, type CommercialFlight, type FlightType, flightType } from '../../engine/ops';
import { PLANE_PATH } from '../components/Logo';
import { liveMinute, store } from '../store';
import { mix } from '../components/aircraft/ink';
import { isTouch } from '../useMedia';
import { MAP_H, MAP_W } from './mapData';
import { deliveryTag, headingDeg, JET_PATH, leasedOut, onMap, type LabelBox, boxOverlap, groupCommercial, lerpAngle, parkOffset, downSide, legLabelSide, placeLabels, regSlot, type RegSlot, type SlipArc, type SlipMark, trackCovered, trackLabelAt, type LegArc, type PinGroup, sunElevation, sunPoint, TYPE_STROKE } from './mapLogic';
import { parkedFit, silColour, silhouette, silSpec } from './silhouettes';
import { fillNight, lightAlpha, mercLat, parseRgb } from './sky';
import { contrailWindow } from './spotter';
import type { WxKind, WxMark } from './weather';
import { projection } from './mapData';
import type { GlowPaint, MapLayerCtx } from './WorldMap';

/** Live positions shared with tap picking and focus (map units, as last drawn). */
export interface LiveShared {
  ac: Map<string, [number, number]>;
  /** Airline legs with our crew aboard, by CommercialFlight id. */
  cm: Map<string, [number, number]>;
  /** v0.12 the night raster's slide group, its three images and the declination they were painted for. */
  night: SVGGElement | null;
  nightImgs: SVGImageElement[];
  nightDec: number;
  /** Subsolar point the night was placed for (it is then slid by the sun's longitude change). */
  nightSun: [number, number] | null;
  /** v0.12 city lights: [lon, lat], map points, glow radii, the levels painted and when they were last updated. */
  lights: { ll: [number, number][]; pts: [number, number][]; r: number[]; lvl: Int8Array; at: number } | null;
  /** Path groups (underlay): airline legs under ours. */
  pathsCm: SVGGElement | null;
  pathsOwn: SVGGElement | null;
  /** Grey airline icons (above the pins, under our aircraft). */
  cmRoot: SVGGElement | null;
  /** Airports on the map (map units): airline flight numbers keep clear of their dots and codes. */
  aps: [number, number][];
}

export const newShared = (): LiveShared => ({ ac: new Map(), cm: new Map(), night: null, nightImgs: [], nightDec: NaN, nightSun: null, lights: null, pathsCm: null, pathsOwn: null, cmRoot: null, aps: [] });

/** Frame cost stats for perf checks (console: __contrailMap). */
const stats = { frames: 0, avgMs: 0, maxMs: 0, reset() { this.frames = 0; this.avgMs = 0; this.maxMs = 0; } };
(globalThis as unknown as { __contrailMap?: typeof stats }).__contrailMap = stats;

const WRENCH = 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z';
/** Hit radius in screen px (44 px target on touch). */
export const HIT_R = { touch: 22, mouse: 14 };
/** Airline icons: a little smaller than ours. */
const CM_GLYPH_PX = 20;
/** v0.7.1 chartered private jets: smaller still, in the same grey ink. */
const JET_GLYPH_PX = 18;
/** Airline legs are fetched for this many game minutes at a time, then filtered per frame. */
const CM_BUCKET = 10;
const NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e;
}

/** A flight path element styled for its type (dash and width are screen px: non-scaling stroke); v0.12 `part`: flown or to go. */
function stylePath(e: SVGPathElement, type: FlightType, part?: 'done' | 'ahead') {
  const st = TYPE_STROKE[type];
  const sel = e.classList.contains('sel');
  e.setAttribute('class', `ops-path ${type}${part ? ` ${part}` : ''}${sel ? ' sel' : ''}`);
  e.style.stroke = st.color;
  e.setAttribute('stroke-width', String(st.width));
  const dash = part === 'done' ? '' : part === 'ahead' ? AHEAD_DASH[type] : st.dash;
  if (dash) e.setAttribute('stroke-dasharray', dash);
  else e.removeAttribute('stroke-dasharray');
}
/** Taxi easing time constant (ms) between the runway point and a parking stand. */
const TAXI_MS = 140;
const PARK_ANGLE = 0;

// ---------- night ----------

/** v0.12 the night raster: one world wide (sun on the 0° meridian), rows over this band of map y (beyond the map's edges). */
const NIGHT_W = 360;
const NIGHT_H = 240;
const NIGHT_Y0 = -0.2 * MAP_H;
const NIGHT_Y1 = 1.2 * MAP_H;
/** Declination drift (deg) before the raster is repainted (≈ every 9 game hours near an equinox, days at a solstice). */
const NIGHT_DEC_STEP = 0.15;

/** Sideways shift (map units) of a night layer built for sun0 to where the sun is now. */
export const nightShift = (sun0: [number, number], sun: [number, number]) => (((((sun[0] - sun0[0] + 180) % 360) + 360) % 360) - 180) / 360 * MAP_W;

/** The theme's night colour and strength (CSS custom properties on the root). */
function nightInk(): { rgb: [number, number, number]; a: number } {
  const cs = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const rgb = parseRgb(cs?.getPropertyValue('--map-night-rgb') ?? '', [2, 6, 20]);
  const a = Number.parseFloat(cs?.getPropertyValue('--map-night-a') ?? '');
  return { rgb, a: Number.isFinite(a) ? a : 0.45 };
}

/** Paints the night raster for a declination into the three slide images (one repaint of the backdrop layer). */
function rasterNight(shared: LiveShared, dec: number) {
  const imgs = shared.nightImgs;
  if (!imgs.length) return;
  const cv = document.createElement('canvas');
  cv.width = NIGHT_W;
  cv.height = NIGHT_H;
  const c2 = cv.getContext('2d');
  if (!c2) return;
  const im = c2.createImageData(NIGHT_W, NIGHT_H);
  const { rgb, a } = nightInk();
  fillNight(im.data, NIGHT_W, NIGHT_H, dec, (j) => mercLat(NIGHT_Y0 + ((j + 0.5) / NIGHT_H) * (NIGHT_Y1 - NIGHT_Y0), MAP_W), rgb, a);
  c2.putImageData(im, 0, 0);
  const url = cv.toDataURL('image/png');
  for (const el of imgs) el.setAttribute('href', url);
  shared.nightDec = dec;
}

/** Places the night for game minute t (raster rebuilt only when the declination has drifted); the shift starts at 0. */
function buildNight(shared: LiveShared, t: number, shift: MapLayerCtx['backShift']) {
  if (!shared.night) return;
  const sun = sunPoint(t);
  if (!(Math.abs(sun[1] - shared.nightDec) < NIGHT_DEC_STEP)) rasterNight(shared, sun[1]);
  shared.night.setAttribute('transform', `translate(${((sun[0] / 360) * MAP_W).toFixed(2)} 0)`);
  shared.nightSun = sun;
  shift(0);
}

/**
 * Night side: render it as the WorldMap `backdrop`. v0.12 a soft raster (twilight band, no hard edge) slid sideways
 * as the sun moves; three copies so it covers the world at any shift. Rebuilt when the theme changes.
 */
export const NightLayer = memo(function NightLayer({ shared, shift, theme }: { shared: LiveShared; shift: MapLayerCtx['backShift']; theme: string }) {
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const g = ref.current;
    shared.night = g;
    shared.nightImgs = g ? (Array.from(g.querySelectorAll('image')) as SVGImageElement[]) : [];
    shared.nightDec = NaN;
    buildNight(shared, liveMinute(), shift);
    return () => { shared.night = null; shared.nightSun = null; shared.nightImgs = []; };
  }, [shared, shift, theme]);
  return (
    <g className="ops-night" pointerEvents="none">
      <g ref={ref}>
        {[-1, 0, 1].map((c) => <image key={c} x={c * MAP_W} y={NIGHT_Y0} width={MAP_W} height={NIGHT_Y1 - NIGHT_Y0} preserveAspectRatio="none" />)}
      </g>
    </g>
  );
});

// ---------- v0.12 city lights ----------

/** Glow radius (screen px) of an airport's city lights: bigger cities glow wider. */
const lightR = (pop: number) => 3.2 + 2.6 * Math.log10(1 + Math.max(0, pop));

/** Light levels (0 … LIGHT_STEPS) the loop keeps, so the canvas is repainted only when a light changed. */
const LIGHT_STEPS = 12;
/** Real ms between city-light updates (a fade is a few steps). */
const LIGHTS_MS = 160;

/** Every airport's lights: [lon, lat], glow radius, map point (the ops map's unrotated projection). */
function cityLights(): NonNullable<LiveShared['lights']> {
  const proj = projection(0);
  const list = AIRPORTS.map((a) => ({ a, q: proj([a.lon, a.lat]) })).filter((x) => x.q);
  return {
    ll: list.map((x) => [x.a.lon, x.a.lat] as [number, number]),
    pts: list.map((x) => [x.q![0], x.q![1]] as [number, number]),
    r: list.map((x) => lightR(x.a.pop)),
    lvl: new Int8Array(list.length),
    at: -Infinity,
  };
}

/** A soft warm glow (a radial gradient in the theme's light colours), drawn once per theme (data-theme on the root). */
let sprite: { key: string; theme: string; cv: HTMLCanvasElement } | null = null;
function lightSprite(): HTMLCanvasElement {
  // Reading the colours forces a style pass: only when the theme attribute has changed.
  const theme = document.documentElement.dataset.theme ?? '';
  if (sprite && sprite.theme === theme) return sprite.cv;
  const cs = getComputedStyle(document.documentElement);
  const core = cs.getPropertyValue('--map-light-core').trim() || '#fff1c9';
  const glow = cs.getPropertyValue('--map-light-glow').trim() || '#ffb547';
  const a = Number.parseFloat(cs.getPropertyValue('--map-light-a')) || 0.9;
  const key = `${core}|${glow}|${a}`;
  if (sprite?.key === key) { sprite.theme = theme; return sprite.cv; }
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  const rgba = (hex: string, al: number) => { const [r, g, b] = parseRgb(hex, [255, 200, 120]); return `rgba(${r},${g},${b},${al})`; };
  gr.addColorStop(0, rgba(core, a));
  gr.addColorStop(0.28, rgba(glow, a * 0.5));
  gr.addColorStop(1, rgba(glow, 0));
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  sprite = { key, theme, cv };
  return cv;
}

/** Paints the city lights at their levels (the WorldMap `glow` canvas: one paint item, no SVG nodes). */
export function paintCityLights(shared: LiveShared): GlowPaint {
  return (c, at, px) => {
    const L = (shared.lights ??= cityLights());
    const img = lightSprite();
    const W = c.canvas.width;
    const H = c.canvas.height;
    for (let i = 0; i < L.pts.length; i++) {
      const lv = L.lvl[i];
      if (lv <= 0) continue;
      const [x, y] = at(L.pts[i]);
      const r = L.r[i] * px;
      if (x < -r || y < -r || x > W + r || y > H + r) continue;
      c.globalAlpha = lv / LIGHT_STEPS;
      c.drawImage(img, x - r, y - r, 2 * r, 2 * r);
    }
    c.globalAlpha = 1;
  };
}

/** Fades each city's lights with its sun elevation, at most every LIGHTS_MS; repaints the canvas only on a change. */
function lightCities(shared: LiveShared, sun: [number, number], now: number, redraw: () => void, force: boolean) {
  const L = (shared.lights ??= cityLights());
  if (!force && now - L.at < LIGHTS_MS) return;
  L.at = now;
  let changed = force;
  for (let i = 0; i < L.ll.length; i++) {
    const [lon, lat] = L.ll[i];
    const lv = Math.round(lightAlpha(sunElevation(sun, lon, lat)) * LIGHT_STEPS);
    if (lv !== L.lvl[i]) {
      L.lvl[i] = lv;
      changed = true;
    }
  }
  if (changed) redraw();
}

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
        const color = l.color ?? 'var(--map-route)';
        return (
          <path
            key={l.id}
            d={d}
            className={l.current ? 'cur' : 'next'}
            style={{ stroke: color }}
            strokeOpacity={l.current ? 0.95 : Math.max(0.22, 0.42 - i * 0.06)}
            strokeWidth={l.current ? 2.2 : 1.4}
            strokeDasharray={l.dashed ? '5 5' : undefined}
          />
        );
      })}
    </g>
  );
});

// ---------- v0.9 slip crews (§W.4) ----------

/** The selected aircraft's slip crews' airline legs: deadhead grey dots at the selected weight; the way home fainter. */
export const SlipArcsLayer = memo(function SlipArcsLayer({ arcs, proj }: { arcs: SlipArc[]; proj: MapLayerCtx['proj'] }) {
  const path = useMemo(() => geoPath(proj), [proj]);
  if (!arcs.length) return null;
  const st = TYPE_STROKE.deadhead;
  return (
    <g className="ops-slip-arcs" pointerEvents="none">
      {arcs.map((l) => {
        const A = AIRPORT_BY_CODE[l.from];
        const B = AIRPORT_BY_CODE[l.to];
        const d = A && B ? path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] }) : null;
        return d ? <path key={l.id} d={d} className={l.dir} style={{ stroke: st.color }} strokeDasharray={st.dash} /> : null;
      })}
    </g>
  );
});

/** Crew-change marks: a small static disc with two arrows at the fuel stop (44 px hit), tap → the crew-change panel. */
export const SlipMarksLayer = memo(function SlipMarksLayer({ marks, proj, unit, selected }: { marks: SlipMark[]; proj: MapLayerCtx['proj']; unit: number; selected?: string }) {
  const pts = useMemo(() => marks.map((m) => {
    const a = AIRPORT_BY_CODE[m.at];
    return { m, q: a ? proj([a.lon, a.lat]) : null };
  }), [marks, proj]);
  if (!pts.length) return null;
  return (
    <g className="ops-slips">
      {pts.map(({ m, q }) => {
        if (!q) return null;
        const sel = selected === m.id;
        return (
          <g key={m.id} transform={`translate(${q[0]} ${q[1]})`} className={`ops-slip${sel ? ' sel' : ''}`} data-id={m.id}>
            <g className="mk" transform={`scale(${unit})`}>
              <g transform={`translate(${m.off[0]} ${m.off[1]})`}>
                <title>Crew change at {m.at}</title>
                <circle className="hit" r={HIT_R.touch} />
                {sel && <circle className="sel-ring" r={15} />}
                <circle className="disc" r={10} />
                <path className="glyph" d="M-5 -2.5H5M2.5 -5L5 -2.5L2.5 0M5 2.5H-5M-2.5 0L-5 2.5L-2.5 5" />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
});

// ---------- v0.11 diverted flights ----------

export interface DivMark { id: string; at: string; to0: string; airborne: boolean }

/** Diverted legs airborne or landed in the last 12 h (not yet flown on). Pure. */
export function divMarks(g: GameState): DivMark[] {
  const out: DivMark[] = [];
  for (const f of Object.values(g.flights)) {
    if (!f.div || f.to === f.div.to0 || f.status === 'cancelled') continue;
    const cont = f.contOf ? g.flights[f.contOf] : undefined;
    if (cont && cont.status !== 'scheduled') continue;
    if (f.status === 'done' && (f.ata ?? 0) < g.now - 12 * 60) continue;
    if (f.status === 'scheduled' && f.std > g.now + 6 * 60) continue;
    out.push({ id: f.id, at: f.to, to0: f.div.to0, airborne: f.status === 'enroute' });
  }
  return out;
}

/**
 * A diverted flight on the map: the planned destination ringed (dashed, amber) with its code, a dashed line from
 * the alternate the aircraft is going to (or sits at), and 'DIVERTED' by the alternate.
 */
export const DiversionLayer = memo(function DiversionLayer({ marks, proj, unit }: { marks: DivMark[]; proj: MapLayerCtx['proj']; unit: number }) {
  const path = useMemo(() => geoPath(proj), [proj]);
  if (!marks.length) return null;
  return (
    <g className="dv-marker" pointerEvents="none">
      {marks.map((m) => {
        const A = AIRPORT_BY_CODE[m.at];
        const B = AIRPORT_BY_CODE[m.to0];
        if (!A || !B) return null;
        const d = path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] });
        const pa = proj([A.lon, A.lat]);
        const pb = proj([B.lon, B.lat]);
        return (
          <g key={m.id}>
            {d && <path className="dv-line" d={d} style={{ strokeWidth: 1.2 * unit }} />}
            {pb && (
              <g transform={`translate(${pb[0]} ${pb[1]}) scale(${unit})`}>
                <circle className="dv-ring" r={11} />
                <text x={14} y={-8}>planned {m.to0}</text>
              </g>
            )}
            {pa && (
              <g transform={`translate(${pa[0]} ${pa[1]}) scale(${unit})`}>
                <text x={12} y={18}>DIVERTED {m.at}</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});

// ---------- offer pins ----------

/** Pin offset in screen px: left of the dot at airports we already mark (code above, parked aircraft right). */
export const pinOffset = (marked: boolean): [number, number] => (marked ? [-20, 0] : [0, 0]);

/** Pin code label: font px (round 4: 12 on touch, the brief's minimum, as the airport labels) and baseline below the diamond. */
const pinFs = (touch: boolean) => (touch ? 12 : 10.5);
const PIN_LABEL_Y = 21;

/**
 * Offer diamonds; pins away from our own airports carry their airport code (dropped where codes
 * would overlap). Drawn in screen px inside a `.mk` group that WorldMap counter-scales live.
 */
export const PinsLayer = memo(function PinsLayer({ pins, marked, proj, unit, selected, touch = false }: {
  pins: PinGroup[]; marked: Set<string>; proj: MapLayerCtx['proj']; unit: number; selected?: string; touch?: boolean;
}) {
  const PIN_FS = pinFs(touch);
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
  }, [pts, unit, PIN_FS]);
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
                {(labels.has(p.code) || sel) && <text className="code" y={PIN_LABEL_Y} style={{ fontSize: PIN_FS }}>{p.code}</text>}
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
});

// ---------- v0.12 weather and closures ----------

/** Weather mark offset from its airport (screen px): below-left, clear of the code above and our stands on the right. */
export const WX_OFF: [number, number] = [-15, 14];
const WX_ICON: Record<WxKind, LucideIcon> = { storm: CloudLightning, cloud: CloudFog, curfew: Moon, closed: Ban };

/** A soft halo on a closed or limited airport and a small mark (storm, low cloud, curfew moon, closed). Static. */
export const WeatherLayer = memo(function WeatherLayer({ marks, proj, unit }: { marks: WxMark[]; proj: MapLayerCtx['proj']; unit: number }) {
  if (!marks.length) return null;
  return (
    <g className="ops-wx">
      <defs>
        {(['storm', 'cloud', 'curfew', 'closed'] as WxKind[]).map((k) => (
          <radialGradient key={k} id={`bh-wx-${k}`} className={k}>
            <stop offset="0" className="h0" />
            <stop offset="0.55" className="h1" />
            <stop offset="1" className="h2" />
          </radialGradient>
        ))}
      </defs>
      {marks.map((m) => {
        const a = AIRPORT_BY_CODE[m.at];
        const q = a && proj([a.lon, a.lat]);
        if (!q) return null;
        const Icon = WX_ICON[m.kind];
        return (
          <g key={m.at} transform={`translate(${q[0]} ${q[1]})`} className={`wx ${m.kind}`} data-at={m.at}>
            <g className="mk" transform={`scale(${unit})`}>
              <title>{`${m.at}: ${m.title}`}</title>
              <circle className="halo" r={28} fill={`url(#bh-wx-${m.kind})`} />
              <g transform={`translate(${WX_OFF[0]} ${WX_OFF[1]})`}>
                <circle className="hit" r={HIT_R.touch * 0.8} />
                <circle className="disc" r={9.5} />
                <Icon x={-6.5} y={-6.5} width={13} height={13} strokeWidth={2.2} className="glyph" aria-hidden />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
});

// ---------- aircraft ----------

/**
 * v0.12 silhouette inks for a livery: the tail colour, a thin contrasting outline that reads on both map themes, the
 * engines and the upper deck a step lighter (dark paint) or darker (light paint). A plain airframe is white.
 */
export function silInk(l: Livery): { fill: string; edge: string; eng: string; deck: string } {
  return inkOf(l.plain ? '#eef2f8' : l.primary);
}

/** v0.12 silhouette inks for a fill colour (the map paints each type in its family's colour, `silColour`). */
export function inkOf(fill: string): { fill: string; edge: string; eng: string; deck: string } {
  const dark = luminance(fill) < 0.32;
  return { fill, edge: dark ? '#f4f7ff' : '#141c2c', eng: mix(fill, dark ? '#ffffff' : '#000000', dark ? 0.5 : 0.4), deck: mix(fill, dark ? '#ffffff' : '#000000', dark ? 0.3 : 0.16) };
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

/**
 * Our airborne leg's path: v0.12 the part flown solid behind the aircraft, the part to go dashed ahead. `pts` samples
 * the track (map units) at even times from off- to on-blocks, so the split falls exactly where the aircraft is. The
 * track is cut into static chunks (solid behind, dashed ahead); only the chunk under the aircraft is redrawn as it
 * moves, as two short paths, so a frame never repaints a whole ocean-wide line.
 */
interface OwnPath { chunks: SVGPathElement[]; done: SVGPathElement; ahead: SVGPathElement; acId: string; type: FlightType; key: string; pts: [number, number][]; ci: number; at: [number, number] | null; atK: number }

/** Track samples per static chunk. */
const CHUNK = 6;

/** All of an own path's elements. */
const ownEls = (op: OwnPath) => [...op.chunks, op.done, op.ahead];

/** (Re)builds a leg's chunks from its samples (after a new track or projection); the split is redrawn next. */
function buildChunks(op: OwnPath, root: SVGGElement) {
  for (const c of op.chunks) c.remove();
  op.chunks = [];
  const n = op.pts.length - 1;
  for (let j = 0; j * CHUNK < n; j++) {
    const el = svgEl('path', { d: polyD(op.pts.slice(j * CHUNK, Math.min(n, (j + 1) * CHUNK) + 1)) });
    root.insertBefore(el, op.done);
    op.chunks.push(el);
  }
  op.ci = -1;
  op.at = null;
}

/** Redraws a leg's split at the aircraft (map point q, `progress` along the leg). */
function drawSplit(op: OwnPath, q: [number, number], progress: number, k: number) {
  const n = op.pts.length - 1;
  if (n <= 0) return;
  op.at = q;
  op.atK = k;
  const i = Math.max(0, Math.min(n - 1, Math.floor(progress * n)));
  const ci = Math.floor(i / CHUNK);
  if (ci !== op.ci) {
    // Chunks behind solid, ahead dashed; the one under the aircraft is drawn by the two split paths.
    op.ci = ci;
    op.chunks.forEach((c, j) => {
      const part = j < ci ? 'done' : j > ci ? 'ahead' : '';
      if (part) { stylePath(c, op.type, part); c.style.display = ''; }
      else c.style.display = 'none';
    });
  }
  op.done.setAttribute('d', polyD([...op.pts.slice(ci * CHUNK, i + 1), q]));
  op.ahead.setAttribute('d', polyD([q, ...op.pts.slice(i + 1, Math.min(n, (ci + 1) * CHUNK) + 1)]));
}

/** v0.12 screen px an aircraft moves before its flown / to-go split is redrawn (well inside its icon). */
const PATH_STEP = 4;
/**
 * At most this many splits are redrawn per frame (the ones furthest behind, on screen; the selected aircraft's every
 * time): a path's 'd' is a style change, and 26 of them a frame cost more than the whole map. Off-screen ones wait.
 */
const SPLITS_PER_FRAME = 2;

/** v0.12 dash of the part still to fly (screen px): the operating leg's solid line turns dashed ahead. */
const AHEAD_DASH: Record<FlightType, string> = { operating: '6 5', positioning: TYPE_STROKE.positioning.dash, ferry: TYPE_STROKE.ferry.dash, deadhead: TYPE_STROKE.deadhead.dash };

/** Track samples of a leg (map units), N + 1 at even times from off- to on-blocks (diverted legs turn where they turned). */
function trackPts(f: Flight, proj: MapLayerCtx['proj']): [number, number][] {
  const { off, on } = flightTimes(f);
  const A = AIRPORT_BY_CODE[f.from];
  const B = AIRPORT_BY_CODE[f.to];
  if (!A || !B) return [];
  const km = Math.hypot(A.lat - B.lat, (A.lon - B.lon) * Math.cos(((A.lat + B.lat) / 2) * (Math.PI / 180))) * 111;
  const n = Math.max(12, Math.min(96, Math.round(km / 110)));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const q = proj(f.div ? divPos(f, off + ((on - off) * i) / n) : interpolateGC(A.lon, A.lat, B.lon, B.lat, i / n));
    if (q) out.push([q[0], q[1]]);
  }
  return out;
}

/** Polyline 'd' through pts (a new subpath where the track wraps over the map's edge). */
function polyD(pts: [number, number][]): string {
  let d = '';
  let px = NaN;
  for (const [x, y] of pts) {
    d += `${d && Math.abs(x - px) < MAP_W / 2 ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    px = x;
  }
  return d;
}

/** Contrails off: the Map animations setting, or the system's reduced motion. */
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const REG_FS = isTouch() ? 12 : 11; // .ops-ac .reg font size
    const els = new Map<string, { el: SVGGElement; glyph: SVGGElement; crowd: boolean; reg: RegSlot; regW: number; fit: number; trail: boolean }>();
    for (const el of Array.from(root.querySelectorAll(':scope > .ops-ac')) as SVGGElement[]) {
      const id = el.dataset.id!;
      const reg = el.querySelector('.reg')?.textContent ?? '';
      els.set(id, { el, glyph: el.querySelector('.glyph') as SVGGElement, crowd: false, reg: 0, regW: reg.length * REG_FS * 0.62 + 2, fit: Number(el.dataset.fit) || 1, trail: false });
    }
    /** v0.12 contrail windows per leg (game minutes when it is high enough), by flight id and its times. */
    const trailWin = new Map<string, { key: string; w: [number, number] | null }>();
    let calm = reducedMotion();
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMq = () => { calm = !!mq?.matches; };
    mq?.addEventListener?.('change', onMq);
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
    let lightTheme = '';
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
    let underKey = '';
    const TAG_FS = isTouch() ? 10.5 : 9.5; // .ops-ac .op-delivery-tag font size
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
        for (const p of own.values()) for (const el of ownEls(p)) el.remove();
        own.clear();
        for (const [id, x] of cms) dropCm(id, x);
        ownRoot = shared.pathsOwn;
        cmPathRoot = shared.pathsCm;
        cmRoot = shared.cmRoot;
        projUsed = proj;
        gen = geoPath(proj);
        selKey = '';
      }
      // Night: slid sideways on the compositor as the sun moves; placed again (one backdrop repaint) when the slide
      // nears the layer's margin (also after a zoom: the margin is in screen px), repainted when the declination drifts.
      // v0.12 Map animations off (or the system's reduced motion): the night steps every quarter hour of game time
      // instead of gliding, and no contrails.
      const anim = store.settings.mapAnimations && !calm;
      const tn = anim ? t : Math.floor(t / 15) * 15;
      const sun = tn === lastSunT && lastSun ? lastSun : sunPoint(tn);
      lastSunT = tn;
      lastSun = sun;
      const s0 = shared.nightSun;
      if (shared.night) {
        if (!s0 || !(Math.abs(sun[1] - shared.nightDec) < NIGHT_DEC_STEP)) buildNight(shared, tn, c.backShift);
        else if (Math.abs(c.backShift(nightShift(s0, sun))) > c.margin / 2) buildNight(shared, tn, c.backShift);
      }
      // City lights (their own canvas layer); a theme change repaints them in the new colours.
      const th = document.documentElement.dataset.theme ?? '';
      lightCities(shared, sun, now, c.redrawGlow, th !== lightTheme);
      lightTheme = th;
      if (anim !== root.classList.contains('trails')) root.classList.toggle('trails', anim);
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
        const e = els.get(id);
        // React re-renders reset the className: put the loop's own classes back.
        if (fresh && e) {
          e.el.classList.toggle('crowd', e.crowd);
          e.el.classList.toggle('reg-up', e.reg === 1);
          e.el.classList.toggle('reg-off', e.reg === 2);
        }
        if (!ac || !AIRPORT_BY_CODE[ac.at]) continue;
        if (!onMap(ac)) {
          // Not handed over yet (being built or prepared at the seller's): not on the map, not tappable.
          if (e && e.el.dataset.phase !== 'hidden') e.el.dataset.phase = 'hidden';
          shared.ac.delete(id);
          glide.delete(id);
          continue;
        }
        const live = aircraftLive(game, ac, t);
        if (live.phase !== 'airborne') parked.set(live.at!, (parked.get(live.at!) ?? 0) + 1);
        lives.push(live);
      }
      const slot = new Map<string, number>();
      // Labels of our parked aircraft (screen px), with the airport each stands at.
      const ownLabels: (LabelBox & { at: string })[] = [];
      // Parked glyphs (stand, badges) with their labels: airline-leg flight numbers keep off them.
      const parkedBoxes: LabelBox[] = [];
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
        // v0.12 parked, a silhouette fits its stand (wide-bodies a little smaller than in the air).
        e.glyph.setAttribute('transform', `rotate(${s.ang.toFixed(1)})${live.phase === 'airborne' || e.fit >= 1 ? '' : ` scale(${e.fit.toFixed(3)})`}`);
        // Contrails only while high enough (climbing through 26,000 ft to the top of descent).
        let tr = false;
        if (live.phase === 'airborne' && live.flight) {
          const fl = live.flight;
          const tk = `${fl.atd ?? fl.std}|${fl.ata ?? fl.eta ?? fl.sta}|${fl.to}`;
          let w = trailWin.get(fl.id);
          if (!w || w.key !== tk) trailWin.set(fl.id, (w = { key: tk, w: contrailWindow(fl, live.aircraft.typeId) }));
          tr = !!w.w && t >= w.w[0] && t < w.w[1];
        }
        if (tr !== e.trail) e.el.classList.toggle('trail-on', (e.trail = tr));
        if (e.el.dataset.phase !== live.phase) e.el.dataset.phase = live.phase;
        if (e.crowd !== crowd) e.el.classList.toggle('crowd', (e.crowd = crowd));
        // Airborne, the reg moves above the icon (or fades) while under it would cover an airport dot or code.
        let reg: RegSlot = 0;
        if (live.phase === 'airborne') {
          const ix = p[0] / u + s.ox;
          const iy = p[1] / u + s.oy;
          const obs: LabelBox[] = [];
          for (const ap of shared.aps) {
            const ax = ap[0] / u;
            const ay = ap[1] / u;
            if (Math.abs(ax - ix) > 70 || Math.abs(ay - iy) > 60) continue;
            obs.push({ id: '', x: ax, y: ay, w: 10, h: 10 }, { id: '', x: ax, y: ay - 15, w: 28, h: 15 });
          }
          if (obs.length) reg = regSlot(ix, iy, e.regW, REG_FS, obs, e.reg);
        }
        if (reg !== e.reg) {
          e.el.classList.toggle('reg-up', reg === 1);
          e.el.classList.toggle('reg-off', reg === 2);
          e.reg = reg;
        }
        shared.ac.set(id, [p[0] + s.ox * u, p[1] + s.oy * u]);
        if (live.phase !== 'airborne') {
          const ix = p[0] / u + s.ox;
          const iy = p[1] / u + s.oy;
          // DELIVERY (v0.7) or LEASED (v0.8) under the icon, the reg below it.
          const dlv = e.el.classList.contains('dlv') || e.el.classList.contains('lsd');
          parkedBoxes.push({ id, x: ix + 2, y: iy - 3, w: 36, h: 34 });
          if (selRef.current === id || (labels && !crowd)) {
            const by = dlv ? 38 : 25;
            ownLabels.push({ id, at: live.at!, x: ix, y: iy + by - REG_FS * 0.35, w: e.regW, h: REG_FS });
          }
          if (dlv) ownLabels.push({ id, at: live.at!, x: ix, y: iy + 26 - TAG_FS * 0.35, w: 8 * TAG_FS * 0.68 + 2, h: TAG_FS });
        }
      }
      // Our parked aircraft's reg and DELIVERY tag win over a neighbouring airport's code: that code fades out
      // (the airport they stand at, and a selected one, keep theirs). Re-checked when labels move, zoom or re-render.
      const uk = `${k.toPrecision(5)}|${ownLabels.map((b) => `${b.id}${b.x.toFixed(0)},${b.y.toFixed(0)}`).join(';')}`;
      if (fresh || uk !== underKey) {
        underKey = uk;
        const svg = root.ownerSVGElement;
        for (const ap of svg ? (Array.from(svg.querySelectorAll('.airports .ap[data-code]')) as SVGGElement[]) : []) {
          const code = ap.dataset.code!;
          const text = ap.querySelector('.ap-label');
          const A = AIRPORT_BY_CODE[code];
          const q = text && A && !ap.classList.contains('sel') ? proj([A.lon, A.lat]) : null;
          let under = false;
          if (q && text && ownLabels.length) {
            const fs = Number(text.getAttribute('font-size')) || 11;
            const box: LabelBox = { id: code, x: q[0] / u, y: q[1] / u + (Number(text.getAttribute('y')) || 0) - fs * 0.35, w: code.length * fs * 0.62 + 2, h: fs };
            under = ownLabels.some((b) => b.at !== code && boxOverlap(b, box, 1) > 0);
          }
          if (under !== ap.hasAttribute('data-under')) ap.toggleAttribute('data-under', under);
        }
      }
      for (const b of ownLabels) parkedBoxes.push(b);
      // Our airborne legs: v0.12 flown solid behind the aircraft, dashed ahead (types refreshed with each React render).
      const seen = new Set<string>();
      const view = c.onScreen();
      const pad = 60 * u;
      const splits: { op: OwnPath; q: [number, number]; p: number; w: number }[] = [];
      for (const live of lives) {
        const f = live.phase === 'airborne' ? live.flight : undefined;
        const e = els.get(live.aircraft.id);
        if (!f) {
          if (e && e.el.dataset.type) e.el.dataset.type = '';
          continue;
        }
        seen.add(f.id);
        let op = own.get(f.id);
        const key = `${f.atd ?? f.std}|${f.ata ?? f.eta ?? f.sta}|${f.from}|${f.to}`;
        if (!op && ownRoot) {
          const type = flightType(game, f);
          const done = svgEl('path', {}, ownRoot);
          const ahead = svgEl('path', {}, ownRoot);
          stylePath(done, type, 'done');
          stylePath(ahead, type, 'ahead');
          own.set(f.id, (op = { chunks: [], done, ahead, acId: live.aircraft.id, type, key, pts: trackPts(f, proj), at: null, atK: 0, ci: -1 }));
          buildChunks(op, ownRoot);
          selKey = '';
        } else if (op && fresh) {
          const type = flightType(game, f);
          if (type !== op.type) { op.type = type; stylePath(op.done, type, 'done'); stylePath(op.ahead, type, 'ahead'); op.ci = -1; op.at = null; }
          selKey = '';
        }
        if (op && op.key !== key && ownRoot) { op.key = key; op.pts = trackPts(f, proj); buildChunks(op, ownRoot); selKey = ''; }
        if (op) {
          // How far (screen px) the aircraft is from where its split was last drawn; redrawn below, a few per frame.
          const q = shared.ac.get(live.aircraft.id);
          if (q) {
            const far = !op.at || op.atK !== k ? Infinity : Math.hypot(q[0] - op.at[0], q[1] - op.at[1]) / u;
            const sel = op.acId === selRef.current;
            const vis = q[0] > view[0] - pad && q[0] < view[2] + pad && q[1] > view[1] - pad && q[1] < view[3] + pad;
            if (far >= PATH_STEP && (vis || sel || !op.at)) splits.push({ op, q, p: live.progress, w: sel || !op.at ? Infinity : far });
          }
        }
        if (e && op && e.el.dataset.type !== op.type) e.el.dataset.type = op.type;
      }
      splits.sort((a, b) => b.w - a.w);
      for (let i = 0; i < splits.length && (i < SPLITS_PER_FRAME || splits[i].w === Infinity); i++) drawSplit(splits[i].op, splits[i].q, splits[i].p, k);
      for (const [id, op] of own) if (!seen.has(id)) { for (const el of ownEls(op)) el.remove(); own.delete(id); }
      for (const id of trailWin.keys()) if (!seen.has(id)) trailWin.delete(id);
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
            // A chartered private jet (leg.jet) flies like an airline leg, with the business-jet glyph and its type as the label.
            const jet = !!cf.leg.jet;
            const el = svgEl('g', { class: jet ? 'ops-cmf jet' : 'ops-cmf', 'data-id': cf.id }, cmRoot);
            svgEl('circle', { class: 'hit', r: HIT_R.touch }, el);
            svgEl('circle', { class: 'sel-ring', r: 14 }, el);
            const glyph = svgEl('g', { class: 'glyph' }, el);
            svgEl('path', { d: jet ? JET_PATH : PLANE_PATH, transform: `scale(${(jet ? JET_GLYPH_PX : CM_GLYPH_PX) / 24}) translate(-12 -12)` }, glyph);
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
              const ax = ap[0] / u;
              const ay = ap[1] / u;
              if (ax < x0 || ax > x1 || ay < y0 || ay > y1) continue;
              obs.push({ id: '', x: ax, y: ay, w: 10, h: 10 });
              // Any of them may show its code (all do once zoomed in a little).
              codes.push({ id: '', x: ax, y: ay - 15, w: 28, h: 15 });
            }
            x.side = legLabelSide(track, w, NO_FS, [...obs, ...codes, ...parkedBoxes], x.pref);
            x.hide = trackCovered(track, x.side, w, NO_FS, codes);
          }
          const [cx, cy] = trackLabelAt(ang, x.side, w, NO_FS);
          // Fades over an airport code on this stretch, or while passing our parked aircraft (e.g. leaving our base).
          let hidden = !!x.hide[Math.round(pr * 32)];
          if (!hidden && parkedBoxes.length) {
            const nb: LabelBox = { id: '', x: p[0] / u + cx, y: p[1] / u + cy, w, h: NO_FS };
            hidden = parkedBoxes.some((o) => boxOverlap(nb, o, 1) > 6);
          }
          if (hidden !== x.hidden) x.no.classList.toggle('off', (x.hidden = hidden));
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
        for (const op of own.values()) for (const el of ownEls(op)) el.classList.toggle('sel', op.acId === selRef.current);
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
    return () => { cancelAnimationFrame(raf); mq?.removeEventListener?.('change', onMq); };
  }, [idsKey, shared]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <g ref={ref} className="ops-aircraft">
      <defs>
        {/* v0.12 contrail: bright at the engines, gone 1.6 lengths behind. */}
        <linearGradient id="bh-trail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="t0" />
          <stop offset="1" className="t1" />
        </linearGradient>
      </defs>
      {ids.map((id) => {
        const ac = g.fleet[id];
        // v0.12 the family's colour (A320 blue, 777 orange…), so the type reads at a glance; the legend lists them.
        const ink = inkOf(silColour(ac.typeId));
        // v0.12 a top-down silhouette of the type (engines where they really are), sized by the real aircraft.
        const sil = silhouette(ac.typeId);
        const half = Math.max(sil.hl, sil.hs);
        const ring = Math.max(16, half + 4);
        const vars = { '--ry': `${Math.max(0, half - 11).toFixed(1)}px`, '--ru': `${(-42 - Math.max(0, half - 11) * 2).toFixed(1)}px`, '--ty': `${(-Math.max(0, half - 11)).toFixed(1)}px` } as React.CSSProperties;
        return (
          <g key={id} data-id={id} data-phase="parked" data-fit={parkedFit(silSpec(ac.typeId)).toFixed(3)} style={vars} className={`ops-ac${selected === id ? ' sel' : ''}${deliveryTag(ac) ? ' dlv' : leasedOut(ac) ? ' lsd' : ''}`}>
            <circle className="hit" r={Math.max(HIT_R.touch, half)} />
            <path className="hangar" d="M-15 11V-1Q0 -17 15 -1V11Z" />
            <circle className="sel-ring" r={ring} />
            <circle className="aog-ring" r={14} />
            <g className="glyph">
              <path className="trail" d={sil.trails} fill="url(#bh-trail)" />
              {/* v0.12 engines go under the wing (as on Flightradar24): only the intake shows ahead of the leading edge. */}
              <path className="eng" d={sil.engines} fill={ink.eng} stroke={ink.edge} strokeWidth={1.2} strokeLinejoin="round" paintOrder="stroke" />
              <path className="sil" d={sil.body} fill={ink.fill} stroke={ink.edge} strokeWidth={2} strokeLinejoin="round" paintOrder="stroke" />
              {sil.deck && <path className="deck" d={sil.deck} fill={ink.deck} />}
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
            <text className="op-delivery-tag" y={-16}>DELIVERY</text>
            <text className="op-leased-tag" y={-16}>LEASED</text>
          </g>
        );
      })}
    </g>
  );
}
