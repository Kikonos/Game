// v0.12 Visual B: rank marks beside crew names, as worn on the uniform. Pilots: a shoulder epaulette with gold stripes
// (captain 4, first officer 3, relief pilot 2: the second officer's two). Cabin crew: wings — gold with a crest for the
// purser (the cabin manager), silver for cabin crew. Small and static (one tiny SVG, no state).
// v0.14 a more modern cut: one stroke weight (RANK_BAR) for every stripe and feather, round caps, flat muted gold and
// silver; the epaulette a slim navy board with a soft point at the collar, its stripes floating inside it; the wings
// three swept feathers a side (the same bars), a ring for the purser and a dot for cabin crew between them.

import { memo } from 'react';
import type { Role } from '../../engine/core/types';
import { ROLE_LABEL } from '../screens/screenLogic';

/** Gold stripes on a pilot's epaulette (0 for cabin crew). */
export const RANK_STRIPES: Record<Role, number> = { CPT: 4, FO: 3, CRP: 2, PUR: 0, CC: 0 };

/** v0.14 every stripe and feather is one bar of this weight (viewBox units, 1 = 1 px at the default size). */
export const RANK_BAR = 1.8;
/** v0.14 stripe pitch: a bar and a gap as wide. */
const PITCH = RANK_BAR * 2;

/** Stripe x positions (in a 26 × 12 epaulette, collar point at the left): spaced evenly from the shoulder end. Pure. */
export function stripeXs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((21.5 - i * PITCH) * 100) / 100);
  return out;
}

/** v0.14 one wing's feathers (the left; the right is its mirror) as [x0, y0, x1, y1] lines, root to tip, swept up. Pure. */
export function wingFeathers(): [number, number, number, number][] {
  // Longest on top, each a bar shorter and lower; the tips rise by about a fifth of their length.
  return [[9.4, 4.3, 1.2, 2.4], [9.4, 6.5, 3.0, 5.0], [9.4, 8.7, 4.8, 7.6]];
}

// Board: rounded at the shoulder seam (right), a soft point at the collar (left).
const BOARD = 'M5.5 1.5H23.5A1.5 1.5 0 0 1 25 3V9A1.5 1.5 0 0 1 23.5 10.5H5.5L1.5 6Z';

function RankMarkImpl({ role, className }: { role: Role; className?: string }) {
  const n = RANK_STRIPES[role];
  const what = n ? `${ROLE_LABEL[role]}: ${n} stripes` : `${ROLE_LABEL[role]} wings`;
  if (n) {
    return (
      <svg className={`rank-mark rank-ep ${className ?? ''}`} width={26} height={12} viewBox="0 0 26 12" role="img" aria-label={what}>
        <title>{what}</title>
        <path className="rank-ep-body" d={BOARD} />
        {stripeXs(n).map((x) => <line key={x} className="rank-bar" x1={x} y1={3.4} x2={x} y2={8.6} strokeWidth={RANK_BAR} />)}
      </svg>
    );
  }
  const gold = role === 'PUR';
  const lines = wingFeathers();
  return (
    <svg className={`rank-mark rank-wings ${gold ? 'gold' : 'silver'} ${className ?? ''}`} width={26} height={12} viewBox="0 0 26 12" role="img" aria-label={what}>
      <title>{what}</title>
      {lines.map(([x0, y0, x1, y1]) => <line key={`l${y0}`} className="rank-bar" x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={RANK_BAR} />)}
      {lines.map(([x0, y0, x1, y1]) => <line key={`r${y0}`} className="rank-bar" x1={26 - x0} y1={y0} x2={26 - x1} y2={y1} strokeWidth={RANK_BAR} />)}
      {gold ? <circle className="rank-crest" cx={13} cy={6.2} r={1.9} strokeWidth={1.2} /> : <circle className="rank-dot" cx={13} cy={6.2} r={1.3} />}
    </svg>
  );
}

export const RankMark = memo(RankMarkImpl);
