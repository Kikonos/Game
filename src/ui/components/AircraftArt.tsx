// Parametric side-view illustration of an aircraft type in the airline's livery.
// Geometry is computed in metres from real dimensions and scaled via viewBox.

import { type ReactElement, useId } from 'react';
import { AIRCRAFT_BY_ID, type AircraftType } from '../../data/aircraft';
import type { Livery } from '../../engine/types';

/** Fuselage external height in metres. */
const DIAMETER: Record<string, number> = {
  atr42: 2.6, atr72: 2.6, q400: 2.7, crj900: 2.7, e175: 3.0, e190e2: 3.0, e195e2: 3.0, a220_100: 3.7, a220_300: 3.7,
  c919: 4.2, a319neo: 4.14, a320neo: 4.14, a321neo: 4.14, a321xlr: 4.14, b38m: 3.76, b3jm: 3.76, b738: 3.76,
  a320ceo: 4.14, a321ceo: 4.14, b752: 3.76, b763: 5.41, a333: 5.64, a339: 5.64, b788: 5.94, b789: 5.94, b78x: 5.94,
  a359: 6.09, a35k: 6.09, b772: 6.2, b77w: 6.2, b779: 6.2, b744: 6.5, b748: 6.5, a388: 8.4, overture: 3.2,
};

const T_TAIL = new Set(['atr42', 'atr72', 'q400', 'crj900']);

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

interface Props {
  typeId: string;
  livery: Livery;
  code?: string;
  name?: string;
  className?: string;
  gear?: boolean;
  height?: number | string;
}

export function AircraftArt({ typeId, livery, code, name, className, gear = true, height }: Props) {
  const uid = useId().replace(/:/g, '');
  const t: AircraftType = AIRCRAFT_BY_ID[typeId];
  const L = t.lengthM;
  const D = DIAMETER[typeId] ?? 4;
  const R = D / 2;
  const sst = t.body === 'supersonic';
  const jumbo747 = t.family === '747';
  const a380 = t.id === 'a388';
  const prop = t.engines === 'prop';
  const tTail = T_TAIL.has(typeId);
  const noseLen = sst ? R * 6 : prop ? R * 1.5 : R * 1.75;
  const tailLen = sst ? R * 3 : R * 3.3;
  const finH = sst ? D * 2.4 : D * (a380 ? 1.1 : prop ? 1.42 : 1.6);
  const gearH = gear ? D * (t.body === 'wide' || t.body === 'jumbo' ? 0.42 : 0.5) : 0;
  const ground = -R - gearH;

  // ---- fuselage outline (x: tail→nose, y up) ----
  const humpTop = jumbo747 ? R * 1.42 : R;
  const fus = [
    `M 0 ${R * 0.62}`,
    `C ${tailLen * 0.35} ${R * 0.85}, ${tailLen * 0.7} ${R}, ${tailLen} ${R}`,
    jumbo747
      ? `L ${L * 0.6} ${R} C ${L * 0.66} ${R}, ${L * 0.68} ${humpTop}, ${L * 0.74} ${humpTop} L ${L * 0.86} ${humpTop} C ${L * 0.93} ${humpTop}, ${L - noseLen * 0.2} ${R * 0.35}, ${L} ${-R * 0.12}`
      : `L ${L - noseLen} ${R} C ${L - noseLen * 0.35} ${R}, ${L} ${R * 0.35}, ${L} ${sst ? -R * 0.05 : -R * 0.12}`,
    `C ${L} ${-R * 0.7}, ${L - noseLen * 0.4} ${-R}, ${L - noseLen} ${-R}`,
    `L ${tailLen * 1.25} ${-R}`,
    `C ${tailLen * 0.7} ${-R}, ${tailLen * 0.3} ${R * 0.05}, 0 ${R * 0.3}`,
    'Z',
  ].join(' ');

  // ---- vertical fin ----
  const xr = tailLen * 0.12;
  const rootChord = sst ? D * 4 : D * (prop ? 1.9 : 1.75);
  const tipChord = rootChord * (sst ? 0.3 : 0.55);
  const tipRear = xr - D * 0.12;
  const fin = `M ${xr} ${R * 0.55} L ${xr + rootChord} ${R * 0.92} L ${tipRear + tipChord} ${R + finH} L ${tipRear} ${R + finH} Z`;
  const finSplit = `M ${xr + rootChord * 0.55} ${R * 0.8} L ${xr + rootChord} ${R * 0.92} L ${tipRear + tipChord} ${R + finH} L ${tipRear + tipChord * 0.35} ${R + finH} Z`;
  const finStripe = `M ${xr + rootChord * 0.28} ${R * 0.68} L ${xr + rootChord * 0.52} ${R * 0.77} L ${tipRear + tipChord * 0.62} ${R + finH} L ${tipRear + tipChord * 0.36} ${R + finH} Z`;
  const finSweep = `M ${xr - D * 0.2} ${R + finH * 0.25} C ${xr + rootChord * 0.4} ${R + finH * 0.1}, ${xr + rootChord * 0.6} ${R + finH * 0.55}, ${tipRear + tipChord + D * 0.3} ${R + finH * 0.95} L ${tipRear + tipChord + D * 0.3} ${R + finH * 1.2} L ${xr - D * 0.2} ${R + finH * 1.2} Z`;

  // ---- horizontal stabiliser ----
  const stabY = tTail ? R + finH * 0.98 : R * 0.15;
  const stabX = tTail ? tipRear + tipChord * 0.3 : tailLen * 0.15;
  const stabLen = D * (sst ? 0 : 1.6);
  const stab = `M ${stabX} ${stabY} L ${stabX + stabLen} ${stabY + D * 0.06} L ${stabX + stabLen * 0.85} ${stabY - D * 0.08} L ${stabX - D * 0.15} ${stabY - D * 0.1} Z`;

  // ---- wing (seen edge-on) ----
  const wingX = sst ? L * 0.22 : L * (prop ? 0.5 : t.engines === 'rear2' ? 0.5 : 0.47);
  const chord = sst ? L * 0.42 : L * 0.17;
  const wingY = prop ? R * 0.92 : -R * 0.55;
  const wing = sst
    ? `M ${wingX + chord} ${-R * 0.35} L ${wingX} ${-R * 0.55} L ${wingX - D * 0.2} ${-R * 0.75} L ${wingX + chord * 0.6} ${-R * 0.55} Z`
    : `M ${wingX + chord * 0.55} ${wingY + D * 0.05} L ${wingX - chord * 0.45} ${wingY - D * 0.02} L ${wingX - chord * 0.75} ${wingY - D * (prop ? 0.03 : 0.28)} L ${wingX - chord * 0.35} ${wingY - D * (prop ? 0.06 : 0.3)} Z`;

  // ---- engines ----
  const engines: ReactElement[] = [];
  const nac = (cx: number, cy: number, len: number, dia: number, key: string, far = false) => {
    const r = dia / 2;
    engines.push(
      <g key={key} opacity={far ? 0.85 : 1}>
        <path
          d={`M ${cx - len / 2} ${cy + r * 0.62} L ${cx + len / 2 - r * 0.2} ${cy + r} Q ${cx + len / 2} ${cy + r} ${cx + len / 2} ${cy} Q ${cx + len / 2} ${cy - r} ${cx + len / 2 - r * 0.2} ${cy - r} L ${cx - len / 2} ${cy - r * 0.62} Z`}
          fill={`url(#${uid}-eng)`}
          stroke="rgba(0,0,0,0.25)"
          strokeWidth={D * 0.015}
        />
        <rect x={cx + len * 0.05} y={cy - r * 0.92} width={len * 0.3} height={r * 1.84} rx={r * 0.2} fill={livery.primary} opacity="0.9" />
        <ellipse cx={cx + len / 2} cy={cy} rx={r * 0.18} ry={r * 0.92} fill="#1a2233" />
        <path d={`M ${cx - len / 2} ${cy + r * 0.45} L ${cx - len / 2 - r * 0.5} ${cy} L ${cx - len / 2} ${cy - r * 0.45} Z`} fill="#6b7489" />
      </g>,
    );
  };
  if (t.engines === 'wing2' && !sst) {
    const len = L * (t.body === 'regional' ? 0.12 : 0.115);
    const dia = D * (t.family === '777' ? 0.66 : 0.56);
    nac(wingX + chord * 0.55, -R * 0.82, len, dia, 'e1');
  } else if (t.engines === 'wing4' && !sst) {
    const len = L * 0.09;
    const dia = D * (a380 ? 0.36 : 0.45);
    nac(wingX + chord * 0.3, -R * 0.55, len * 0.92, dia * 0.9, 'e2', true);
    nac(wingX + chord * 0.65, -R * 0.85, len, dia, 'e1');
  } else if (t.engines === 'rear2') {
    engines.push(<path key="pyl" d={`M ${L * 0.19} ${R * 0.35} L ${L * 0.25} ${R * 0.35} L ${L * 0.24} ${R * 0.62} L ${L * 0.2} ${R * 0.62} Z`} fill="#c7cede" />);
    nac(L * 0.2, R * 0.75, L * 0.13, D * 0.42, 'e1');
  } else if (prop) {
    const cx = wingX + chord * 0.35;
    const cy = R * 0.62;
    const len = L * 0.2;
    const r = D * 0.2;
    engines.push(
      <g key="prop">
        <path d={`M ${cx - len / 2} ${cy + r * 0.8} L ${cx + len / 2} ${cy + r} L ${cx + len / 2} ${cy - r} L ${cx - len / 2} ${cy - r * 0.4} Z`} fill={`url(#${uid}-eng)`} stroke="rgba(0,0,0,0.2)" strokeWidth={D * 0.015} />
        <rect x={cx} y={cy - r * 0.95} width={len * 0.25} height={r * 1.9} fill={livery.primary} opacity="0.85" />
        <ellipse cx={cx + len / 2 + r * 0.25} cy={cy} rx={r * 0.32} ry={r * 0.45} fill="#2a3245" />
        <ellipse className="propdisc" cx={cx + len / 2 + r * 0.45} cy={cy} rx={r * 0.22} ry={D * 0.72} fill="rgba(200,215,240,0.10)" stroke="rgba(200,215,240,0.16)" strokeWidth={D * 0.008} />
      </g>,
    );
  } else if (sst) {
    nac(wingX + chord * 0.2, -R * 1.05, L * 0.16, D * 0.42, 'e2', true);
    nac(wingX + chord * 0.32, -R * 1.25, L * 0.16, D * 0.46, 'e1');
  }

  // ---- landing gear ----
  const gearEls: ReactElement[] = [];
  if (gear) {
    const wheel = D * 0.2;
    const main = wingX - chord * 0.15;
    const nose = L - noseLen * 1.05;
    const strut = (x: number, key: string, wheels = 2) => {
      gearEls.push(
        <g key={key}>
          <rect x={x - D * 0.03} y={ground + wheel} width={D * 0.06} height={-R - (ground + wheel) + R * 0.1} fill="#8792a8" />
          {Array.from({ length: wheels }, (_, i) => (
            <circle key={i} cx={x + (i - (wheels - 1) / 2) * wheel * 2.1} cy={ground + wheel} r={wheel} fill="#151b28" stroke="#3a4459" strokeWidth={D * 0.02} />
          ))}
        </g>,
      );
    };
    strut(main, 'mg', t.body === 'wide' || t.body === 'jumbo' ? 3 : prop || t.body === 'regional' ? 1 : 2);
    if (a380 || jumbo747) strut(main + D * 1.4, 'mg2', 2);
    strut(nose, 'ng', 1);
  }

  // ---- windows ----
  const winStart = tailLen * 1.05;
  const winEnd = L - noseLen * 1.15;
  const winY = R * (a380 ? -0.1 : 0.22);
  const winSize = D * (t.body === 'turboprop' || t.body === 'regional' ? 0.075 : 0.055);
  const winGap = Math.max(0.5, winSize * 2.9);

  // ---- bounds ----
  const minX = -D * 0.6;
  const maxX = L + D * 0.6;
  const top = R + finH + D * 0.35;
  const bottom = ground - D * 0.35;
  const vbW = maxX - minX;
  const vbH = top - bottom;

  const tail = livery.tail;
  const belly = `M 0 ${-R * 3} L ${L * 1.1} ${-R * 3} L ${L * 1.1} ${-R * 0.42} L 0 ${-R * 0.3} Z`;

  return (
    <svg
      className={`aircraft-art ${className ?? ''}`}
      viewBox={`${minX} ${-top} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ height, width: '100%' }}
      role="img"
      aria-label={t.name}
    >
      <defs>
        <linearGradient id={`${uid}-fus`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#eef2f8" />
          <stop offset="1" stopColor="#b9c2d3" />
        </linearGradient>
        <linearGradient id={`${uid}-eng`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f5fa" />
          <stop offset="1" stopColor="#9aa4b8" />
        </linearGradient>
        <linearGradient id={`${uid}-fin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(livery.primary, 30)} />
          <stop offset="1" stopColor={shade(livery.primary, -25)} />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={fus} />
        </clipPath>
        <clipPath id={`${uid}-finclip`}>
          <path d={fin} />
        </clipPath>
        <radialGradient id={`${uid}-shadow`}>
          <stop offset="0" stopColor="rgba(0,0,0,0.55)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      {gear && <ellipse cx={L * 0.5} cy={-ground + D * 0.05} rx={L * 0.48} ry={D * 0.22} fill={`url(#${uid}-shadow)`} />}
      <g transform="scale(1,-1)">
        {/* far-side wing tip & engines sit behind the fuselage */}
        {(t.engines === 'wing4' || sst) && engines.filter((e) => e.key === 'e2')}
        <path d={stab} fill="#d3d9e6" stroke="rgba(0,0,0,0.15)" strokeWidth={D * 0.01} />
        {!prop && <path d={wing} fill="#c9d0de" stroke="rgba(0,0,0,0.2)" strokeWidth={D * 0.012} />}
        {gearEls}
        {/* fuselage */}
        <path d={fus} fill={`url(#${uid}-fus)`} stroke="rgba(10,16,30,0.35)" strokeWidth={D * 0.02} />
        <g clipPath={`url(#${uid}-clip)`}>
          <path d={belly} fill={livery.primary} />
          <path d={`M 0 ${-R * 0.26} L ${L * 1.1} ${-R * 0.38} L ${L * 1.1} ${-R * 0.46} L 0 ${-R * 0.34} Z`} fill={livery.secondary} />
          <rect x={0} y={R * 0.55} width={L} height={R * 0.45} fill="rgba(255,255,255,0.35)" />
        </g>
        {/* windows */}
        <line x1={winStart} x2={winEnd} y1={winY} y2={winY} stroke="#30415f" strokeWidth={winSize * 1.25} strokeDasharray={`${winSize} ${winGap - winSize}`} strokeLinecap="round" />
        {a380 && <line x1={winStart + L * 0.04} x2={winEnd - L * 0.02} y1={R * 0.55} y2={R * 0.55} stroke="#30415f" strokeWidth={winSize * 1.25} strokeDasharray={`${winSize} ${winGap - winSize}`} strokeLinecap="round" />}
        {jumbo747 && <line x1={L * 0.76} x2={L * 0.88} y1={R * 1.12} y2={R * 1.12} stroke="#30415f" strokeWidth={winSize * 1.25} strokeDasharray={`${winSize} ${winGap - winSize}`} strokeLinecap="round" />}
        {/* doors */}
        <rect x={L - noseLen * 1.2} y={-R * 0.25} width={D * 0.16} height={R * 0.95} rx={D * 0.04} fill="none" stroke="rgba(20,30,50,0.35)" strokeWidth={D * 0.012} />
        <rect x={tailLen * 1.15} y={-R * 0.25} width={D * 0.16} height={R * 0.95} rx={D * 0.04} fill="none" stroke="rgba(20,30,50,0.35)" strokeWidth={D * 0.012} />
        {/* cockpit */}
        {jumbo747 ? (
          <path d={`M ${L * 0.885} ${R * 1.25} L ${L * 0.915} ${R * 1.1} L ${L * 0.935} ${R * 0.98} L ${L * 0.9} ${R * 1.02} Z`} fill="#0e1729" />
        ) : (
          <path d={`M ${L - noseLen * 0.82} ${R * 0.58} L ${L - noseLen * 0.38} ${R * 0.48} L ${L - noseLen * 0.22} ${R * 0.22} L ${L - noseLen * 0.8} ${R * 0.32} Z`} fill="#0e1729" />
        )}
        {/* name */}
        {name && !sst && (
          <text x={L * (prop ? 0.3 : 0.42)} y={-R * (a380 ? 0.95 : jumbo747 ? 0.7 : 0.62)} transform="scale(1,-1)" fontFamily="Space Grotesk Variable, sans-serif" fontWeight="700" fontSize={R * (a380 ? 0.42 : 0.5)} fill={livery.primary} textAnchor="middle" letterSpacing={R * 0.04}>
            {name.toUpperCase()}
          </text>
        )}
        {/* fin & livery */}
        <path d={fin} fill={`url(#${uid}-fin)`} stroke="rgba(10,16,30,0.35)" strokeWidth={D * 0.02} />
        <g clipPath={`url(#${uid}-finclip)`}>
          {tail === 'split' && <path d={finSplit} fill={livery.secondary} />}
          {tail === 'stripe' && <path d={finStripe} fill={livery.secondary} />}
          {tail === 'sweep' && <path d={finSweep} fill={livery.secondary} />}
        </g>
        {code && (
          <text x={xr + rootChord * 0.62} y={-(R + finH * 0.42)} transform="scale(1,-1)" fontFamily="Space Grotesk Variable, sans-serif" fontWeight="700" fontSize={finH * 0.26} fill={livery.secondary} textAnchor="middle" opacity="0.95">
            {code}
          </text>
        )}
        {tTail && <path d={stab} fill="#d3d9e6" stroke="rgba(0,0,0,0.15)" strokeWidth={D * 0.01} />}
        {prop && <path d={wing} fill="#c9d0de" stroke="rgba(0,0,0,0.2)" strokeWidth={D * 0.012} />}
        {engines.filter((e) => e.key !== 'e2' || (t.engines !== 'wing4' && !sst))}
      </g>
    </svg>
  );
}
