// Ops Map (B4) SVG layers: night terminator and selected-aircraft arcs (under the airports), offer
// pins and aircraft glyphs (above). Aircraft and the terminator move in one imperative rAF loop
// (30 fps on touch, no React render per frame); everything else re-renders with the hourly emit.

import { geoInterpolate, geoPath } from 'd3-geo';
import { memo, useEffect, useMemo, useRef } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { aircraftLive, type AircraftLive } from '../../engine/core/query';
import type { GameState } from '../../engine/core/types';
import { PLANE_PATH } from '../components/Logo';
import { liveMinute, store } from '../store';
import { isTouch } from '../useMedia';
import { MAP_H, MAP_W } from './mapData';
import { headingDeg, lerpAngle, parkOffset, type LegArc, type PinGroup, sunPoint, terminator } from './mapLogic';
import type { MapLayerCtx } from './WorldMap';

/** Live positions shared with tap picking and focus (map units, as last drawn). */
export interface LiveShared {
  ac: Map<string, [number, number]>;
  night: SVGPathElement | null;
}

export const newShared = (): LiveShared => ({ ac: new Map(), night: null });

/** Frame cost stats for perf checks (console: __contrailMap). */
const stats = { frames: 0, avgMs: 0, maxMs: 0, reset() { this.frames = 0; this.avgMs = 0; this.maxMs = 0; } };
(globalThis as unknown as { __contrailMap?: typeof stats }).__contrailMap = stats;

const WRENCH = 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z';
/** Hit radius in screen px (44 px target on touch). */
export const HIT_R = { touch: 22, mouse: 14 };
const GLYPH_PX = 22;
/** Taxi easing time constant (ms) between the runway point and a parking stand. */
const TAXI_MS = 140;
const PARK_ANGLE = 0;

// ---------- night ----------

/** Night polygon path (map units) for game minute t on the (cylindrical) ops projection. */
export function nightPath(proj: MapLayerCtx['proj'], t: number): string {
  const { pts, northNight } = terminator(sunPoint(t), 3);
  let d = '';
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = proj(pts[i]);
    if (!q) continue;
    if (!d) x0 = q[0];
    x1 = q[0];
    d += `${d ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  }
  const edge = northNight ? -MAP_H : MAP_H * 2;
  return `${d}L${x1.toFixed(1)} ${edge}L${x0.toFixed(1)} ${edge}Z`;
}

export const NightLayer = memo(function NightLayer({ shared, proj }: { shared: LiveShared; proj: MapLayerCtx['proj'] }) {
  return (
    <g className="ops-night" pointerEvents="none">
      <path ref={(el) => { shared.night = el; }} d={nightPath(proj, liveMinute())} />
    </g>
  );
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

/** Pin offset in screen px: off the dot at airports we already mark (base, our aircraft). */
export const pinOffset = (marked: boolean): [number, number] => (marked ? [-15, -15] : [0, 0]);

export const PinsLayer = memo(function PinsLayer({ pins, marked, proj, unit, selected }: {
  pins: PinGroup[]; marked: Set<string>; proj: MapLayerCtx['proj']; unit: number; selected?: string;
}) {
  return (
    <g className="ops-pins">
      {pins.map((p) => {
        const a = AIRPORT_BY_CODE[p.code];
        const q = proj([a.lon, a.lat]);
        if (!q) return null;
        const [ox, oy] = pinOffset(marked.has(p.code));
        const sel = selected !== undefined && (selected === p.code || p.offers.some((o) => o.id === selected));
        return (
          <g key={p.code} transform={`translate(${q[0]} ${q[1]}) scale(${unit}) translate(${ox} ${oy})`} className={`ops-pin ${p.urgent ? 'urgent' : ''} ${sel ? 'sel' : ''}`}>
            <circle className="hit" r={HIT_R.touch} />
            {p.urgent && <circle className="ring" r={13} />}
            {sel && <circle className="sel-ring" r={16} />}
            <path className="dia" d="M0 -8.5L8.5 0L0 8.5L-8.5 0Z" />
            {p.offers.length > 1 && <text className="count" x={11} y={-7}>{p.offers.length}</text>}
          </g>
        );
      })}
    </g>
  );
});

// ---------- aircraft ----------

/** Relative luminance (0–1) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

interface Glide { ox: number; oy: number; ang: number }

export function AircraftLayer({ ctx, g, shared, selected }: { ctx: MapLayerCtx; g: GameState; shared: LiveShared; selected?: string }) {
  const ref = useRef<SVGGElement>(null);
  const ids = Object.keys(g.fleet);
  const idsKey = ids.join(',');
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const selRef = useRef(selected);
  selRef.current = selected;
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
    let raf = 0;
    let last = 0;
    let lastT = NaN;
    let lastK = NaN;
    let lastSunT = -Infinity;
    let labels: boolean | null = null;
    let settling = true;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < minFrame || document.visibilityState === 'hidden') return;
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      const game = store.game;
      // Frozen while a modal is open (time is held; blurred backdrops over motion are expensive).
      if (!game || store.modal) return;
      const c = ctxRef.current;
      const t = liveMinute();
      const k = c.liveK();
      if (t === lastT && k === lastK && !settling && !dirty.current) return;
      const t0 = performance.now();
      dirty.current = false;
      lastT = t;
      lastK = k;
      const proj = c.proj;
      // Terminator: recomputed as time moves (glides; ≤ 30 fps on touch).
      if (shared.night && Math.abs(t - lastSunT) >= 0.2) {
        lastSunT = t;
        shared.night.setAttribute('d', nightPath(proj, t));
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
      const ms = performance.now() - t0;
      stats.frames++;
      stats.avgMs += (ms - stats.avgMs) / Math.min(stats.frames, 120);
      stats.maxMs = Math.max(stats.maxMs, ms);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idsKey, shared]); // eslint-disable-line react-hooks/exhaustive-deps

  const livery = g.company.livery;
  const outline = luminance(livery.secondary) > 0.3 && Math.abs(luminance(livery.secondary) - luminance(livery.primary)) > 0.2 ? livery.secondary : '#f4f7ff';
  return (
    <g ref={ref} className="ops-aircraft">
      {ids.map((id) => {
        const ac = g.fleet[id];
        return (
          <g key={id} data-id={id} data-phase="parked" className={`ops-ac ${selected === id ? 'sel' : ''}`}>
            <circle className="hit" r={HIT_R.touch} />
            <path className="hangar" d="M-15 11V-1Q0 -17 15 -1V11Z" />
            <circle className="sel-ring" r={16} />
            <circle className="aog-ring" r={14} />
            <g className="glyph">
              <path d={PLANE_PATH} transform={`scale(${GLYPH_PX / 24}) translate(-12 -12)`} fill={livery.primary} stroke={outline} strokeWidth={1.4} strokeLinejoin="round" />
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
          </g>
        );
      })}
    </g>
  );
}
