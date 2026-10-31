// v0.7.1 the reach timeline bar (UPDATE-0.7.1.md §5): now, must-land-by, report, departure and the earliest arrival
// on one horizontal bar, the gap drawn in red, labels in UTC and local alternating above and below. Static.

import type { ReachSpec } from '../../engine/problems/types';
import { legText, reachLayout, reachTone, reachVerdict, tickTimes, type BarTick } from './problemLogic';

export function BarTicks({ ticks, airport, side, now }: { ticks: BarTick[]; airport: string; side: 'above' | 'below'; /** v0.12.1 dates on labels off this day */ now?: number }) {
  return (
    <div className={`rb-labels ${side}`}>
      {ticks.filter((t) => t.side === side).map((t) => {
        const [utc, local] = tickTimes(t.t, airport, now);
        const lx = t.lx ?? t.x;
        const edge = lx < 8 ? 'left' : lx > 92 ? 'right' : '';
        return (
          <div key={t.key} className={`rb-lab ${edge} ${t.tone ?? ''}`} style={{ left: `${lx}%` }}>
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
      <BarTicks ticks={lay.ticks} airport={spec.to} side="above" now={spec.now} />
      <div className="rb-track">
        {lay.gap && <span className="rb-gap" style={{ left: `${lay.gap.x0}%`, width: `${lay.gap.x1 - lay.gap.x0}%` }} />}
        {lay.ticks.map((t) => <span key={t.key} className={`rb-tick ${t.tone ?? ''}`} style={{ left: `${t.x}%` }} />)}
      </div>
      <BarTicks ticks={lay.ticks} airport={spec.to} side="below" now={spec.now} />
      <div className={`rb-verdict small ${reachTone(spec, limited)}`}>{reachVerdict(spec, limited)}</div>
      {spec.legs.length > 0 && <div className="tiny dim">{spec.legs.map((l) => legText(l, spec.now)).join(' · ')}</div>}
    </div>
  );
}
