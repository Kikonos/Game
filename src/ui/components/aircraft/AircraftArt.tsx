// Side profile of an aircraft in the airline's livery, nose RIGHT, in flight: the player's final raster art
// (public/aircraft/) with the livery painted on through its own lighting (compose.ts, v0.11): fin, fuselage and
// engine cowls, and the stickers (tail code, titles, logos) painted in with them as decals. The livery editor's
// selected sticker is drawn live as SVG on top (clipped to the fin and the fuselage zone) while it is being moved;
// so are all stickers until the painted bitmap is ready.
// The SVG's viewBox is the sprite's 2048-scale pixel frame, so the livery editor maps pointers through it.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Livery } from '../../../engine/core/types';
import { compose, composedNow, paintKey, type Decal } from './compose';
import { FONT_STACK } from './fontMetrics';
import { LogoGlyph } from './logos';
import { assetFor, layoutOf, metresPerPx, MODEL_NAME, spriteOf, type AssetWidth } from './sprites';
import { stickerInk } from './stickerInk';
import { airframeClipPaths, extraDecals, stickerLayout, type StickerBox } from './stickers';

export { autoBodyInk, autoFinInk, contrast, lum, mix } from './ink';
export { stickerGround, stickerInk } from './stickerInk';

export interface AircraftArtProps {
  /** A sprite id (artFor(typeId, variant)) or an ACMI type id. */
  typeId: string;
  livery: Livery;
  /** Default code text for the fin (livery.code.text wins). */
  code?: string;
  /** Default titles text on the forward fuselage (livery.titles.text wins). */
  name?: string;
  /** v0.11 the aircraft's registration, painted small on the rear fuselage (livery.reg hides it). */
  reg?: string;
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

const SELECT = '#3ee6ff';
const f = (n: number) => Math.round(n * 100) / 100;
const dpr = (): number => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

function AircraftArtImpl({ typeId, livery, code, name, reg, className, height, detail = 'full', pxPerM, svgRef, selected, guides }: AircraftArtProps) {
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
  const boxes = stickerLayout(sprite, livery, { code, name }, detail);
  // every sticker but the one being edited is painted into the bitmap
  const decals: Decal[] = [
    ...boxes.filter((b) => b.id !== selected).map((b): Decal => ({ ...b, ink: b.kind === 'logo' ? undefined : (b.kind === 'code' ? livery.code : livery.titles)?.color ?? stickerInk(sprite, livery, b) })),
    ...extraDecals(sprite, livery, { reg, model: MODEL_NAME[sprite], fine: detail === 'full' && asset >= 2048 }),
  ];
  const key = paintKey(livery, decals) ?? '';
  // the bitmap with the sprite and paint it shows (another type's bitmap is never stretched into this frame)
  const [shown, setShown] = useState<{ sprite: string; key: string; url?: string }>(() => ({ sprite, key, url: composedNow(sprite, asset, livery, decals) }));
  useEffect(() => {
    const now = composedNow(sprite, asset, livery, decals);
    if (now) { setShown({ sprite, key, url: now }); return; }
    let live = true;
    compose(sprite, asset, livery, decals).then((u) => { if (live) setShown({ sprite, key, url: u }); }, () => { /* missing asset: the stickers still draw */ });
    return () => { live = false; };
    // the paint key holds every colour and decal the bitmap depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite, asset, key]);

  const url = shown.sprite === sprite ? shown.url : undefined;
  // until this paint's bitmap is ready, the stickers are drawn flat on top (an older bitmap may lack them)
  const live = url && shown.key === key ? boxes.filter((b) => b.id === selected) : boxes;
  const style = pxPerM ? { width: vb.w * mpp * pxPerM, height: vb.h * mpp * pxPerM } : { height, width: '100%' };
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
      {live.length > 0 && (
        <>
          <g clipPath={`url(#${id('fz')})`}>{live.map((b) => sticker(b, 'f'))}</g>
          <g clipPath={`url(#${id('tc')})`}>{live.map((b) => sticker(b, 't'))}</g>
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
