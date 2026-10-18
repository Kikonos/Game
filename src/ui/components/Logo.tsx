const PLANE = 'M12 2c.8 0 1.3 1 1.3 2.2v5.3L21 14v2l-7.7-2.4v4.7l2.3 1.7v1.6L12 20.6l-3.6 1V20l2.3-1.7v-4.7L3 16v-2l7.7-4.5V4.2C10.7 3 11.2 2 12 2z';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lm-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3ee6ff" stopOpacity="0" />
          <stop offset="0.55" stopColor="#3ee6ff" />
          <stop offset="1" stopColor="#8b5cff" />
        </linearGradient>
        <radialGradient id="lm-bg" cx="0.3" cy="0.2" r="1">
          <stop offset="0" stopColor="#1a2644" />
          <stop offset="1" stopColor="#090e1b" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#lm-bg)" stroke="rgba(148,170,220,0.25)" />
      <path d="M7 54 C 22 52, 35 42, 42 25" stroke="url(#lm-trail)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <g transform="translate(45.5 19) rotate(24) scale(1.05) translate(-12 -12)">
        <path fill="#fff" d={PLANE} />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      CONTRAIL
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

/** Tail-fin emblem in the airline livery, used as the airline "logo". */
export function TailBadge({ primary, secondary, code, size = 34 }: { primary: string; secondary: string; code: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <clipPath id={`tb-${code}`}>
          <rect width="40" height="40" rx="11" />
        </clipPath>
      </defs>
      <g clipPath={`url(#tb-${code})`}>
        <rect width="40" height="40" fill="#0d1424" />
        <path d="M6 40 L20 4 L34 4 L28 40 Z" fill={primary} />
        <path d="M17 40 L27 14 L34 14 L30 40 Z" fill={secondary} opacity="0.95" />
      </g>
      <text x="20" y="36" textAnchor="middle" fontFamily="Space Grotesk Variable, sans-serif" fontWeight="700" fontSize="10" fill="#fff" opacity="0.92">
        {code}
      </text>
    </svg>
  );
}
