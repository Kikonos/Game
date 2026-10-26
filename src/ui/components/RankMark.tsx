// v0.12 Visual B: rank marks beside crew names, as worn on the uniform. Pilots: a shoulder epaulette with gold stripes
// (captain 4, first officer 3, relief pilot 2: the second officer's two). Cabin crew: wings — gold with a crest for the
// purser (the cabin manager), silver for cabin crew. Small and static (one tiny SVG, no state).

import { memo } from 'react';
import type { Role } from '../../engine/core/types';
import { ROLE_LABEL } from '../screens/screenLogic';

/** Gold stripes on a pilot's epaulette (0 for cabin crew). */
export const RANK_STRIPES: Record<Role, number> = { CPT: 4, FO: 3, CRP: 2, PUR: 0, CC: 0 };

/** Stripe x positions (in a 26 × 12 epaulette, button at the left): spaced evenly towards the shoulder end. Pure. */
export function stripeXs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(23 - i * 3.6);
  return out;
}

const WING = 'M11 5.2C8.6 3.6 5 3 0.6 3.4c1.2 0.7 2.4 1.2 3.8 1.5C3 5 1.8 5.2 0.9 5.6c1.6 0.4 3.2 0.6 4.8 0.5C4.6 6.4 3.6 6.8 2.8 7.3c2.8 0.3 5.6-0.3 8.2-1.4z';

function RankMarkImpl({ role, className }: { role: Role; className?: string }) {
  const n = RANK_STRIPES[role];
  const what = n ? `${ROLE_LABEL[role]}: ${n} stripes` : `${ROLE_LABEL[role]} wings`;
  if (n) {
    return (
      <svg className={`rank-mark rank-ep ${className ?? ''}`} width={26} height={12} viewBox="0 0 26 12" role="img" aria-label={what}>
        <title>{what}</title>
        {/* the epaulette: square at the shoulder seam (right), rounded at the collar with its button (left) */}
        <path className="rank-ep-body" d="M5 0.5H25.5V11.5H5A5.5 5.5 0 0 1 5 0.5Z" />
        <circle className="rank-ep-btn" cx={5.2} cy={6} r={1.7} />
        {stripeXs(n).map((x) => <rect key={x} className="rank-ep-stripe" x={x - 1} y={0.5} width={2} height={11} />)}
      </svg>
    );
  }
  const gold = role === 'PUR';
  return (
    <svg className={`rank-mark rank-wings ${gold ? 'gold' : 'silver'} ${className ?? ''}`} width={22} height={10} viewBox="0 0 22 10" role="img" aria-label={what}>
      <title>{what}</title>
      <path d={WING} />
      <path d={WING} transform="translate(22 0) scale(-1 1)" />
      {gold ? <circle className="rank-crest" cx={11} cy={5.2} r={2.4} /> : <circle cx={11} cy={5.4} r={1.4} />}
    </svg>
  );
}

export const RankMark = memo(RankMarkImpl);
