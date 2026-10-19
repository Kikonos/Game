// Cartoon-clean side profile of an aircraft type in the airline's livery, nose
// left. Geometry comes from real-dimension specs (metres) via geometry.ts; this
// component only assigns colours, z-order and level of detail.

import { memo, useId } from 'react';
import type { Livery } from '../../../engine/types';
import { geometry, type Geometry } from './geometry';
import { PROFILE_BY_ID } from './specs';
import type { AircraftProfile } from './types';

export interface AircraftArtProps {
  typeId: string;
  livery: Livery;
  /** Airline code painted on the fin. */
  code?: string;
  /** Airline name painted as titles on the forward fuselage. */
  name?: string;
  className?: string;
  gear?: boolean;
  height?: number | string;
  /** 'simple' drops windows, doors, titles and fine lines for ~90px thumbnails. */
  detail?: 'full' | 'simple';
  /** Fixed scale in CSS px per metre (sets both width and height) — for same-scale comparisons. */
  pxPerM?: number;
}

const FALLBACK = 'a320neo';

export function profileFor(typeId: string): AircraftProfile {
  return PROFILE_BY_ID[typeId] ?? PROFILE_BY_ID[FALLBACK];
}

/** Tight viewBox in SVG units (metres, y down). */
export function artViewBox(typeId: string, gear = true): { x: number; y: number; w: number; h: number } {
  const g = geometry(profileFor(typeId));
  const b = gear ? g.boxGear : g.box;
  const pad = Math.max(0.15, g.L * 0.01);
  return { x: b.x0 - pad, y: -(b.y1 + pad), w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad };
}

// ---------- colour helpers (hex in, hex out; anything else passes through) ----------

function rgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

function lum(c: string): number {
  const x = rgb(c);
  if (!x) return 0.5;
  const [r, g, b] = x.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const f = (n: number) => Math.round(n * 100) / 100;

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

function AircraftArtImpl({ typeId, livery, code, name, className, gear = true, height, detail = 'full', pxPerM }: AircraftArtProps) {
  const uid = useId().replace(/:/g, '');
  const p = profileFor(typeId);
  const g: Geometry = geometry(p);
  const full = detail === 'full';
  const vb = artViewBox(typeId, gear);
  const lv = g.livery(livery.tail);
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;
  const sw = full ? 1 : 0.75;
  const ns = { vectorEffect: 'non-scaling-stroke' as const };

  const primary = livery.primary;
  const secondary = livery.secondary;
  // fin code: second colour when it reads against the fin, else white / ink
  const codeFill = contrast(secondary, primary) >= 2.2 ? secondary : lum(primary) < 0.4 ? '#ffffff' : INK;
  // titles: primary unless it vanishes on white
  const titleFill = contrast(primary, '#ffffff') >= 1.6 ? primary : contrast(secondary, '#ffffff') >= 1.6 ? secondary : INK;

  const style = pxPerM ? { width: vb.w * pxPerM, height: vb.h * pxPerM } : { height, width: '100%' };

  // titles sized to the band above the windows, shrunk to fit the available length
  const title = name?.trim().toUpperCase();
  let titleSize = g.titles.size;
  if (title) titleSize = Math.min(titleSize, g.titles.w / (title.length * 0.7 + 0.2));
  const codeText = code?.trim().toUpperCase();
  const codeSize = codeText ? Math.min(lv.code.size, lv.code.w / (codeText.length * 0.64)) : 0;

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
      {e.accent && <path d={e.accent} fill={primary} opacity={dim ? 0.85 : 1} />}
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
  const gearEls = gear && (
    <g>
      <path d={g.gear.struts} fill="#a3adbd" stroke={OUTLINE} strokeWidth={sw * 0.6} style={ns} />
      <path d={g.gear.tyres} fill="#222a3a" stroke="#56627a" strokeWidth={sw * 0.8} style={ns} />
      <path d={g.gear.hubs} fill="#b4bdcc" />
    </g>
  );

  return (
    <svg
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
          <stop offset="0" stopColor={mix(primary, '#ffffff', 0.16)} />
          <stop offset="0.55" stopColor={primary} />
          <stop offset="1" stopColor={mix(primary, '#000000', 0.2)} />
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
      </defs>

      {/* far side */}
      {!g.stab.none && !g.stab.tTail && <path d={g.stab.far} fill="#b4bfce" stroke={OUTLINE} strokeWidth={sw * 0.7} style={ns} />}
      {far.map((e, i) => engine(e, i, true))}

      {/* fuselage */}
      <path d={g.fus} fill={url('fus')} />
      <g clipPath={url('fc')}>
        {lv.fus && <path d={lv.fus} fill={primary} />}
        {lv.fus2 && <path d={lv.fus2} fill={secondary} />}
        <ellipse cx={f(g.wing.shadow.c[0])} cy={f(-g.wing.shadow.c[1])} rx={f(g.wing.shadow.rx)} ry={f(g.wing.shadow.ry)} fill={url('sh')} />
        {full && title && (
          <text
            x={f(g.titles.x)}
            y={f(-g.titles.y)}
            fontSize={f(titleSize)}
            fill={titleFill}
            dominantBaseline="central"
            style={{ fontFamily: "var(--font-display, 'Space Grotesk Variable', sans-serif)", fontWeight: 700, letterSpacing: '0.04em' }}
          >
            {title}
          </text>
        )}
      </g>
      {full && <path d={g.windows} fill={WINDOW} />}
      {full && <path d={g.doors} fill="none" stroke={FINE} strokeWidth={0.7} style={ns} />}
      {full && g.lines && <path d={g.lines} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}
      {g.cockpit.mask && <path d={g.cockpit.mask} fill="#0e1526" />}
      <path d={g.cockpit.panes} fill={PANE} stroke={PANE} strokeWidth={f(g.cockpit.round * 2)} strokeLinejoin="round" />
      {g.apu && <path d={g.apu} fill="#3b4558" />}
      <path d={g.fus} fill="none" stroke={OUTLINE} strokeWidth={sw} style={ns} strokeLinejoin="round" />

      {/* fin */}
      <path d={g.fin.fill} fill={url('fin')} />
      {lv.fin && (
        <g clipPath={url('tc')}>
          <path d={lv.fin} fill={secondary} />
        </g>
      )}
      {codeText && (
        <text
          x={f(lv.code.x)}
          y={f(-lv.code.y)}
          fontSize={f(codeSize)}
          fill={codeFill}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontFamily: "var(--font-display, 'Space Grotesk Variable', sans-serif)", fontWeight: 700, letterSpacing: '0.02em' }}
        >
          {codeText}
        </text>
      )}
      <path d={g.fin.edge} fill="none" stroke={OUTLINE} strokeWidth={sw} style={ns} strokeLinejoin="round" />
      {full && g.fin.lines && <path d={g.fin.lines} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth={0.6} style={ns} />}

      {/* near stabiliser */}
      {!g.stab.none && (
        <>
          {g.stab.bullet && <path d={g.stab.bullet} fill={url('fin')} stroke={OUTLINE} strokeWidth={sw * 0.8} style={ns} />}
          <path d={g.stab.near} fill={url('wing')} stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />
          {full && <path d={g.stab.lines} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}
        </>
      )}

      {!g.gear.fromNacelle && gearEls}

      {/* wing (a sectioned high wing goes over its slung nacelles, under the propellers) */}
      {g.wingRoot && <path d={g.wingRoot} fill={url('fus')} stroke={OUTLINE} strokeWidth={sw * 0.8} style={ns} />}
      {p.wing.section && near.map((e, i) => engine(e, i + far.length, !!e.spec.inboard, 'body'))}
      <path d={g.wing.fill} fill={url(p.wing.section ? 'wsec' : 'wing')} stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />
      {g.wing.shade && <path d={g.wing.shade} fill="rgba(40,58,92,0.16)" />}
      {g.wing.tip && <path d={g.wing.tip} fill={url('wing')} stroke={OUTLINE} strokeWidth={sw * 0.9} style={ns} strokeLinejoin="round" />}
      {full && <path d={g.wing.lines} fill="none" stroke={FINE} strokeWidth={0.6} style={ns} />}

      {/* engines */}
      {near.map((e, i) => engine(e, i + far.length, !!e.spec.inboard, p.wing.section ? 'prop' : 'all'))}

      {g.gear.fromNacelle && gearEls}
    </svg>
  );
}

export const AircraftArt = memo(AircraftArtImpl);
