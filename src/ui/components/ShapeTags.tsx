// v0.18 the body and haul of a job at a glance (contracts/shape.ts): 'Widebody' and 'Long-haul' with a four-step
// meter, on every offer and contract card and in the offer dialog. `short` uses the short words (cards on a phone).

import { BODY_LABEL, HAUL_LABEL, HAULS, haulTip, type Shape } from '../../engine/contracts/shape';

const SHORT_HAUL: Record<NonNullable<Shape['haul']>, string> = { short: 'Short', medium: 'Medium', long: 'Long', ultra: 'Ultra-long' };

export function ShapeTags({ s, compact, className = '' }: { s: Shape; compact?: boolean; className?: string }) {
  const step = s.haul ? HAULS.indexOf(s.haul) + 1 : 0;
  return (
    <span className={`shape-tags ${className}`}>
      <span className={`shape-tag body-${s.body}`} data-tip={s.body === 'wide' ? 'Needs a widebody (twin aisle)' : 'A narrowbody job (single aisle)'}>{BODY_LABEL[s.body]}</span>
      {s.haul && (
        <span className={`shape-tag haul-${s.haul}`} data-tip={haulTip(s)}>
          <span className="shape-meter" aria-hidden="true">{HAULS.map((h, i) => <i key={h} className={i < step ? 'on' : ''} />)}</span>
          {compact ? SHORT_HAUL[s.haul] : HAUL_LABEL[s.haul]}
        </span>
      )}
    </span>
  );
}
