// v0.18 the body and haul of a job at a glance (contracts/shape.ts): 'Widebody' and 'Long-haul' with a four-step
// meter, on every offer and contract card and in the offer dialog. `short` uses the short words (cards on a phone).

import { LEAD_NOTE, TENDER_NOTE, type OriginView } from '../../engine/commercial';
import { BODY_LABEL, HAUL_LABEL, HAULS, haulTip, type Shape } from '../../engine/contracts/shape';
import { Help } from './Help';

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

/** v0.19.4 the body tag alone (leads, tenders and pitches: the body the client asked for). */
export function BodyTag({ body, className = '' }: { body: 'narrow' | 'wide'; className?: string }) {
  return (
    <span className={`shape-tags ${className}`}>
      <span className={`shape-tag body-${body}`} data-tip={body === 'wide' ? 'A widebody job (twin aisle)' : 'A narrowbody job (single aisle)'}>{BODY_LABEL[body]}</span>
    </span>
  );
}

/**
 * v0.20.1 the two ways work is won, told apart at a glance: a tender is a contest ('Open tender'), a lead is ours
 * alone ('Exclusive'). What that means sits behind the '?' (no permanent line).
 */
export function KindTag({ kind, className = '' }: { kind: 'tender' | 'lead'; className?: string }) {
  const label = kind === 'tender' ? 'Open tender' : 'Exclusive';
  return (
    <span className={`shape-tags kind-tags ${className}`}>
      <span className={`shape-tag kind-${kind}`}>{label}</span>
      <Help title={label}>{kind === 'tender' ? TENDER_NOTE : LEAD_NOTE}</Help>
    </span>
  );
}

/** v0.20.1 'From tender' / 'From lead' on the offer or contract that came of it; `help`: the story behind a '?'. */
export function OriginTag({ v, help, className = '' }: { v: OriginView | null; help?: boolean; className?: string }) {
  if (!v) return null;
  return (
    <span className={`shape-tags kind-tags ${className}`}>
      <span className={`shape-tag kind-${v.origin}`}>{v.label}</span>
      {help && <Help title={v.label}>{v.note}</Help>}
    </span>
  );
}
