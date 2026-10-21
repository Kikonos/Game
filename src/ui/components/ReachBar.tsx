// v0.7.1 the reach timeline bar (UPDATE-0.7.1.md §5): now, must-land-by, report, departure and the earliest arrival
// on one horizontal bar, the gap drawn in red, labels in UTC and local alternating above and below. Static.

import type { ReachSpec } from '../../engine/problems/types';
import { legText, reachLayout, reachTone, reachVerdict, tickTimes, type BarTick } from './problemLogic';

export function BarTicks({ ticks, airport, side }: { ticks: BarTick[]; airport: string; side: 'above' | 'below' }) {
  return (
    <div className={`rb-labels ${side}`}>
      {ticks.filter((t) => t.side === side).map((t) => {
        const [utc, local] = tickTimes(t.t, airport);
        const edge = t.x < 8 ? 'left' : t.x > 92 ? 'right' : '';
        return (
          <div key={t.key} className={`rb-lab ${edge} ${t.tone ?? ''}`} style={{ left: `${t.x}%` }}>
            <b>{t.label}</b>
            <span className="num">{utc}</span>
            <span className="num dim">{local}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReachBar({ spec, limited }: { spec: ReachSpec; /** the day after the ride would run too long (the card's WHY) */ limited?: boolean }) {
  const lay = reachLayout(spec);
  return (
    <div className="reach" role="img" aria-label={reachVerdict(spec, limited)}>
      <BarTicks ticks={lay.ticks} airport={spec.to} side="above" />
      <div className="rb-track">
        {lay.gap && <span className="rb-gap" style={{ left: `${lay.gap.x0}%`, width: `${lay.gap.x1 - lay.gap.x0}%` }} />}
        {lay.ticks.map((t) => <span key={t.key} className={`rb-tick ${t.tone ?? ''}`} style={{ left: `${t.x}%` }} />)}
      </div>
      <BarTicks ticks={lay.ticks} airport={spec.to} side="below" />
      <div className={`rb-verdict small ${reachTone(spec, limited)}`}>{reachVerdict(spec, limited)}</div>
      {spec.legs.length > 0 && <div className="tiny dim">{spec.legs.map(legText).join(' · ')}</div>}
    </div>
  );
}
