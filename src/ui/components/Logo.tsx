import { useId } from 'react';
import type { Livery } from '../../engine/core/types';
import { autoFinInk } from './aircraft/AircraftArt';
import { LogoGlyph } from './aircraft/logos';

const PLANE = 'M12 2c.8 0 1.3 1 1.3 2.2v5.3L21 14v2l-7.7-2.4v4.7l2.3 1.7v1.6L12 20.6l-3.6 1V20l2.3-1.7v-4.7L3 16v-2l7.7-4.5V4.2C10.7 3 11.2 2 12 2z';

/**
 * BLOCK HOURS mark: a chronograph dial whose sweep hand leaves the ring as a
 * flight path (chocks off → chocks on, sold by the hour). Mirrors public/favicon.svg.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id="lm-bg" cx="0.3" cy="0.2" r="1">
          <stop offset="0" stopColor="#1a2644" />
          <stop offset="1" stopColor="#090e1b" />
        </radialGradient>
        <linearGradient id="lm-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ee6ff" />
          <stop offset="1" stopColor="#6a8cff" />
        </linearGradient>
        <linearGradient id="lm-hand" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6a8cff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#lm-bg)" stroke="rgba(148,170,220,0.25)" />
      <circle cx="30.5" cy="33.5" r="16.5" stroke="rgba(148,170,220,0.16)" strokeWidth="5" fill="none" />
      <path d="M 46.58 29.79 A 16.5 16.5 0 1 1 34.21 17.42" stroke="url(#lm-ring)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M 28.3 31.3 L 32.7 35.7 L 56.9 8.9 L 55.1 7.1 Z" fill="url(#lm-hand)" />
      <circle cx="56" cy="8" r="2.6" fill="#fff" />
      <circle cx="30.5" cy="33.5" r="3.6" fill="#fff" />
      <circle cx="30.5" cy="33.5" r="1.3" fill="#0b1324" />
    </svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size, whiteSpace: 'nowrap' }}>
      BLOCK HOURS
    </span>
  );
}

/** A plane glyph pointing up (rotate to orient). */
export function PlaneGlyph({ size = 16, color = 'currentColor', rotate = 0 }: { size?: number; color?: string; rotate?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden>
      <path fill={color} d={PLANE} />
    </svg>
  );
}

export const PLANE_PATH = PLANE;

/**
 * Tail-fin emblem in the airline livery, used as the airline "logo". With `livery` it mirrors the
 * real fin (v0.5.1): scheme, plain white, code colour and weight, or the logo when one is set.
 */
export function TailBadge({ primary, secondary, code, size = 34, livery }: { primary: string; secondary: string; code: string; size?: number; livery?: Livery }) {
  const uid = useId().replace(/:/g, '');
  const lv: Livery = livery ?? { primary, secondary, tail: 'stripe' };
  const fin = lv.plain ? '#eef1f6' : lv.primary;
  const text = (lv.code?.text ?? code).toUpperCase();
  const ink = lv.code?.color ?? autoFinInk(lv);
  const FIN = 'M6 40 L20 4 L34 4 L28 40 Z';
  // scheme areas inside the badge fin (legacy badge = the accent band, kept for callers without a livery)
  const area = !livery ? 'M17 40 L27 14 L34 14 L30 40 Z'
    : lv.plain ? ''
    : lv.tail === 'split' ? 'M40 0 L40 30 C30 24 26 16 16 4 Z'
    : lv.tail === 'stripe' ? 'M0 12 L40 2 L40 7 L0 17 Z M0 21 L40 11 L40 13.5 L0 23.5 Z'
    : lv.tail === 'sweep' ? 'M4 40 L18 4 L24 4 L10 40 Z'
    : '';
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <clipPath id={`tb-${uid}`}>
          <rect width="40" height="40" rx="11" />
        </clipPath>
        <clipPath id={`tf-${uid}`}>
          <path d={FIN} />
        </clipPath>
      </defs>
      <g clipPath={`url(#tb-${uid})`}>
        <rect width="40" height="40" fill="#0d1424" />
        <path d={FIN} fill={fin} />
        <g clipPath={`url(#tf-${uid})`}>
          {area && <path d={area} fill={lv.secondary} opacity="0.95" />}
          {livery?.logo && (
            <g transform="translate(14 9) scale(0.18)"><LogoGlyph logo={livery.logo} /></g>
          )}
        </g>
      </g>
      {!livery?.logo && (
        <text
          x="20" y="36" textAnchor="middle" fontFamily="Space Grotesk Variable, sans-serif" fontWeight={lv.code?.weight ?? 700} fontSize="10"
          fill={livery ? ink : '#fff'} opacity="0.92"
          stroke={livery ? 'rgba(13,20,36,0.55)' : undefined} strokeWidth={livery ? 0.6 : undefined} paintOrder="stroke"
        >
          {text}
        </text>
      )}
    </svg>
  );
}
