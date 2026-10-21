// v0.7.1 timeline (UPDATE-0.7.1.md §5): fault → repair → next flight (maintenance), due dates (money). Same bar
// style as the reach bar: marks as ticks with labels above and below, spans as coloured stretches. Static.

import { fmtDateTime } from '../../engine/core/time';
import type { TimelineSpec } from '../../engine/problems/types';
import { timelineLayout } from './problemLogic';

export function Timeline({ spec }: { spec: TimelineSpec }) {
  const lay = timelineLayout(spec);
  const side = (s: 'above' | 'below') => (
    <div className={`rb-labels ${s} tl`}>
      {lay.ticks.filter((t) => t.side === s).map((t) => (
        <div key={t.key} className={`rb-lab ${t.x < 8 ? 'left' : t.x > 92 ? 'right' : ''} ${t.tone ?? ''}`} style={{ left: `${t.x}%` }}>
          <b>{t.label}</b>
          <span className="num dim">{fmtDateTime(t.t)}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="reach timeline" role="img" aria-label={spec.marks.map((m) => m.label).join(', ')}>
      {side('above')}
      <div className="rb-track">
        {lay.spans.map((s, i) => (
          <span key={i} className={`tl-span ${s.tone}`} style={{ left: `${s.x0}%`, width: `${Math.max(0.5, s.x1 - s.x0)}%` }} title={s.label}>
            {s.x1 - s.x0 > 14 && <span className="tl-span-t">{s.label}</span>}
          </span>
        ))}
        {lay.ticks.map((t) => <span key={t.key} className={`rb-tick ${t.tone ?? ''}`} style={{ left: `${t.x}%` }} />)}
      </div>
      {side('below')}
      {lay.spans.some((s) => s.x1 - s.x0 <= 14) && (
        <div className="tiny dim">{spec.spans.map((s) => `${s.label} ${fmtDateTime(s.from)}–${fmtDateTime(s.to)}`).join(' · ')}</div>
      )}
    </div>
  );
}
