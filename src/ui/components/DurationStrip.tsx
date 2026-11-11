// v0.20.1 how long a job runs, one discreet line (durationLogic.ts): month cells from this month with the job's days
// filled in, a tick for today, each year named at its first month, then '67 days · about 2 months · 21 Mar – 26 May'.
// In the offer dialog (offers and lead offers) and the tender bid dialog. Static; read out as one sentence.

import type { Minute } from '../../engine/core/types';
import { durationView } from './durationLogic';

/** `first` / `last`: any minute of the job's first and last day, on the calendar it is read in (UTC or the base's). */
export function DurationStrip({ now, first, last, className = '' }: { now: Minute; first: Minute; last: Minute; className?: string }) {
  const v = durationView(now, first, last);
  return (
    <div className={`dur ${v.count > 14 ? 'dense' : ''} ${className}`} role="img" aria-label={v.aria}>
      <span className="dur-strip" aria-hidden="true">
        {v.years.map((y, yi) => (
          <span key={y.year} className="dur-year">
            <span className="dur-y">{y.year}</span>
            {y.cells.map((c, i) => (
              <span key={c.key} className={`dur-m ${c.to > c.from ? 'on' : ''}`}>
                {c.to > c.from && <i className="dur-fill" style={{ left: `${c.from * 100}%`, width: `${(c.to - c.from) * 100}%` }} />}
                {yi === 0 && i === 0 && <i className="dur-now" style={{ left: `${v.today * 100}%` }} />}
                <span className="dur-i">{c.initial}</span>
              </span>
            ))}
          </span>
        ))}
        {v.more > 0 && <span className="dur-more">+{v.more} months</span>}
      </span>
      <span className="dur-text small muted" aria-hidden="true">{v.text}</span>
    </div>
  );
}
