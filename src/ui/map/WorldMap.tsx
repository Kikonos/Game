import { geoInterpolate, geoPath, type GeoProjection } from 'd3-geo';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { REGIONS } from '../../data/regions';
import { PLANE_PATH } from '../components/Logo';
import { useTheme } from '../store';
import { paleOnLight } from '../theme';
import { isTouch, useTouch } from '../useMedia';
import { MAP_H, MAP_W, basePaths, projection } from './mapData';
import { type LabelBox, placeLabels } from './mapLogic';

export interface MapRoute {
  id: string;
  from: string;
  to: string;
  /** 0..1 thickness/intensity. */
  weight: number;
  color?: string;
  dashed?: boolean;
  planes?: number;
  highlight?: boolean;
}

export interface MapAirport {
  code: string;
  state: 'hub' | 'served' | 'open' | 'locked' | 'dim';
  label?: boolean;
}

/** Context for custom SVG layers drawn in map units inside the zoomed world group. */
export interface MapLayerCtx {
  proj: GeoProjection;
  /** Map units per screen pixel at the committed zoom (size markers as px × unit). */
  unit: number;
  k: number;
  /** Screen px per map unit at zoom 1 (container scale). */
  px: number;
  /** Zoom on screen right now (ahead of k during gestures); cheap, call per frame. */
  liveK: () => number;
  /** Zoom of the last fit (initial view or Reset); k / fitK is the zoom relative to it. */
  fitK: number;
  /** Moves the `backdrop` layer sideways by dx map units without repainting it (compositor only); returns the shift in screen px. */
  backShift: (dx: number) => number;
  /** Screen px of spare layer around the view: rebuild the backdrop before |backShift| passes margin / 2. */
  margin: number;
  /** v0.12 repaints the `glow` canvas (call when what it draws has changed). */
  redrawGlow: () => void;
  /** v0.12 the part of the map on screen right now (map units: x0, y0, x1, y1); cheap, call per frame. */
  onScreen: () => [number, number, number, number];
}

/** v0.12 the `glow` layer's painter: draws on a canvas; `at` gives a map point's canvas px, `px` canvas px per screen px. */
export type GlowPaint = (c: CanvasRenderingContext2D, at: (p: [number, number]) => [number, number], px: number) => void;

/**
 * What a focus keeps clear of the overlays: one point, or several (map units) each grown by `box`
 * (screen px to the left, top, right, bottom: labels); the first wins when they don't all fit.
 */
export type FocusAt = [number, number] | { pts: [number, number][]; box?: [number, number, number, number] };

/** Map transform: world point p is drawn at p × k + (x, y) in viewBox units. */
export interface View {
  k: number;
  x: number;
  y: number;
}

/** Screen-pixel padding [top, right, bottom, left] kept clear when fitting (e.g. for overlays). */
export type Pad = [number, number, number, number];

interface Props {
  rotate?: number;
  routes: MapRoute[];
  airports: MapAirport[];
  fit?: string[];
  fitPad?: Pad;
  interactive?: boolean;
  animate?: boolean;
  accent?: string;
  selected?: string | null;
  onSelect?: (code: string | null) => void;
  /** Makes route lines tappable; called with null on a tap on empty map. */
  onSelectRoute?: (id: string | null) => void;
  onHover?: (code: string | null) => void;
  tooltip?: (a: Airport) => ReactNode;
  regionLabels?: { id: string; locked: boolean }[];
  className?: string;
  /** Changes when the network changes, so planes are rebuilt. */
  planesKey?: string;
  controls?: boolean;
  /** Screen area covered by overlays: a newly selected airport under it is panned into view. */
  revealPad?: Pad | (() => Pad);
  /** Extra SVG layers above the airports (ops map: aircraft, terminator, pins). */
  layers?: (ctx: MapLayerCtx) => ReactNode;
  /** v0.8: static shapes painted with the land in its composited layer (ops map: world-event zones). Repainted only
   * when the land is (gesture end, out of margin) or when this content changes: keep it stable during gestures. */
  ground?: (ctx: MapLayerCtx) => ReactNode;
  /** SVG layers between the land and the airports (ops map: arcs). */
  underlay?: (ctx: MapLayerCtx) => ReactNode;
  /** A big, slow layer right above the land in its own composited layer (ops map: night), shifted with ctx.backShift. */
  backdrop?: (ctx: MapLayerCtx) => ReactNode;
  /**
   * v0.12 a canvas layer of its own above the backdrop (ops map: city lights): moved with the land on the compositor,
   * repainted only when the land is (gesture end, out of margin) or on ctx.redrawGlow(). One paint item, no SVG nodes.
   */
  glow?: GlowPaint;
  /** Called with the tapped map point (map units) and map units per screen px before airports are hit-tested; true consumes the tap. */
  onTap?: (m: [number, number], unit: number, finger: boolean) => boolean;
  /** Fit list read only when fitting (first view, Reset): data changes never re-fit the map. Overrides `fit`. */
  fitFn?: () => string[];
  /** Airport kept near the middle of a fit (read when fitting). */
  fitCentre?: () => string | undefined;
  /** When `key` changes, pans the map point `at()` (map units) out from under `revealPad`. Replaces the selected-airport reveal. */
  focus?: { key: string; at: () => FocusAt | null } | null;
  /** Keeps the view across remounts (tab switches): read on mount, written on every commit. */
  memo?: { view: View | null };
  /**
   * v0.12 spotter mode: keeps the map point `at()` (map units) in the middle of the area clear of `pad`, easing after
   * it every frame (no React render). A new `key` flies there first, zoomed in to at least `zoom` (map zoom k). A pan
   * or pinch by the player pauses it for a few seconds. Reduced motion: it jumps only when the point nears an edge.
   */
  follow?: { key: string; at: () => [number, number] | null; pad: Pad; zoom?: number } | null;
}

/** Container geometry: the SVG uses "slice" scaling (s screen px per map unit at zoom 1, offset ox/oy). */
interface Geo { w: number; h: number; s: number; ox: number; oy: number; left: number; top: number }

/**
 * The land (59k points) and the backdrop sit in their own composited layers, oversized by this
 * margin on every side: gestures move them with a CSS transform (no repaint) and the SVG transform
 * is only rewritten when a gesture ends or runs out of margin. Only the light overlay repaints per frame.
 */
const marginOf = (g: { w: number; h: number }) => Math.round(Math.max(g.w, g.h) * 0.3);
/** The ocean as a background (static under the moving layers); matches the old SVG gradient. */
const OCEAN = 'radial-gradient(75% 75% at 50% 40%, var(--map-ocean-0) 0%, var(--map-ocean-1) 100%)';

const K_MAX = 16;
const MAX_PLANES = 60;
/** Touch devices get a lighter animation budget (fewer planes, 30 fps). */
const MAX_PLANES_TOUCH = 44;
/** Hit radii in screen px: generous for fingers, tight for a mouse. */
const HIT_AP = { touch: 26, mouse: 12 };
const HIT_ROUTE = { touch: 16, mouse: 7 };

const BaseLayers = memo(function BaseLayers({ rotate }: { rotate: number }) {
  const p = basePaths(rotate);
  return (
    <g className="map-base">
      <defs>
        <linearGradient id="land-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--map-land-0)' }} />
          <stop offset="1" style={{ stopColor: 'var(--map-land-1)' }} />
        </linearGradient>
      </defs>
      <path d={p.graticule} fill="none" style={{ stroke: 'var(--map-grid)' }} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      <path d={p.land} fill="url(#land-grad)" style={{ stroke: 'var(--map-coast)' }} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
      <path d={p.borders} fill="none" style={{ stroke: 'var(--map-border)' }} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </g>
  );
});

function geoOf(w: number, h: number, left = 0, top = 0): Geo {
  const s = Math.max(w / MAP_W, h / MAP_H) || 0.6;
  return { w, h, s, ox: (w - MAP_W * s) / 2, oy: (h - MAP_H * s) / 2, left, top };
}

/** Keeps the map covering the visible part of the viewBox (which "slice" may crop on one axis). */
function clampView(v: View, geo?: Geo): View {
  const k = Math.max(1, Math.min(K_MAX, v.k));
  const x0 = geo ? -geo.ox / geo.s : 0;
  const x1 = geo ? (geo.w - geo.ox) / geo.s : MAP_W;
  const y0 = geo ? -geo.oy / geo.s : 0;
  const y1 = geo ? (geo.h - geo.oy) / geo.s : MAP_H;
  const minX = x1 - MAP_W * k;
  const minY = y1 - MAP_H * k;
  return {
    k,
    x: minX > x0 ? (minX + x0) / 2 : Math.min(x0, Math.max(minX, v.x)),
    y: minY > y0 ? (minY + y0) / 2 : Math.min(y0, Math.max(minY, v.y)),
  };
}

/** Widens [lo, hi] so c sits at least `f` of the span in from either end. */
function keepIn(lo: number, hi: number, c: number, f: number): [number, number] {
  if (c - lo < f * (hi - lo)) lo = c - (f * (hi - c)) / (1 - f);
  if (hi - c < f * (hi - lo)) hi = c + (f * (c - lo)) / (1 - f);
  return [lo, hi];
}

function fitView(rotate: number, codes: string[], geo: Geo, pad: Pad = [0, 0, 0, 0], centre?: string): View {
  const proj = projection(rotate);
  const pts = codes.map((c) => AIRPORT_BY_CODE[c]).filter(Boolean).map((a) => proj([a.lon, a.lat])!);
  if (pts.length === 0) return clampView({ k: 1, x: 0, y: 0 }, geo);
  let x0 = Math.min(...pts.map((p) => p[0]));
  let x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1]));
  let y1 = Math.max(...pts.map((p) => p[1]));
  // Keep the centre airport (home base) well inside the frame, not on its edge.
  const cA = centre ? AIRPORT_BY_CODE[centre] : undefined;
  const cP = cA && proj([cA.lon, cA.lat]);
  if (cP) {
    [x0, x1] = keepIn(Math.min(x0, cP[0]), Math.max(x1, cP[0]), cP[0], 0.3);
    [y0, y1] = keepIn(Math.min(y0, cP[1]), Math.max(y1, cP[1]), cP[1], 0.3);
  }
  const minSpan = 140;
  if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
  if (y1 - y0 < minSpan * 0.6) { const c = (y0 + y1) / 2; y0 = c - minSpan * 0.3; y1 = c + minSpan * 0.3; }
  const padX = (x1 - x0) * 0.18;
  const padY = (y1 - y0) * 0.22;
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const { w, h, s } = geo;
  const visW = Math.max(40, w - pad[1] - pad[3]) / s;
  const visH = Math.max(40, h - pad[0] - pad[2]) / s;
  const k = Math.max(1, Math.min(14, Math.min(visW / (x1 - x0), visH / (y1 - y0))));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const tx = MAP_W / 2 + (pad[3] - pad[1]) / 2 / s;
  const ty = MAP_H / 2 + (pad[0] - pad[2]) / 2 / s;
  return clampView({ k, x: tx - cx * k, y: ty - cy * k }, geo);
}

const sameView = (a: View, b: View) => a.k === b.k && a.x === b.x && a.y === b.y;

type ApEl = MapAirport & { a: Airport; x: number; y: number };

const RoutesLayer = memo(function RoutesLayer({ items, accent }: { items: { r: MapRoute; d: string }[]; accent: string }) {
  return (
    <g className="routes">
      {items.map(({ r, d }) => {
        const color = r.color ?? accent;
        return (
          <g key={r.id}>
            {r.highlight && <path d={d} fill="none" style={{ stroke: color }} strokeOpacity={0.25} strokeWidth={8} vectorEffect="non-scaling-stroke" />}
            <path
              d={d}
              fill="none"
              style={{ stroke: color }}
              strokeOpacity={r.highlight ? 1 : 0.25 + 0.6 * r.weight}
              strokeWidth={0.8 + r.weight * 2.4 + (r.highlight ? 1 : 0)}
              strokeDasharray={r.dashed ? '4 4' : undefined}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </g>
  );
});

/** Label priority: selected, hovered, hub, flagged (aircraft / legs), the rest. */
const labelRank = (ap: ApEl, selected?: string | null, hover?: string | null) =>
  ap.code === selected ? 0 : ap.code === hover ? 1 : ap.state === 'hub' ? 2 : ap.label ? 3 : 4;

/**
 * Airport dots and codes. Markers are drawn in screen px inside a `.mk` group scaled by `unit`
 * (map units per px), which WorldMap rewrites live during gestures so they never pulse with the zoom.
 * Codes that would overlap a higher-priority code are dropped (greedy, screen space).
 */
const AirportsLayer = memo(function AirportsLayer({ els, unit, selected, hover, accent, crowded, showAll, touch }: {
  els: ApEl[]; unit: number; selected?: string | null; hover?: string | null; accent: string; crowded: boolean; showAll: boolean; touch: boolean;
}) {
  const geom = (ap: ApEl) => {
    const big = ap.state === 'hub';
    const isSel = selected === ap.code;
    const rad = ap.state === 'hub' ? 6.5 : ap.state === 'served' ? 4.5 : ap.state === 'open' ? 2.2 + ap.a.size * 0.5 : 2.2;
    const ring = Math.max(rad * 2.2, 11);
    const fs = touch ? (big || isSel ? 13 : 12) : big ? 12 : 10.5;
    const want = (ap.label && !crowded) || isSel || big || hover === ap.code || (showAll && ap.state !== 'locked' && ap.state !== 'dim');
    return { big, isSel, rad, ring, fs, want, ty: -(isSel ? ring : rad) - 5 };
  };
  const shown = useMemo(() => {
    const boxes: LabelBox[] = [];
    const order = els.map((ap) => ({ ap, r: labelRank(ap, selected, hover) })).sort((a, b) => a.r - b.r);
    for (const { ap } of order) {
      const m = geom(ap);
      if (!m.want) continue;
      boxes.push({ id: ap.code, x: ap.x / unit, y: ap.y / unit + m.ty - m.fs * 0.35, w: ap.code.length * m.fs * 0.62 + 2, h: m.fs });
    }
    return placeLabels(boxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [els, unit, selected, hover, crowded, showAll, touch]);
  let sel: ApEl | undefined;
  const item = (ap: ApEl) => {
    const { big, isSel, rad, ring, fs, ty } = geom(ap);
    const fill = ap.state === 'hub' ? accent : ap.state === 'served' ? 'var(--map-pin)' : ap.state === 'open' ? 'var(--map-ap-open)' : ap.state === 'locked' ? 'var(--map-ap-locked)' : 'var(--map-ap-other)';
    return (
      <g key={ap.code} data-code={ap.code} transform={`translate(${ap.x} ${ap.y})`} className={`ap ap-${ap.state} ${isSel ? 'sel' : ''} ${hover === ap.code ? 'hov' : ''}`}>
        <g className="mk" transform={`scale(${unit})`}>
          {big && <circle r={rad * 2.4} style={{ fill: accent }} opacity={0.18} className="pulse" />}
          {isSel && <circle r={ring} style={{ fill: 'rgba(var(--ink-rgb),0.08)', stroke: 'var(--map-ring)' }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="sel-ring" />}
          <circle r={rad} style={{ fill, stroke: big || isSel ? 'var(--map-ring)' : 'rgba(var(--halo-rgb),0.8)' }} strokeWidth={big ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
          {shown.has(ap.code) && (
            <text y={ty} textAnchor="middle" fontSize={fs} className="ap-label">
              {ap.code}
            </text>
          )}
        </g>
      </g>
    );
  };
  return (
    <g className="airports">
      {els.map((ap) => {
        if (ap.code === selected) { sel = ap; return null; }
        return item(ap);
      })}
      {/* The selected airport draws last, above its neighbours. */}
      {sel && item(sel)}
    </g>
  );
});

/** Squared distance from p to segment ab. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

interface Gesture {
  mode: 'pan' | 'pinch';
  type: string;
  start: View;
  sx: number;
  sy: number;
  moved: boolean;
  t0: number;
  /** Most pointers down at once during this gesture. */
  max: number;
  d0: number;
  /** Map point under the pinch midpoint at pinch start. */
  anchor: [number, number];
  mid: [number, number];
  pinchMoved: boolean;
  samples: { t: number; x: number; y: number }[];
}

/**
 * World map with touch-first navigation: one-finger pan (with momentum), two-finger pinch around
 * the midpoint, double tap to zoom in, two-finger tap to zoom out, mouse drag / wheel / trackpad
 * pinch (ctrl+wheel in Chrome, gesture events in Safari). Taps pick the nearest airport (or route)
 * within a finger-sized radius. While a gesture runs the transform is written straight to the DOM
 * and React re-renders markers at most every 120 ms.
 */
export function WorldMap({
  rotate = 0, routes, airports, fit, fitPad, interactive = true, animate = true, accent: accentIn = 'var(--accent)', selected, onSelect, onSelectRoute, onHover,
  tooltip, regionLabels, className, planesKey, controls = true, revealPad, layers, underlay, ground, backdrop, glow, onTap, fitFn, fitCentre, focus, memo, follow,
}: Props) {
  const touch = useTouch();
  // v0.11 a pale livery colour (white, cream) would vanish on the light map: the theme accent there instead.
  const theme = useTheme();
  const accent = theme === 'light' && paleOnLight(accentIn) ? 'var(--accent)' : accentIn;
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const planesRef = useRef<SVGGElement>(null);
  const baseWrap = useRef<HTMLDivElement>(null);
  const baseG = useRef<SVGGElement>(null);
  const backWrap = useRef<HTMLDivElement>(null);
  const backG = useRef<SVGGElement>(null);
  const glowWrap = useRef<HTMLDivElement>(null);
  const glowCv = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef(glow);
  glowRef.current = glow;
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  // Container geometry as rendered (s = screen pixels per map unit at zoom 1; the SVG uses "slice" scaling).
  const [box, setBox] = useState<Geo>(() => geoOf(1000, 600));
  const pxPerUnit = box.s;
  const geoRef = useRef<Geo>(geoOf(1000, 600));
  /** The view written into the land/backdrop SVG; the live view is reached from it with a CSS transform. */
  const layerView = useRef<View>(view);
  /** Backdrop shift in map units (ctx.backShift). */
  const backDx = useRef(0);
  /** Marker groups counter-scaled live (`.mk`), refreshed after each render. */
  const mkEls = useRef<SVGGElement[]>([]);
  const mkU = useRef(0);
  /** The view on screen right now; ahead of `view` (React state) during gestures and animations. */
  const live = useRef<View>(view);
  const gest = useRef<Gesture | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const anim = useRef(0);
  const wheelUntil = useRef(0);
  const commitTimer = useRef(0);
  const settleTimer = useRef(0);
  const userMoved = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  /** v0.12 when the player last panned or zoomed (follow waits a few seconds after). */
  const userAt = useRef(0);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const proj = projection(rotate);
  const path = useMemo(() => geoPath(proj), [proj]);

  const busy = () => gest.current !== null || anim.current !== 0 || performance.now() < wheelUntil.current;

  /** CSS transforms that carry the land and backdrop layers from layerView to v; resyncs them when out of margin. */
  const placeLayers = (v: View, allowSync = true) => {
    const lv = layerView.current;
    const g = geoRef.current;
    const M = marginOf(g);
    const r = v.k / lv.k;
    const tx = g.ox * (1 - r) + g.s * (v.x - r * lv.x) + M * (1 - r);
    const ty = g.oy * (1 - r) + g.s * (v.y - r * lv.y) + M * (1 - r);
    // Keep half a margin spare for the backdrop shift; zooming past 1.5× would show a blurry raster.
    const q = (r * M) / 2;
    const ok = r > 0.67 && r < 1.5 && tx - M <= -q && r * (g.w + 2 * M) + tx - M >= g.w + q && ty - M <= -q && r * (g.h + 2 * M) + ty - M >= g.h + q;
    if (!ok && allowSync) { syncLayers(); return; }
    const tf = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${r.toPrecision(6)})`;
    if (baseWrap.current) baseWrap.current.style.transform = tf;
    if (glowWrap.current) glowWrap.current.style.transform = tf;
    if (backWrap.current) backWrap.current.style.transform = `${tf} translateX(${(backDx.current * lv.k * g.s).toFixed(2)}px)`;
  };
  /** Rewrites the land/backdrop SVG transform to the live view (one repaint of the land). */
  const syncLayers = () => {
    const v = live.current;
    layerView.current = v;
    const tf = `translate(${v.x} ${v.y}) scale(${v.k})`;
    baseG.current?.setAttribute('transform', tf);
    backG.current?.setAttribute('transform', tf);
    drawGlow();
    placeLayers(v, false);
  };
  /** Moves the map on screen without a React render (the transforms are owned here, not by JSX). */
  const apply = (v: View) => {
    live.current = v;
    worldRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
    placeLayers(v);
    // Markers keep their screen size between commits (no sawtooth while pinching).
    const u = 1 / (geoRef.current.s * v.k);
    if (u !== mkU.current) {
      mkU.current = u;
      const tf = `scale(${u})`;
      for (const el of mkEls.current) el.setAttribute('transform', tf);
    }
  };
  const commit = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = 0;
    const v = live.current;
    setView((cur) => (sameView(cur, v) ? cur : v));
    if (!busy()) syncLayers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Re-renders markers/labels for the new zoom at most every 120 ms while a gesture runs. */
  const scheduleCommit = () => {
    if (!commitTimer.current) commitTimer.current = window.setTimeout(commit, 120);
  };
  useLayoutEffect(() => {
    if (!busy()) { apply(view); syncLayers(); }
    if (memo && restored.current) memo.view = view;
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  // New geometry (resize) or new layer elements: rewrite the layer transforms.
  useLayoutEffect(() => { syncLayers(); }, [box, !!backdrop, !!glow]); // eslint-disable-line react-hooks/exhaustive-deps
  // After every render: the marker groups to counter-scale (React wrote the committed scale into them).
  useLayoutEffect(() => {
    mkEls.current = worldRef.current ? (Array.from(worldRef.current.querySelectorAll('.mk')) as SVGGElement[]) : [];
    mkU.current = 1 / (pxPerUnit * view.k);
    if (!sameView(live.current, view)) apply(live.current);
  });
  /** Paints the glow canvas at the layer's view (soft glows: at most 1.5 device px per CSS px). */
  const drawGlow = useCallback(() => {
    const cv = glowCv.current;
    const paint = glowRef.current;
    if (!cv || !paint) return;
    const g = geoRef.current;
    const M = marginOf(g);
    const dpr = 0.6;
    const W = Math.round((g.w + 2 * M) * dpr);
    const H = Math.round((g.h + 2 * M) * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, W, H);
    const lv = layerView.current;
    paint(c, (p) => [((p[0] * lv.k + lv.x) * g.s + g.ox + M) * dpr, ((p[1] * lv.k + lv.y) * g.s + g.oy + M) * dpr], dpr);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const backShift = useCallback((dx: number) => {
    backDx.current = dx;
    placeLayers(live.current, false);
    return dx * layerView.current.k * geoRef.current.s;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const measure = (): Geo => {
    const el = wrapRef.current;
    if (!el) return geoRef.current;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) geoRef.current = geoOf(r.width, r.height, r.left, r.top);
    return geoRef.current;
  };

  // ---------- animation helpers ----------
  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = 0;
  };
  /** Runs frame(eased 0..1, dt) every animation frame for ms (ms 0: until frame returns null). */
  const run = (frame: (e: number, dt: number) => View | null, ms: number) => {
    stopAnim();
    const t0 = performance.now();
    let last = t0;
    const step = (now: number) => {
      const t = ms > 0 ? Math.min(1, (now - t0) / ms) : 0;
      const v = frame(1 - Math.pow(1 - t, 3), Math.min(34, now - last));
      last = now;
      if (v) apply(v);
      if (v && (ms <= 0 || t < 1)) anim.current = requestAnimationFrame(step);
      else { anim.current = 0; commit(); }
    };
    anim.current = requestAnimationFrame(step);
  };
  const flyTo = (target: View, ms = 380) => {
    const v0 = live.current;
    run((e) => ({ k: v0.k + (target.k - v0.k) * e, x: v0.x + (target.x - v0.x) * e, y: v0.y + (target.y - v0.y) * e }), ms);
  };
  /** Zoom by `factor` keeping the viewBox point m fixed on screen. */
  const zoomBy = (factor: number, m: [number, number], animated = true) => {
    const v0 = live.current;
    const geo = geoRef.current;
    const p = [(m[0] - v0.x) / v0.k, (m[1] - v0.y) / v0.k];
    const k1 = Math.max(1, Math.min(K_MAX, v0.k * factor));
    const at = (e: number) => {
      const k = v0.k * Math.pow(k1 / v0.k, e);
      return clampView({ k, x: m[0] - p[0] * k, y: m[1] - p[1] * k }, geo);
    };
    userMoved.current = true;
    if (animated) run(at, 280);
    else apply(at(1));
  };
  const fling = (vx: number, vy: number) => {
    run((_e, dt) => {
      const decay = Math.pow(0.94, dt / 16);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < 0.03) return null;
      const s = geoRef.current.s;
      const v = live.current;
      return clampView({ k: v.k, x: v.x + (vx * dt) / s, y: v.y + (vy * dt) / s }, geoRef.current);
    }, 0);
  };
  const center = (): [number, number] => {
    const g = geoRef.current;
    return [(g.w / 2 - g.ox) / g.s, (g.h / 2 - g.oy) / g.s];
  };
  useEffect(() => () => { stopAnim(); window.clearTimeout(commitTimer.current); window.clearTimeout(settleTimer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- fitting ----------
  const fitKey = fitFn ? '(fn)' : (fit ?? []).join(',');
  const padKey = (fitPad ?? []).join(',');
  const fitFnRef = useRef(fitFn);
  fitFnRef.current = fitFn;
  const fitCentreRef = useRef(fitCentre);
  fitCentreRef.current = fitCentre;
  const fitK = useRef(1);
  const fitTarget = (geo: Geo): View => {
    const codes = fitFnRef.current ? fitFnRef.current() : fit;
    return codes && codes.length ? fitView(rotate, codes, geo, fitPad, fitCentreRef.current?.()) : clampView({ k: 1, x: 0, y: 0 }, geo);
  };
  const restored = useRef(false);
  /** Size of the last fit: the ResizeObserver's first (same-size) report must not refit over a reveal. */
  const fitWH = useRef('');
  const doFit = useCallback((animated = false) => {
    const geo = measure();
    if (geo.w <= 0) return;
    fitWH.current = `${geo.w}x${geo.h}`;
    setBox((b) => (b.w === geo.w && b.h === geo.h ? b : geo));
    const target = fitTarget(geo);
    fitK.current = target.k;
    // First layout after a remount: restore the remembered view instead of fitting.
    if (!restored.current && memo?.view) {
      restored.current = true;
      userMoved.current = true;
      const v = clampView(memo.view, geo);
      apply(v);
      syncLayers();
      setView(v);
      return;
    }
    restored.current = true;
    userMoved.current = false;
    if (animated) flyTo(target);
    else {
      stopAnim();
      apply(target);
      syncLayers();
      setView(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, padKey, rotate]);
  const fitRef = useRef(doFit);
  fitRef.current = doFit;
  useLayoutEffect(() => {
    doFit();
  }, [doFit]);
  // An unmount (or StrictMode's rehearsal of one) restores the remembered view again on the next mount.
  useLayoutEffect(() => () => { restored.current = false; }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const geo = measure();
      setBox((b) => (b.w === geo.w && b.h === geo.h ? b : geo));
      // Rotation / Split View / panel changes: refit until the player has moved the map.
      if (!userMoved.current) { if (`${geo.w}x${geo.h}` !== fitWH.current) fitRef.current(); }
      else if (!busy()) { apply(clampView(live.current, geo)); commit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- geometry & hit testing ----------
  /** Client coordinates → viewBox coordinates (uses the rect cached by measure()). */
  const vbOf = (cx: number, cy: number): [number, number] => {
    const g = geoRef.current;
    return [(cx - g.left - g.ox) / g.s, (cy - g.top - g.oy) / g.s];
  };

  const airportKey = airports.map((a) => `${a.code}${a.state[0]}${a.label ? 1 : 0}`).join(',');
  const airportEls = useMemo(() => {
    return airports.map((ap) => {
      const a = AIRPORT_BY_CODE[ap.code];
      const p = a && proj([a.lon, a.lat]);
      if (!p) return null;
      return { ...ap, a, x: p[0], y: p[1] };
    }).filter(Boolean) as ApEl[];
  }, [airportKey, proj]); // eslint-disable-line react-hooks/exhaustive-deps

  const routeKey = routes.map((r) => `${r.id}|${r.from}|${r.to}|${r.weight.toFixed(3)}|${r.color ?? ''}|${r.dashed ? 1 : 0}|${r.highlight ? 1 : 0}`).join(',');
  const routeItems = useMemo(() => routes.map((r) => {
    const A = AIRPORT_BY_CODE[r.from];
    const B = AIRPORT_BY_CODE[r.to];
    const d = A && B ? path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] }) : null;
    return d ? { r, d } : null;
  }).filter(Boolean) as { r: MapRoute; d: string }[], [routeKey, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const tappableRoutes = !!onSelectRoute;
  const routeLines = useMemo(() => {
    if (!tappableRoutes) return [];
    return routes.map((r) => {
      const A = AIRPORT_BY_CODE[r.from];
      const B = AIRPORT_BY_CODE[r.to];
      if (!A || !B) return null;
      const interp = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 24; i++) {
        const q = proj(interp(i / 24));
        if (q) pts.push([q[0], q[1]]);
      }
      return { id: r.id, pts };
    }).filter(Boolean) as { id: string; pts: [number, number][] }[];
  }, [routeKey, proj, tappableRoutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const hitTest = (cx: number, cy: number, finger: boolean): { airport?: string; route?: string } => {
    const [vx, vy] = vbOf(cx, cy);
    const v = live.current;
    const unit = v.k * geoRef.current.s; // screen px per map unit
    const mx = (vx - v.x) / v.k;
    const my = (vy - v.y) / v.k;
    const rA = (finger ? HIT_AP.touch : HIT_AP.mouse) / unit;
    let best: string | undefined;
    let bestScore = Infinity;
    for (const ap of airportEls) {
      const d = Math.hypot(ap.x - mx, ap.y - my);
      if (d > rA) continue;
      // Prefer your own airports when markers crowd together.
      const score = d * unit - (ap.state === 'hub' ? 8 : ap.state === 'served' ? 5 : ap.code === selected ? 3 : 0);
      if (score < bestScore) { bestScore = score; best = ap.code; }
    }
    if (best) return { airport: best };
    if (!tappableRoutes) return {};
    const rR = (finger ? HIT_ROUTE.touch : HIT_ROUTE.mouse) / unit;
    let bestR: string | undefined;
    let bestD = rR * rR;
    for (const line of routeLines) {
      for (let i = 1; i < line.pts.length; i++) {
        const [ax, ay] = line.pts[i - 1];
        const [bx, by] = line.pts[i];
        if (Math.abs(bx - ax) > MAP_W / 2) continue; // antimeridian wrap
        const d2 = segDist2(mx, my, ax, ay, bx, by);
        if (d2 < bestD) { bestD = d2; bestR = line.id; }
      }
    }
    return bestR ? { route: bestR } : {};
  };

  const tap = (cx: number, cy: number, finger: boolean, now: number) => {
    const last = lastTap.current;
    if (last && now - last.t < 350 && Math.hypot(cx - last.x, cy - last.y) < (finger ? 40 : 12)) {
      // Double tap / double click: zoom in around that point.
      lastTap.current = null;
      zoomBy(2, vbOf(cx, cy));
      return;
    }
    lastTap.current = { t: now, x: cx, y: cy };
    if (onTap) {
      const [vx, vy] = vbOf(cx, cy);
      const v = live.current;
      if (onTap([(vx - v.x) / v.k, (vy - v.y) / v.k], 1 / (v.k * geoRef.current.s), finger)) return;
    }
    const hit = hitTest(cx, cy, finger);
    if (hit.airport) onSelect?.(hit.airport);
    else if (hit.route) onSelectRoute?.(hit.route);
    else {
      onSelect?.(null);
      onSelectRoute?.(null);
    }
  };

  // ---------- pointer gestures: pan, pinch, tap, double tap, two-finger tap ----------
  const startPinch = (g: Gesture) => {
    const [a, b] = [...ptrs.current.values()];
    g.mode = 'pinch';
    g.start = live.current;
    g.d0 = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
    g.mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const m = vbOf(g.mid[0], g.mid[1]);
    g.anchor = [(m[0] - g.start.x) / g.start.k, (m[1] - g.start.y) / g.start.k];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('button, a, input, select, textarea')) return;
    stopAnim();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current;
    if (!g || ptrs.current.size === 1) {
      measure();
      gest.current = {
        mode: 'pan', type: e.pointerType, start: live.current, sx: e.clientX, sy: e.clientY, moved: false, t0: performance.now(),
        max: 1, d0: 0, anchor: [0, 0], mid: [e.clientX, e.clientY], pinchMoved: false, samples: [],
      };
      if (hover) { setHover(null); onHover?.(null); }
    } else {
      g.max = Math.max(g.max, ptrs.current.size);
      if (ptrs.current.size === 2) startPinch(g);
    }
  };

  const hoverAt = (cx: number, cy: number) => {
    measure();
    const code = hitTest(cx, cy, false).airport ?? null;
    if ((hover?.code ?? null) === code) return;
    const g = geoRef.current;
    setHover(code ? { code, x: cx - g.left, y: cy - g.top } : null);
    onHover?.(code);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== 'touch' && !gest.current) hoverAt(e.clientX, e.clientY);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gest.current;
    if (!g) return;
    const geo = geoRef.current;
    if (g.mode === 'pan') {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < (g.type === 'mouse' ? 3 : 8)) return;
        // Start from here so the map doesn't jump by the slop distance.
        g.moved = true;
        g.sx = e.clientX;
        g.sy = e.clientY;
        g.start = live.current;
        g.samples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
        userMoved.current = true;
        userAt.current = performance.now();
        return;
      }
      apply(clampView({ k: g.start.k, x: g.start.x + dx / geo.s, y: g.start.y + dy / geo.s }, geo));
      const now = performance.now();
      g.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    } else {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
      const mc: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      if (!g.pinchMoved && (Math.abs(d - g.d0) > 10 || Math.hypot(mc[0] - g.mid[0], mc[1] - g.mid[1]) > 10)) {
        g.pinchMoved = true;
        userMoved.current = true;
      }
      userAt.current = performance.now();
      if (!g.pinchMoved) return;
      g.mid = mc;
      const m = vbOf(mc[0], mc[1]);
      const k = Math.max(1, Math.min(K_MAX, g.start.k * (d / g.d0)));
      apply(clampView({ k, x: m[0] - g.anchor[0] * k, y: m[1] - g.anchor[1] * k }, geo));
      scheduleCommit();
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptrs.current.delete(e.pointerId)) return;
    const g = gest.current;
    if (!g) return;
    const left = ptrs.current.size;
    if (left === 1) {
      // Pinch → keep panning with the remaining finger.
      const [r] = [...ptrs.current.values()];
      g.mode = 'pan';
      g.start = live.current;
      g.sx = r.x;
      g.sy = r.y;
      g.moved = true;
      g.samples = [];
      return;
    }
    if (left >= 2) { startPinch(g); return; }
    gest.current = null;
    const cancelled = e.type === 'pointercancel';
    const dur = performance.now() - g.t0;
    if (g.max >= 2) {
      // Two-finger tap zooms out (as in Maps).
      if (!g.pinchMoved && !cancelled && dur < 320) zoomBy(0.5, vbOf(g.mid[0], g.mid[1]));
      else commit();
      return;
    }
    if (g.moved) {
      const s = g.samples;
      const now = performance.now();
      if (!cancelled && g.type !== 'mouse' && s.length >= 2 && now - s[s.length - 1].t < 80) {
        const a = s[0];
        const b = s[s.length - 1];
        const dt = Math.max(16, b.t - a.t);
        const vx = (b.x - a.x) / dt;
        const vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.25) { fling(vx * 0.9, vy * 0.9); return; }
      }
      commit();
      return;
    }
    if (cancelled) return;
    swallowClick();
    tap(e.clientX, e.clientY, e.pointerType !== 'mouse', e.timeStamp);
  };

  // A tap selects on pointerup; the panel it opens can land under the finger, and that same tap's click
  // would then hit a button in it (a crew row). Swallow that one click (none follows a later pointerdown).
  const swallowClick = () => {
    const until = performance.now() + 400;
    const off = () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointerdown', off, true);
      window.clearTimeout(timer);
    };
    const onClick = (ev: MouseEvent) => {
      off();
      // A click on the map itself is the normal case: let it through.
      if (performance.now() > until || wrapRef.current?.contains(ev.target as Node)) return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('pointerdown', off, true);
    const timer = window.setTimeout(off, 450);
  };

  // Wheel (mouse, trackpad scroll and Chrome's ctrl+wheel trackpad pinch) and Safari's trackpad gesture events.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !interactive) return;
    const settle = () => {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(commit, 180);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      measure();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), vbOf(e.clientX, e.clientY), false);
      wheelUntil.current = performance.now() + 160;
      userAt.current = performance.now();
      scheduleCommit();
      settle();
    };
    type GestureEv = Event & { scale: number; clientX: number; clientY: number };
    let gz: { v0: View; m: [number, number] } | null = null;
    // Touch pinches are handled with pointer events; Safari's gesture events then only matter for trackpads.
    const fingersDown = () => ptrs.current.size > 0;
    const onGStart = (ev: Event) => {
      ev.preventDefault();
      if (fingersDown()) return;
      const e = ev as GestureEv;
      stopAnim();
      measure();
      gz = { v0: live.current, m: vbOf(e.clientX, e.clientY) };
    };
    const onGChange = (ev: Event) => {
      ev.preventDefault();
      if (!gz || fingersDown()) return;
      const e = ev as GestureEv;
      const { v0, m } = gz;
      const p = [(m[0] - v0.x) / v0.k, (m[1] - v0.y) / v0.k];
      const k = Math.max(1, Math.min(K_MAX, v0.k * e.scale));
      apply(clampView({ k, x: m[0] - p[0] * k, y: m[1] - p[1] * k }, geoRef.current));
      userMoved.current = true;
      wheelUntil.current = performance.now() + 160;
      scheduleCommit();
      settle();
    };
    const onGEnd = (ev: Event) => {
      ev.preventDefault();
      gz = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGStart);
    el.addEventListener('gesturechange', onGChange);
    el.addEventListener('gestureend', onGEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGStart);
      el.removeEventListener('gesturechange', onGChange);
      el.removeEventListener('gestureend', onGEnd);
    };
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan a newly selected airport (or focus point) out from under overlays (side panel / bottom sheet).
  const revealRef = useRef(revealPad);
  revealRef.current = revealPad;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusKey = focus !== undefined ? focus?.key ?? '' : selected ?? '';
  useEffect(() => {
    const padOpt = revealRef.current;
    if (!focusKey || !padOpt || !interactive) return;
    let id = 0;
    let tries = 0;
    const reveal = () => {
      const f = focusRef.current;
      const a = f ? undefined : selected ? AIRPORT_BY_CODE[selected] : undefined;
      const at: FocusAt | null | undefined = f ? f.at() : a ? proj([a.lon, a.lat]) : null;
      const fa = !at ? null : Array.isArray(at) ? { pts: [at], box: [0, 0, 0, 0] } : { pts: at.pts, box: at.box ?? [0, 0, 0, 0] };
      // Just mounted (pins not placed yet, a fit or restore still running): try again over the next frames.
      if (!fa || !fa.pts.length || busy()) { if (++tries < 12) id = requestAnimationFrame(reveal); return; }
      const pad = typeof padOpt === 'function' ? padOpt() : padOpt;
      const geo = measure();
      const v = live.current;
      const m = 32;
      const [bl, bt, br, bb] = fa.box;
      const sc = fa.pts.map((p) => [(p[0] * v.k + v.x) * geo.s + geo.ox, (p[1] * v.k + v.y) * geo.s + geo.oy]);
      // Shift that brings [lo, hi] inside [a0, a1]; just the first point's span when the whole set doesn't fit.
      const shift = (i: 0 | 1, lo0: number, hi0: number, a0: number, a1: number) => {
        let lo = Math.min(...sc.map((q) => q[i])) - lo0;
        let hi = Math.max(...sc.map((q) => q[i])) + hi0;
        if (hi - lo > a1 - a0) { lo = sc[0][i] - lo0; hi = sc[0][i] + hi0; }
        return lo < a0 ? a0 - lo : hi > a1 ? a1 - hi : 0;
      };
      const dx = shift(0, bl, br, pad[3] + m, geo.w - pad[1] - m);
      const dy = shift(1, bt, bb, pad[0] + m, geo.h - pad[2] - m);
      if (dx || dy) flyTo(clampView({ k: v.k, x: v.x + dx / geo.s, y: v.y + dy / geo.s }, geo), 360);
    };
    id = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(id);
  }, [focusKey, interactive, proj]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- v0.12 follow (spotter mode) ----------
  const followRef = useRef(follow);
  followRef.current = follow;
  const followKey = follow?.key ?? '';
  useEffect(() => {
    if (!followKey || !interactive) return;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = performance.now();
    let arrived = false;
    let moved = false;
    /** The view with the point in the middle of the clear area at zoom k. */
    const centred = (p: [number, number], k: number, pad: Pad): View => {
      const geo = geoRef.current;
      const cx = (pad[3] + geo.w - pad[1]) / 2;
      const cy = (pad[0] + geo.h - pad[2]) / 2;
      return clampView({ k, x: (cx - geo.ox) / geo.s - p[0] * k, y: (cy - geo.oy) / geo.s - p[1] * k }, geo);
    };
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(100, now - last);
      last = now;
      const f = followRef.current;
      if (!f || document.visibilityState === 'hidden') return;
      // A gesture or an animation (the fly-in) owns the view; after the player moved the map, wait a while.
      if (busy() || now - userAt.current < 4000) return;
      const p = f.at();
      if (!p) return;
      const v = live.current;
      if (!arrived) {
        // First the fly-in, zoomed in to at least `zoom`.
        arrived = true;
        measure();
        const k = Math.min(K_MAX, Math.max(v.k, f.zoom ?? 1));
        const target = centred(p, k, f.pad);
        if (calm) { apply(target); commit(); } else flyTo(target, 900);
        return;
      }
      const target = centred(p, v.k, f.pad);
      const geo = geoRef.current;
      const off = Math.hypot((target.x - v.x) * geo.s, (target.y - v.y) * geo.s);
      if (calm) {
        // Reduced motion: no gliding; one jump when the aircraft has drifted well off the middle.
        if (off > Math.min(geo.w, geo.h) * 0.3) { apply(target); commit(); }
        return;
      }
      if (off < 0.25) return;
      const a = 1 - Math.exp(-dt / 450);
      apply({ k: v.k, x: v.x + (target.x - v.x) * a, y: v.y + (target.y - v.y) * a });
      moved = true;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (moved && !busy()) commit();
    };
  }, [followKey, interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- region labels ----------
  const regionKey = (regionLabels ?? []).map((r) => `${r.id}${r.locked ? 1 : 0}`).join(',');
  const regionLabelEls = useMemo(() => {
    if (!regionLabels) return [];
    return regionLabels.map((r) => {
      const aps = AIRPORTS.filter((a) => a.region === r.id);
      const pts = aps.map((a) => proj([a.lon, a.lat])!).filter(Boolean);
      const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return { ...r, x, y, name: REGIONS.find((x) => x.id === r.id)!.name };
    });
  }, [regionKey, proj]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- planes (imperative animation) ----------
  // Cap the number of animated aircraft so big networks stay smooth.
  const planeRoutes = useMemo(() => {
    const cap = isTouch() ? MAX_PLANES_TOUCH : MAX_PLANES;
    const list = routes.filter((r) => (r.planes ?? 0) > 0).sort((a, b) => (b.planes ?? 0) - (a.planes ?? 0));
    let budget = cap;
    const out: MapRoute[] = [];
    for (const r of list) {
      if (budget <= 0) break;
      const n = Math.min(r.planes ?? 0, budget, Math.max(1, Math.ceil(cap / list.length)));
      out.push({ ...r, planes: n });
      budget -= n;
    }
    return out;
  }, [planesKey ?? routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pxRef = useRef(pxPerUnit);
  pxRef.current = pxPerUnit;
  useEffect(() => {
    const g = planesRef.current;
    if (!g) return;
    g.innerHTML = '';
    if (!animate) return;
    const NS = 'http://www.w3.org/2000/svg';
    interface P { el: SVGGElement; trail: SVGPolylineElement; interp: (t: number) => [number, number]; dur: number; phase: number }
    const planes: P[] = [];
    for (const r of planeRoutes) {
      const A = AIRPORT_BY_CODE[r.from];
      const B = AIRPORT_BY_CODE[r.to];
      const interp = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
      const distKm = Math.hypot(A.lat - B.lat, A.lon - B.lon) * 111;
      const dur = 9000 + Math.min(32000, distKm * 3.2);
      for (let i = 0; i < (r.planes ?? 0); i++) {
        const el = document.createElementNS(NS, 'g');
        const icon = document.createElementNS(NS, 'path');
        icon.setAttribute('d', PLANE_PATH);
        icon.setAttribute('transform', 'translate(-12 -12)');
        icon.style.fill = 'var(--map-plane)';
        el.appendChild(icon);
        const trail = document.createElementNS(NS, 'polyline');
        trail.setAttribute('fill', 'none');
        trail.style.stroke = r.color ?? accent;
        trail.setAttribute('stroke-opacity', '0.55');
        trail.setAttribute('stroke-width', '1.6');
        trail.setAttribute('stroke-linecap', 'round');
        trail.setAttribute('vector-effect', 'non-scaling-stroke');
        g.appendChild(trail);
        g.appendChild(el);
        planes.push({ el, trail, interp, dur, phase: (i / (r.planes ?? 1)) * 2 + Math.random() * 0.3 });
      }
    }
    // Planes drift slowly, so ~30 fps is plenty on battery-powered touch devices.
    const minFrame = isTouch() ? 30 : 0;
    let raf = 0;
    let paused = false;
    let lastFrame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (paused || now - lastFrame < minFrame) return;
      lastFrame = now;
      // Freeze while a dialog is open: blurred backdrops over moving content are expensive.
      if (document.querySelector('.modal-backdrop')) return;
      const s = 15 / 24 / (pxRef.current * live.current.k);
      for (const p of planes) {
        const cyc = ((now - t0) / p.dur + p.phase) % 2;
        const fwd = cyc < 1;
        const t = fwd ? cyc : 2 - cyc;
        // Ease near the airports so planes appear to land and take off.
        const e = t < 0.04 ? t * 0.5 + 0.02 * (t / 0.04) : t > 0.96 ? 1 - (1 - t) * 0.5 - 0.02 * ((1 - t) / 0.04) : t;
        const pos = proj(p.interp(Math.max(0, Math.min(1, e))));
        const ahead = proj(p.interp(Math.max(0, Math.min(1, e + (fwd ? 0.01 : -0.01)))));
        if (!pos || !ahead) continue;
        let ang = (Math.atan2(ahead[1] - pos[1], ahead[0] - pos[0]) * 180) / Math.PI + 90;
        if (Math.abs(ahead[0] - pos[0]) > MAP_W / 2) ang += 180;
        p.el.setAttribute('transform', `translate(${pos[0].toFixed(2)} ${pos[1].toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${s.toFixed(4)})`);
        const pts: string[] = [];
        for (let j = 0; j <= 3; j++) {
          const tt = Math.max(0, Math.min(1, e + (fwd ? -1 : 1) * j * 0.024));
          const q = proj(p.interp(tt));
          if (q && Math.abs(q[0] - pos[0]) < MAP_W / 4) pts.push(`${q[0].toFixed(1)},${q[1].toFixed(1)}`);
        }
        p.trail.setAttribute('points', pts.join(' '));
        const vis = t > 0.02 && t < 0.98 ? '1' : '0';
        p.el.setAttribute('opacity', vis);
        p.trail.setAttribute('opacity', vis);
      }
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => { paused = document.visibilityState === 'hidden'; };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [planeRoutes, animate, proj, accent]);

  // Map units per screen pixel at the current (committed) zoom.
  const k = view.k;
  const unit = 1 / (pxPerUnit * k);
  const showAllLabels = k * pxPerUnit > 1.6;
  // Dense networks only label hubs until you zoom in, to avoid a pile of overlapping codes.
  const crowded = airports.filter((a) => a.label).length > 16 && k * pxPerUnit < 2.2;
  const regionFont = touch ? 12.5 : 11;
  const liveK = useCallback(() => live.current.k, []);
  const onScreen = useCallback((): [number, number, number, number] => {
    const g = geoRef.current;
    const v = live.current;
    const x0 = (-g.ox / g.s - v.x) / v.k;
    const y0 = (-g.oy / g.s - v.y) / v.k;
    return [x0, y0, x0 + g.w / g.s / v.k, y0 + g.h / g.s / v.k];
  }, []);
  const M = marginOf(box);
  const ctx: MapLayerCtx = { proj, unit, k, px: pxPerUnit, liveK, fitK: fitK.current, backShift, margin: M, redrawGlow: drawGlow, onScreen };
  // Oversized layer box (container + margin) and the viewBox that keeps the overlay's "slice" mapping.
  const layerStyle: React.CSSProperties = { position: 'absolute', left: -M, top: -M, width: box.w + 2 * M, height: box.h + 2 * M, transformOrigin: '0 0', willChange: 'transform', pointerEvents: 'none' };
  const layerVB = `${(-M - box.ox) / box.s} ${(-M - box.oy) / box.s} ${(box.w + 2 * M) / box.s} ${(box.h + 2 * M) / box.s}`;
  const svgFill: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };

  return (
    <div
      ref={wrapRef}
      className={`worldmap ${interactive ? 'interactive' : ''} ${hover ? 'hovering' : ''} ${className ?? ''}`}
      style={{ background: OCEAN }}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerEnd : undefined}
      onPointerCancel={interactive ? onPointerEnd : undefined}
      onPointerLeave={interactive ? (e) => { if (e.pointerType !== 'touch' && hover && !ptrs.current.size) { setHover(null); onHover?.(null); } } : undefined}
    >
      <div ref={baseWrap} className="map-layer map-layer-base" style={layerStyle}>
        <svg viewBox={layerVB} preserveAspectRatio="none" style={svgFill}>
          <g ref={baseG}>
            <BaseLayers rotate={rotate} />
            {ground?.(ctx)}
          </g>
        </svg>
      </div>
      {backdrop && (
        <div ref={backWrap} className="map-layer map-layer-back" style={layerStyle}>
          <svg viewBox={layerVB} preserveAspectRatio="none" style={svgFill}>
            <g ref={backG}>{backdrop(ctx)}</g>
          </svg>
        </div>
      )}
      {glow && (
        <div ref={glowWrap} className="map-layer map-layer-glow" style={layerStyle}>
          <canvas ref={glowCv} style={svgFill} />
        </div>
      )}
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice" style={svgFill}>
        <g ref={worldRef}>
          {regionLabelEls.map((r) => (
            <text key={r.id} x={r.x} y={r.y} textAnchor="middle" className={`region-label ${r.locked ? 'locked' : ''}`} fontSize={regionFont * unit} style={{ opacity: k * pxPerUnit > 2.6 ? 0 : 1 }}>
              {r.name.toUpperCase()}
            </text>
          ))}
          {underlay?.(ctx)}
          <RoutesLayer items={routeItems} accent={accent} />
          <g ref={planesRef} className="planes" />
          <AirportsLayer els={airportEls} unit={unit} selected={selected} hover={hover?.code} accent={accent} crowded={crowded} showAll={showAllLabels} touch={touch} />
          {layers?.(ctx)}
        </g>
      </svg>
      {hover && tooltip && (
        <div className="map-tip" style={{ left: hover.x, top: hover.y }}>
          {tooltip(AIRPORT_BY_CODE[hover.code])}
        </div>
      )}
      {interactive && controls && (
        <div className="map-zoom">
          <button className="btn btn-icon btn-sm" onClick={() => { measure(); zoomBy(1.8, center()); }} aria-label="Zoom in"><Plus /></button>
          <button className="btn btn-icon btn-sm" onClick={() => { measure(); zoomBy(1 / 1.8, center()); }} aria-label="Zoom out"><Minus /></button>
          <button className="btn btn-icon btn-sm" onClick={() => doFit(true)} aria-label="Reset view"><Maximize2 /></button>
        </div>
      )}
    </div>
  );
}
