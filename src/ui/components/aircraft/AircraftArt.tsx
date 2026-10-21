// Cartoon-clean side profile of an aircraft type in the airline's livery, nose
// RIGHT, in flight (no landing gear). Geometry comes from real-dimension specs
// (metres, nose-left frame) via geometry.ts — drawn from the traced profile in
// traced/<typeId>.ts when one exists — and is mirrored here once, so every
// caller gets nose-right; this component only assigns colours, z-order and
// level of detail.

import { memo, useCallback, useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { artFor } from '../../../data/acmiTypes';
import type { Livery } from '../../../engine/core/types';
import { FONT_STACK } from './fontMetrics';
import { geometry, pathPoly, type Geometry } from './geometry';
import { LogoGlyph } from './logos';
import { PROFILE_BY_ID } from './specs';
import { boxSamples, inPoly, sideAt, stickerLayout, type StickerBox } from './stickers';
import { tracedFor } from './traced/load';
import type { TracedProfile } from './traced/types';
import type { AircraftProfile } from './types';

export interface AircraftArtProps {
  typeId: string;
  livery: Livery;
  /** Default code text for the fin (livery.code.text wins). */
  code?: string;
  /** Default titles text on the forward fuselage (livery.titles.text wins). */
  name?: string;
  className?: string;
  /** Accepted for compatibility; gear is never drawn. */
  gear?: boolean;
  height?: number | string;
  /** 'simple' drops titles and fine lines for ~90px thumbnails; windows and doors follow the drawn size (`artLod`). */
  detail?: 'full' | 'simple';
  /** Fixed scale in CSS px per metre (sets both width and height) — for same-scale comparisons. */
  pxPerM?: number;
  /** Livery editor only: the <svg> element (pointer → viewBox mapping). */
  svgRef?: Ref<SVGSVGElement>;
  /** Livery editor only: sticker id drawn with a dashed box and an unclipped ghost. */
  selected?: string;
  /** Livery editor only: snap guides in viewBox coords (thin cyan lines). */
  guides?: { x?: number[]; y?: number[] };
}

const FALLBACK = 'a320neo';
/** Wing, tail and engine parameters for a silhouette trace without a spec of its own. */
const SUPERSONIC = 'overture';

export function profileFor(typeId: string): AircraftProfile {
  return PROFILE_BY_ID[typeId] ?? PROFILE_BY_ID[artFor(typeId)] ?? PROFILE_BY_ID[FALLBACK];
}

/**
 * Spec a traced profile is drawn with. Every type shares one scale (SVG units = metres), so the
 * real length comes from the type's own spec, or `lengthM` on the profile; a traced type with
 * neither (a reference-only variant such as the A318) borrows the fallback spec's fuselage
 * height and takes its length from the traced height-to-length ratio. A traced type without a
 * spec borrows the fallback's wing, tail and engine parameters (the supersonic spec's for a
 * silhouette trace) under its own id.
 */
const scaled = new Map<TracedProfile, AircraftProfile>();
function specFor(typeId: string, p: AircraftProfile, t?: TracedProfile): AircraftProfile {
  if (!t) return p;
  const own = PROFILE_BY_ID[typeId] === p || PROFILE_BY_ID[artFor(typeId)] === p || p.id === t.typeId;
  if (own && (!t.lengthM || Math.abs(t.lengthM - p.length) < 0.01)) return p;
  let s = scaled.get(t);
  if (!s) {
    const base = own ? p : (t.outline?.length ? PROFILE_BY_ID[SUPERSONIC] : undefined) ?? p;
    const hf = tracedHeight(t);
    const length = t.lengthM ?? (hf ? base.height / hf : base.length);
    s = own ? { ...p, length } : { ...stretch(base, length / base.length), id: t.typeId || typeId, length, titles: undefined };
    scaled.set(t, s);
  }
  return s;
}

/** Borrowed spec moved to another length: every station (x, x0, x1) scales, sizes stay real. */
function stretch<T>(o: T, r: number): T {
  if (Array.isArray(o)) return o.map((v) => stretch(v, r)) as T;
  if (!o || typeof o !== 'object') return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? (k === 'x' || k === 'x0' || k === 'x1' ? v * r : v) : stretch(v, r)])) as T;
}

/** Fuselage height / length of a trace (crown aft of any hump, belly ahead of the wing fairing); 0 if unknown. */
function tracedHeight(t: TracedProfile): number {
  const ys = (pts: readonly (readonly [number, number])[], lo: number, hi: number) => pts.filter(([x]) => x >= lo && x <= hi).map(([, y]) => y);
  const c = ys(t.top, 0.5, 0.7), b = ys(t.bottom, 0.2, 0.32);
  const h = c.length && b.length ? Math.max(...b) - Math.min(...c) : 0;
  return h > 0.02 ? h : 0;
}

/** Geometry for a type: traced profile (by type id, art id or spec id) when one exists, else the parametric spec. */
export function artGeometry(typeId: string): Geometry {
  const p = profileFor(typeId);
  const t = tracedFor(typeId, artFor(typeId), PROFILE_BY_ID[typeId] || PROFILE_BY_ID[artFor(typeId)] ? p.id : undefined);
  return geometry(specFor(typeId, p, t), t);
}

/** Tight viewBox in SVG units (metres, y down, nose right: the nose tip is at x = 0, the tail at x = -length). */
export function artViewBox(typeId: string, _gear?: boolean): { x: number; y: number; w: number; h: number } {
  const b = artGeometry(typeId).box;
  const pad = Math.max(0.15, (b.x1 - b.x0) * 0.01);
  return { x: -(b.x1 + pad), y: -(b.y1 + pad), w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad };
}

/** For same-scale overlays: viewBox, nose tip in viewBox units (nose right), fuselage length (m) and the traced source. */
export function artMetrics(typeId: string): { vb: { x: number; y: number; w: number; h: number }; tip: [number, number]; length: number; traced?: TracedProfile } {
  const g = artGeometry(typeId);
  return { vb: artViewBox(typeId), tip: [-g.tip[0], -g.tip[1]], length: g.L, traced: g.traced };
}

// ---------- colour helpers (hex in, hex out; anything else passes through) ----------

function rgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

export function lum(c: string): number {
  const x = rgb(c);
  if (!x) return 0.5;
  const [r, g, b] = x.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const f = (n: number) => Math.round(n * 100) / 100;

/** Auto lettering colour on the fin: second colour when it reads against the fin, else white / ink. */
export function autoFinInk(lv: Livery): string {
  if (lv.plain) return autoBodyInk(lv);
  return contrast(lv.secondary, lv.primary) >= 2.2 ? lv.secondary : lum(lv.primary) < 0.4 ? '#ffffff' : INK;
}

/** Auto lettering colour on the white fuselage: primary unless it vanishes on white. */
export function autoBodyInk(lv: Livery): string {
  return contrast(lv.primary, '#ffffff') >= 1.6 ? lv.primary : contrast(lv.secondary, '#ffffff') >= 1.6 ? lv.secondary : INK;
}

/** Lettering on the scheme's second-colour area (split / stripe bands, sweep stripe): primary, else white / ink. */
function inkOnSecondary(lv: Livery): string {
  return contrast(lv.primary, lv.secondary) >= 2.2 ? lv.primary : lum(lv.secondary) < 0.4 ? '#ffffff' : INK;
}

/** Paint a sticker can sit on: white body (or an all-white livery), the livery colour, or its second colour. */
type Ground = 'white' | 'primary' | 'secondary';
const groundColour = (lv: Livery, gr: Ground) => (gr === 'white' ? '#ffffff' : gr === 'primary' ? lv.primary : lv.secondary);
/** Auto lettering on one ground (as v0.5: second colour on the fin colour, primary on white). */
function inkOn(lv: Livery, gr: Ground): string {
  if (gr === 'white') return autoBodyInk(lv);
  return gr === 'primary' ? autoFinInk(lv) : inkOnSecondary(lv);
}

const areas = new Map<string, ReturnType<typeof pathPoly>[]>();
/** Is a viewBox point inside a livery area path (several subpaths)? */
function onArea(d: string, X: number, Y: number): boolean {
  if (!d) return false;
  let polys = areas.get(d);
  if (!polys) areas.set(d, (polys = d.split(/(?=M)/).filter(Boolean).map((s) => pathPoly(s))));
  return polys.some((q) => inPoly(q, [-X, -Y]));
}

/** Paint under a viewBox point as drawn (the fin over the crown, the second colour over the first); null off the airframe. */
function groundAt(typeId: string, lv: Livery, X: number, Y: number): Ground | null {
  const side = sideAt(typeId, X, Y);
  if (!side) return null;
  if (lv.plain) return 'white';
  const a = artGeometry(typeId).livery(lv.tail);
  if (side === 'fin') return onArea(a.fin, X, Y) ? 'secondary' : 'primary';
  return onArea(a.fus2, X, Y) ? 'secondary' : onArea(a.fus, X, Y) ? 'primary' : 'white';
}

/** Share of a sticker box's visible part on each ground, largest first (7 × 5 samples; empty when wholly clipped). */
function groundsUnder(typeId: string, lv: Livery, b: StickerBox): [Ground, number][] {
  const n = new Map<Ground, number>();
  let k = 0;
  for (const [X, Y] of boxSamples(b, 7, 5)) {
    const gr = groundAt(typeId, lv, X, Y);
    if (!gr) continue;
    n.set(gr, (n.get(gr) ?? 0) + 1);
    k++;
  }
  return [...n].map(([gr, c]): [Ground, number] => [gr, c / k]).sort((a, b) => b[1] - a[1]);
}

/**
 * Auto lettering colour for a sticker box: the usual ink of the ground under most of it; when it
 * straddles grounds (≥ 10 % each) and that ink fails on one, the colour with the best worst-case
 * contrast — unless that is still weak and one ground holds ≥ 60 % of the box.
 */
export function stickerInk(typeId: string, lv: Livery, b: StickerBox): string {
  const sig = groundsUnder(typeId, lv, b).filter(([, s]) => s >= 0.1);
  if (!sig.length) return b.side === 'fin' ? autoFinInk(lv) : autoBodyInk(lv);
  const pref = inkOn(lv, sig[0][0]);
  if (sig.length === 1) return pref;
  const score = (c: string) => Math.min(...sig.map(([gr]) => contrast(c, groundColour(lv, gr))));
  if (score(pref) >= 2.2) return pref;
  const best = [lv.secondary, lv.primary, '#ffffff', INK].reduce((a, c) => (score(c) > score(a) + 0.01 ? c : a));
  return score(best) >= 3 || sig[0][1] < 0.6 ? best : pref;
}

/**
 * Background a sticker sits on (for contrast warnings): with its box, the paint under most of it;
 * without, the fin colour or the white fuselage.
 */
export function stickerGround(lv: Livery, side: 'fin' | 'fuselage', at?: { typeId: string; box: StickerBox }): string {
  const top = at && groundsUnder(at.typeId, lv, at.box)[0];
  if (top) return groundColour(lv, top[0]);
  return side === 'fin' && !lv.plain ? lv.primary : '#ffffff';
}

// ---------- palette ----------

const INK = '#16213a';
const OUTLINE = 'rgba(14,22,40,0.8)';
const FINE = 'rgba(28,42,68,0.38)';
const WINDOW = '#24324c';
const PANE = '#141e33';
const WING = ['#eef1f6', '#c9d1dd'] as const;
const NAC = ['#ffffff', '#eceff5', '#bfc8d6'] as const;
const NAC_DARK = ['#dfe4ec', '#cfd6e1', '#a3adbf'] as const;
const FUS_STOPS: readonly (readonly [number, string])[] = [
  [0, '#e3e8f0'], [0.07, '#f8fafd'], [0.24, '#ffffff'], [0.52, '#f2f5f9'], [0.78, '#dbe2ec'], [1, '#b6c1d2'],
];

/**
 * Level of detail of the windows and doors by drawn scale (CSS px per metre) and screen density
 * (`dpr`, capped at 3): `full` as drawn, `card` separate windows kept ≥ ~1 device px with a hairline
 * and darker door outlines, `band` each run of windows as one slim band — only where separate
 * windows would merge: under 4.6 px/m at 1× (pitch ~2.4 px), under 5.2 device px/m on dense screens
 * (the 2× iPad Fleet card ~3.9 and market row ~2.8 CSS px/m keep their windows; minis, swatches band).
 */
export type ArtLod = 'full' | 'card' | 'band';
export function artLod(pxPerM: number, dpr = 1): ArtLod {
  const d = Math.max(1, Math.min(dpr || 1, 3));
  return pxPerM * d < (d > 1 ? 5.2 : 4.6) ? 'band' : pxPerM < 8 ? 'card' : 'full';
}
/** Screen density for artLod (1 outside a browser). */
export const screenDpr = (): number => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
const DOOR_SMALL = 'rgba(28,42,68,0.55)';

const PLAIN_ACCENT = '#c9d1dd';
const SELECT = '#3ee6ff';

function AircraftArtImpl({ typeId, livery, code, name, className, height, detail = 'full', pxPerM, svgRef, selected, guides }: AircraftArtProps) {
  const uid = useId().replace(/:/g, '');
  const g: Geometry = artGeometry(typeId);
  const p = g.p;
  // outline mode (traced full silhouette): wing, stabiliser and fin edge are part of the fuselage path
  const sil = g.outline;
  const full = detail === 'full';
  const vb = artViewBox(typeId);
  // drawn scale: given (pxPerM, numeric height), else measured after layout (before paint)
  const guess = pxPerM ?? (typeof height === 'number' ? height / vb.h : full ? 99 : 3);
  const [measured, setMeasured] = useState<number>();
  const el = useRef<SVGSVGElement | null>(null);
  const setRef = useCallback((n: SVGSVGElement | null) => {
    el.current = n;
    if (typeof svgRef === 'function') svgRef(n);
    else if (svgRef) (svgRef as { current: SVGSVGElement | null }).current = n;
  }, [svgRef]);
  useLayoutEffect(() => {
    const n = el.current;
    if (!n || pxPerM) return;
    const take = (w: number, h: number) => {
      if (!(w > 0 && h > 0)) return;
      const k = Math.min(w / vb.w, h / vb.h);
      // re-render only when the level of detail changes
      const d = screenDpr();
      setMeasured((m) => (m !== undefined && artLod(m, d) === artLod(k, d) ? m : k));
    };
    take(n.clientWidth, n.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => es.forEach((e) => take(e.contentRect.width, e.contentRect.height)));
    ro.observe(n);
    return () => ro.disconnect();
  }, [pxPerM, vb.w, vb.h]);
  const lod = artLod(measured ?? guess, screenDpr());
  const lv = g.livery(livery.tail);
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;
  const sw = full ? 1 : 0.75;
  const ns = { vectorEffect: 'non-scaling-stroke' as const };

  const primary = livery.primary;
  const secondary = livery.secondary;
  const plain = !!livery.plain;

  const style = pxPerM ? { width: vb.w * pxPerM, height: vb.h * pxPerM } : { height, width: '100%' };

  // stickers (code, titles, logos): laid out in viewBox coords, drawn twice — clipped to the
  // fuselage and to the fin — so nothing ever paints outside the airframe
  const boxes = stickerLayout(typeId, livery, { code, name }, detail);
  const FLIP = 'scale(-1,1)';
  const sticker = (b: StickerBox, pass: string) => {
    const tf = `${FLIP} translate(${f(b.cx)} ${f(b.cy)})${b.rot ? ` rotate(${f(b.rot)})` : ''}`;
    if (b.kind === 'logo') {
      if (!livery.logo) return null;
      const k = Math.round((b.w / 100) * 1e5) / 1e5;
      return (
        <g key={`${pass}${b.id}`} data-sticker={b.id} transform={`${tf} scale(${k}) translate(-50 -50)`}>
          <LogoGlyph logo={livery.logo} />
        </g>
      );
    }
    const t = b.kind === 'code' ? livery.code : livery.titles;
    const fs = b.fontSize ?? 0;
    return (
      <g key={`${pass}${b.id}`} data-sticker={b.id} transform={tf}>
        <text
          x={Math.round(((b.spacing ?? 0) * fs * 1000) / 2) / 1000}
          y={Math.round((b.baseline ?? 0) * 1000) / 1000}
          fontSize={Math.round(fs * 1000) / 1000}
          fill={t?.color ?? stickerInk(typeId, livery, b)}
          textAnchor="middle"
          style={{ fontFamily: FONT_STACK, fontWeight: b.weight ?? 700, letterSpacing: `${b.spacing ?? 0}em` }}
        >
          {b.text}
        </text>
      </g>
    );
  };
  const sel = selected ? boxes.find((b) => b.id === selected) : undefined;

  const far = g.engines.filter((e) => e.spec.far);
  const near = [...g.engines.filter((e) => !e.spec.far && e.spec.inboard), ...g.engines.filter((e) => !e.spec.far && !e.spec.inboard)];
  // part: 'body' = nacelle only, 'prop' = propeller only (high-wing turboprops draw the wing between them)
  const engine = (e: Geometry['engines'][number], i: number, dim: boolean, part: 'all' | 'body' | 'prop' = 'all') => (
    <g key={i}>
      {part !== 'prop' && (<>
      {e.pylon && <path d={e.pylon} fill={dim ? '#c3cad6' : '#d9dee6'} stroke={OUTLINE} strokeWidth={sw * 0.8} style={ns} strokeLinejoin="round" />}
      {e.core && <path d={e.core} fill={dim ? '#7f8a9d' : '#939eb1'} stroke={OUTLINE} strokeWidth={sw * 0.7} style={ns} />}
      {e.plug && <path d={e.plug} fill="#5b6679" stroke={OUTLINE} strokeWidth={sw * 0.6} style={ns} />}
      <path d={e.cowl} fill={url(dim ? 'nacd' : 'nac')} stroke={OUTLINE} strokeWidth={sw} style={ns} strokeLinejoin="round" />
      {e.accent && <path d={e.accent} fill={plain ? PLAIN_ACCENT : primary} opacity={dim ? 0.85 : 1} />}
      {full && e.seam && <path d={e.seam} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}
      {e.lip && <path d={e.lip} fill="#d3d9e3" stroke={OUTLINE} strokeWidth={sw * 0.7} style={ns} />}
      {e.dark && <path d={e.dark} fill="#1a2232" />}
      </>)}
      {part !== 'body' && e.prop && (
        <>
          <path d={e.prop.disc} fill="rgba(214,224,242,0.16)" stroke="rgba(214,224,242,0.45)" strokeWidth={0.7} style={ns} />
          <path d={e.prop.blades} fill="#2c3445" opacity={0.85} />
          <path d={e.prop.spinner} fill={url('nac')} stroke={OUTLINE} strokeWidth={sw * 0.8} style={ns} />
        </>
      )}
    </g>
  );
  // geometry is nose-left: everything is drawn inside one mirrored group, stickers un-mirrored again

  return (
    <svg
      ref={setRef}
      className={`aircraft-art${className ? ` ${className}` : ''}`}
      viewBox={`${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}`}
      preserveAspectRatio="xMidYMid meet"
      style={style}
      role="img"
      aria-label={name ? `${name} ${typeId}` : typeId}
    >
      <defs>
        <linearGradient id={id('fus')} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={f(-g.crown)} y2={f(-g.belly)}>
          {FUS_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        <linearGradient id={id('fin')} x1="0" y1="0" x2="0.8" y2="1">
          {plain ? (<>
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#f2f5f9" />
            <stop offset="1" stopColor="#c9d1dd" />
          </>) : (<>
            <stop offset="0" stopColor={mix(primary, '#ffffff', 0.16)} />
            <stop offset="0.55" stopColor={primary} />
            <stop offset="1" stopColor={mix(primary, '#000000', 0.2)} />
          </>)}
        </linearGradient>
        <linearGradient id={id('nac')} x1="0" y1="0" x2="0" y2="1">
          {NAC.map((c, i) => <stop key={i} offset={[0, 0.45, 1][i]} stopColor={c} />)}
        </linearGradient>
        <linearGradient id={id('nacd')} x1="0" y1="0" x2="0" y2="1">
          {NAC_DARK.map((c, i) => <stop key={i} offset={[0, 0.45, 1][i]} stopColor={c} />)}
        </linearGradient>
        <linearGradient id={id('wing')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={WING[0]} />
          <stop offset="1" stopColor={WING[1]} />
        </linearGradient>
        <linearGradient id={id('wsec')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2e7ef" />
          <stop offset="0.5" stopColor="#c3ccda" />
          <stop offset="1" stopColor="#a4afc1" />
        </linearGradient>
        <radialGradient id={id('sh')}>
          <stop offset="0" stopColor="rgba(16,30,58,0.3)" />
          <stop offset="1" stopColor="rgba(16,30,58,0)" />
        </radialGradient>
        <clipPath id={id('fc')}>
          <path d={g.fus} />
        </clipPath>
        <clipPath id={id('tc')}>
          <path d={g.fin.fill} />
        </clipPath>
        {g.zones && (
          <>
            <clipPath id={id('tz')}>
              <path d={g.zones.tube} />
            </clipPath>
            <clipPath id={id('wz')}>
              <path d={g.zones.wing} />
            </clipPath>
          </>
        )}
        {/* traced panes: each pane loses a band of `post` around every other pane, so touching panes keep a light post */}
        {g.cockpit.list?.map((d, i, all) => (
          <mask key={i} id={id(`pm${i}`)}>
            <path d={d} fill="#fff" />
            <path d={all.filter((_, j) => j !== i).join('')} fill="none" stroke="#000" strokeWidth={f(g.cockpit.post * 2)} />
          </mask>
        ))}
      </defs>

      <g transform={FLIP}>
      {/* far side */}
      {!sil && !g.stab.none && !g.stab.tTail && <path d={g.stab.far} fill="#b4bfce" stroke={OUTLINE} strokeWidth={sw * 0.7} style={ns} />}
      {far.map((e, i) => engine(e, i, true))}

      {/* fuselage */}
      <path d={g.fus} fill={url('fus')} />
      {/* outline mode: the wing is the part of the silhouette under the tube's belly */}
      {g.zones && <path d={g.fus} fill={url('wing')} clipPath={url('wz')} />}
      <g clipPath={url('fc')}>
        {!plain && (
          <g clipPath={g.zones ? url('tz') : undefined}>
            {lv.fus && <path d={lv.fus} fill={primary} />}
            {lv.fus2 && <path d={lv.fus2} fill={secondary} />}
          </g>
        )}
        {g.zones?.strip && <path d={g.zones.strip} fill={url('wing')} />}
        {g.zones && <path d={g.zones.seam} fill="none" stroke={OUTLINE} strokeWidth={sw * 0.7} style={ns} />}
        {g.wing.shadow && <ellipse cx={f(g.wing.shadow.c[0])} cy={f(-g.wing.shadow.c[1])} rx={f(g.wing.shadow.rx)} ry={f(g.wing.shadow.ry)} fill={url('sh')} />}
        {/* sticker pass F: fuselage (outline mode: the tube only, never the delta) */}
        {boxes.length > 0 && <g clipPath={g.zones ? url('tz') : undefined}>{boxes.map((b) => sticker(b, 'f'))}</g>}
        {g.cockpit.mask && <path d={g.cockpit.mask} fill="#0e1526" />}
      </g>
      {lod === 'band'
        ? <path d={g.windowBands} fill={WINDOW} stroke={WINDOW} strokeWidth={0.5} style={ns} />
        : <path d={g.windows} fill={WINDOW} stroke={lod === 'card' ? WINDOW : undefined} strokeWidth={lod === 'card' ? 0.35 : undefined} style={lod === 'card' ? ns : undefined} />}
      {lod === 'full'
        ? <path d={g.doors} fill="none" stroke={FINE} strokeWidth={0.55} style={ns} />
        : <path d={g.doors} fill="none" stroke={DOOR_SMALL} strokeWidth={lod === 'card' ? 0.8 : 0.7} style={ns} />}
      {full && g.lines && <path d={g.lines} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}
      {g.cockpit.list
        ? g.cockpit.list.map((d, i) => <path key={i} d={d} fill={PANE} mask={url(`pm${i}`)} />)
        : <path d={g.cockpit.panes} fill={PANE} stroke={PANE} strokeWidth={f(g.cockpit.round * 2)} strokeLinejoin="round" />}
      {g.apu && <path d={g.apu} fill="#3b4558" />}
      <path d={g.fus} fill="none" stroke={OUTLINE} strokeWidth={sw} style={ns} strokeLinejoin="round" />

      {/* fin */}
      <path d={g.fin.fill} fill={url('fin')} />
      {((!plain && lv.fin) || boxes.length > 0) && (
        <g clipPath={url('tc')}>
          {!plain && lv.fin && <path d={lv.fin} fill={secondary} />}
          {/* sticker pass T: fin */}
          {boxes.map((b) => sticker(b, 't'))}
        </g>
      )}
      {g.fin.edge && <path d={g.fin.edge} fill="none" stroke={OUTLINE} strokeWidth={sw} style={ns} strokeLinejoin="round" />}
      {full && g.fin.lines && <path d={g.fin.lines} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth={0.6} style={ns} />}

      {/* near stabiliser */}
      {!sil && !g.stab.none && (
        <>
          {g.stab.bullet && <path d={g.stab.bullet} fill={url('fin')} stroke={OUTLINE} strokeWidth={sw * 0.8} style={ns} />}
          <path d={g.stab.near} fill={url('wing')} stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />
          {full && <path d={g.stab.lines} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}
        </>
      )}

      {/* wing (a sectioned high wing goes over its slung nacelles, under the propellers) */}
      {!sil && (<>
      {g.wingRoot && <path d={g.wingRoot} fill={url('fus')} stroke={OUTLINE} strokeWidth={sw * 0.8} style={ns} />}
      {p.wing.section && near.map((e, i) => engine(e, i + far.length, !!e.spec.inboard, 'body'))}
      {/* a blended tip device fills from under the wing (whose outline stays whole) and strokes only its free edge */}
      {g.wing.tip && g.wing.tipEdge && <path d={g.wing.tip} fill={url('wing')} />}
      <path d={g.wing.fill} fill={url(p.wing.section ? 'wsec' : 'wing')} stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />
      {g.wing.shade && <path d={g.wing.shade} fill="rgba(40,58,92,0.16)" />}
      {g.wing.tip && (g.wing.tipEdge
        ? <path d={g.wing.tipEdge} fill="none" stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />
        : <path d={g.wing.tip} fill={url('wing')} stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />)}
      {full && <path d={g.wing.lines} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}
      </>)}

      {/* engines */}
      {near.map((e, i) => engine(e, i + far.length, !!e.spec.inboard, p.wing.section && !sil ? 'prop' : 'all'))}

      {/* editor: the selected sticker unclipped and faint (shows what the airframe cuts off), dashed box */}
      {sel && (
        <g pointerEvents="none">
          <g opacity={0.3}>{sticker(sel, 'g')}</g>
          <g transform={`${FLIP} translate(${f(sel.cx)} ${f(sel.cy)})${sel.rot ? ` rotate(${f(sel.rot)})` : ''}`}>
            <rect x={f(-sel.w / 2 - 0.1)} y={f(-sel.h / 2 - 0.1)} width={f(sel.w + 0.2)} height={f(sel.h + 0.2)} fill="none" stroke={SELECT} strokeWidth={1.5} strokeDasharray="5 4" style={ns} />
            {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => (
              <circle key={`${u}${v}`} cx={f(u * (sel.w / 2 + 0.1))} cy={f(v * (sel.h / 2 + 0.1))} r={f(Math.max(0.12, vb.h * 0.018))} fill="#ffffff" stroke={SELECT} strokeWidth={1.5} style={ns} />
            ))}
          </g>
        </g>
      )}
      </g>
      {guides && (
        <g pointerEvents="none" stroke={SELECT} strokeWidth={1} opacity={0.85}>
          {guides.x?.map((x) => <line key={`x${x}`} x1={f(x)} x2={f(x)} y1={f(vb.y)} y2={f(vb.y + vb.h)} style={ns} />)}
          {guides.y?.map((y) => <line key={`y${y}`} y1={f(y)} y2={f(y)} x1={f(vb.x)} x2={f(vb.x + vb.w)} style={ns} />)}
        </g>
      )}
    </svg>
  );
}

export const AircraftArt = memo(AircraftArtImpl);
