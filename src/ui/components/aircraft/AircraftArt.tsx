// Side profile of an aircraft in the airline's livery, nose RIGHT, in flight: the player's final raster art
// (v0.10, public/aircraft/), untouched except for the livery tint on the fin and the engines (compose.ts), with
// the stickers (tail code, titles, logos) drawn on top as SVG, clipped to the fin and to the fuselage zone.
// The SVG's viewBox is the sprite's 2048-scale pixel frame, so the livery editor maps pointers through it.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Livery } from '../../../engine/core/types';
import { compose, composedNow, tintKey } from './compose';
import { FONT_STACK } from './fontMetrics';
import { autoBodyInk, autoFinInk, contrast, INK, lum } from './ink';
import { LogoGlyph } from './logos';
import { bodyColourAt, finStripeAt } from './bodyPaint';
import { assetFor, layoutOf, metresPerPx, spriteOf, type AssetWidth } from './sprites';
import { airframeClipPaths, boxSamples, onFinSecond, sideAt, stickerLayout, type StickerBox } from './stickers';

export { autoBodyInk, autoFinInk, contrast, lum, mix } from './ink';

export interface AircraftArtProps {
  /** A sprite id (artFor(typeId, variant)) or an ACMI type id. */
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
  /** 'simple' drops the fuselage titles for ~90px thumbnails. */
  detail?: 'full' | 'simple';
  /** Fixed scale in CSS px per metre of the real aircraft (sets width and height) — for same-scale comparisons. */
  pxPerM?: number;
  /** Livery editor only: the <svg> element (pointer → viewBox mapping). */
  svgRef?: Ref<SVGSVGElement>;
  /** Livery editor only: sticker id drawn with a dashed box and an unclipped ghost. */
  selected?: string;
  /** Livery editor only: snap guides in viewBox coords (thin cyan lines). */
  guides?: { x?: number[]; y?: number[] };
}

/** viewBox of a sprite or type: the 2048-scale pixel frame of its asset. */
export function artViewBox(typeId: string, _gear?: boolean): { x: number; y: number; w: number; h: number } {
  const d = layoutOf(typeId);
  return { x: 0, y: 0, w: d.w, h: d.h };
}

/** Paint a sticker can sit on: a colour (hex). v0.10: the fuselage may carry body paint (bodyPaint.ts). */
type Ground = string;

/** Lettering on the scheme's second colour: primary, else white / ink. */
function inkOnSecondary(lv: Livery): string {
  return contrast(lv.primary, lv.secondary) >= 2.2 ? lv.primary : lum(lv.secondary) < 0.4 ? '#ffffff' : INK;
}
/** The usual lettering colour on a ground: as before v0.10 on white, the fin colour and its second colour; on body
 *  paint the livery colour that reads best (the tail colours first), else white or ink. */
function inkOn(lv: Livery, gr: Ground): string {
  if (gr === '#ffffff') return autoBodyInk(lv);
  if (!lv.plain && gr === lv.primary) return autoFinInk(lv);
  if (!lv.plain && gr === lv.secondary) return inkOnSecondary(lv);
  const pool = [lv.primary, lv.secondary, '#ffffff', INK].filter((c) => c !== gr);
  const good = pool.find((c) => contrast(c, gr) >= 3);
  return good ?? pool.reduce((a, c) => (contrast(c, gr) > contrast(a, gr) ? c : a));
}

/** Paint under a viewBox point: the fin's scheme colours, the fuselage's body paint (white as drawn); null off the airframe. */
function groundAt(typeId: string, lv: Livery, X: number, Y: number): Ground | null {
  const side = sideAt(typeId, X, Y);
  if (!side) return null;
  if (side === 'fuselage') return bodyColourAt(typeId, lv, X, Y);
  if (lv.plain) return '#ffffff';
  return finStripeAt(typeId, lv, X, Y) ?? (onFinSecond(typeId, lv.tail, X, Y) ? lv.secondary : lv.primary);
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
 * Auto lettering colour for a sticker box: the usual ink of the ground under most of it; when it straddles
 * grounds (≥ 10 % each) and that ink fails on one, the colour with the best worst-case contrast.
 */
export function stickerInk(typeId: string, lv: Livery, b: StickerBox): string {
  const sig = groundsUnder(typeId, lv, b).filter(([, s]) => s >= 0.1);
  if (!sig.length) return b.side === 'fin' ? autoFinInk(lv) : autoBodyInk(lv);
  const pref = inkOn(lv, sig[0][0]);
  if (sig.length === 1) return pref;
  const score = (c: string) => Math.min(...sig.map(([gr]) => contrast(c, gr)));
  if (score(pref) >= 2.2) return pref;
  const best = [lv.secondary, lv.primary, '#ffffff', INK].reduce((a, c) => (score(c) > score(a) + 0.01 ? c : a));
  return score(best) >= 3 || sig[0][1] < 0.6 ? best : pref;
}

/** Background a sticker sits on (for contrast warnings): with its box, the paint under most of it; else the fin colour or white. */
export function stickerGround(lv: Livery, side: 'fin' | 'fuselage', at?: { typeId: string; box: StickerBox }): string {
  const top = at && groundsUnder(at.typeId, lv, at.box)[0];
  if (top) return top[0];
  return side === 'fin' && !lv.plain ? lv.primary : '#ffffff';
}

const SELECT = '#3ee6ff';
const f = (n: number) => Math.round(n * 100) / 100;
const dpr = (): number => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

function AircraftArtImpl({ typeId, livery, code, name, className, height, detail = 'full', pxPerM, svgRef, selected, guides }: AircraftArtProps) {
  const uid = useId().replace(/:/g, '');
  const sprite = spriteOf(typeId);
  const vb = artViewBox(sprite);
  const el = useRef<SVGSVGElement | null>(null);
  const setRef = useCallback((n: SVGSVGElement | null) => {
    el.current = n;
    if (typeof svgRef === 'function') svgRef(n);
    else if (svgRef) (svgRef as { current: SVGSVGElement | null }).current = n;
  }, [svgRef]);
  const mpp = metresPerPx(sprite);
  // asset width: from the drawn size in device px (only ever steps up)
  const guess = pxPerM ? vb.w * mpp * pxPerM : typeof height === 'number' ? (height / vb.h) * vb.w : 0;
  const [asset, setAsset] = useState<AssetWidth>(() => assetFor(guess * dpr()));
  useLayoutEffect(() => {
    const n = el.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const take = (w: number, h: number) => {
      if (!(w > 0 && h > 0)) return;
      const drawn = Math.min(w, (h / vb.h) * vb.w) * dpr();
      const a = assetFor(drawn);
      setAsset((cur) => (a > cur ? a : cur));
    };
    take(n.clientWidth, n.clientHeight);
    const ro = new ResizeObserver((es) => es.forEach((e) => take(e.contentRect.width, e.contentRect.height)));
    ro.observe(n);
    return () => ro.disconnect();
  }, [vb.w, vb.h]);
  const tint = tintKey(livery);
  // the bitmap with the sprite it shows (another type's bitmap is never stretched into this frame)
  const [shown, setShown] = useState<{ sprite: string; url?: string }>(() => ({ sprite, url: composedNow(sprite, asset, livery) }));
  useEffect(() => {
    const now = composedNow(sprite, asset, livery);
    if (now) { setShown({ sprite, url: now }); return; }
    let live = true;
    compose(sprite, asset, livery).then((u) => { if (live) setShown({ sprite, url: u }); }, () => { /* missing asset: the stickers still draw */ });
    return () => { live = false; };
    // the tint key holds every colour the bitmap depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite, asset, tint]);

  const url = shown.sprite === sprite ? shown.url : undefined;
  const style = pxPerM ? { width: vb.w * mpp * pxPerM, height: vb.h * mpp * pxPerM } : { height, width: '100%' };
  const boxes = stickerLayout(sprite, livery, { code, name }, detail);
  const [zone, fin] = airframeClipPaths(sprite);
  const id = (k: string) => `${uid}-${k}`;
  const sticker = (b: StickerBox, pass: string) => {
    const tf = `translate(${f(b.cx)} ${f(b.cy)})${b.rot ? ` rotate(${f(b.rot)})` : ''}`;
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
          fill={t?.color ?? stickerInk(sprite, livery, b)}
          textAnchor="middle"
          style={{ fontFamily: FONT_STACK, fontWeight: b.weight ?? 700, letterSpacing: `${b.spacing ?? 0}em` }}
        >
          {b.text}
        </text>
      </g>
    );
  };
  const sel = selected ? boxes.find((b) => b.id === selected) : undefined;
  const ns = { vectorEffect: 'non-scaling-stroke' as const };

  return (
    <svg
      ref={setRef}
      className={`aircraft-art${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={style}
      role="img"
      aria-label={name ? `${name} ${sprite}` : sprite}
      data-sprite={sprite}
    >
      <defs>
        <clipPath id={id('fz')}><path d={zone} /></clipPath>
        <clipPath id={id('tc')}><path d={fin} /></clipPath>
      </defs>
      <image
        href={url} x={0} y={0} width={vb.w} height={vb.h} preserveAspectRatio="none"
        style={{ opacity: url ? 1 : 0, transition: 'opacity 120ms ease-out' }}
      />
      {boxes.length > 0 && (
        <>
          <g clipPath={`url(#${id('fz')})`}>{boxes.map((b) => sticker(b, 'f'))}</g>
          <g clipPath={`url(#${id('tc')})`}>{boxes.map((b) => sticker(b, 't'))}</g>
        </>
      )}
      {/* editor: the selected sticker unclipped and faint (shows what the airframe cuts off), dashed box */}
      {sel && (
        <g pointerEvents="none">
          <g opacity={0.3}>{sticker(sel, 'g')}</g>
          <g transform={`translate(${f(sel.cx)} ${f(sel.cy)})${sel.rot ? ` rotate(${f(sel.rot)})` : ''}`}>
            <rect x={f(-sel.w / 2 - 2)} y={f(-sel.h / 2 - 2)} width={f(sel.w + 4)} height={f(sel.h + 4)} fill="none" stroke={SELECT} strokeWidth={1.5} strokeDasharray="5 4" style={ns} />
            {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => (
              <circle key={`${u}${v}`} cx={f(u * (sel.w / 2 + 2))} cy={f(v * (sel.h / 2 + 2))} r={f(Math.max(3, vb.h * 0.012))} fill="#ffffff" stroke={SELECT} strokeWidth={1.5} style={ns} />
            ))}
          </g>
        </g>
      )}
      {guides && (
        <g pointerEvents="none" stroke={SELECT} strokeWidth={1} opacity={0.85}>
          {guides.x?.map((x) => <line key={`x${x}`} x1={f(x)} x2={f(x)} y1={0} y2={vb.h} style={ns} />)}
          {guides.y?.map((y) => <line key={`y${y}`} y1={f(y)} y2={f(y)} x1={0} x2={vb.w} style={ns} />)}
        </g>
      )}
    </svg>
  );
}

/** Shallow props compare. */
const sameProps = (a: AircraftArtProps, b: AircraftArtProps): boolean => {
  const ka = Object.keys(a) as (keyof AircraftArtProps)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
};
export const AircraftArt = memo(AircraftArtImpl, sameProps);
