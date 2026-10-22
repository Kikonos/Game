// v0.7.1 fuel-gauge bars for limits (UPDATE-0.7.1.md §5, §7): a rounded track, the fill in green / amber / red, a
// needle at the value, the label left and '10:45 of 11:00' right, 'by 06:00' under it. Static.

import { fmtDateTime, fmtTime } from '../../engine/core/time';
import type { GaugeSpec } from '../../engine/problems/types';

export function Gauge({ spec, compact }: { spec: GaugeSpec; compact?: boolean }) {
  const r = spec.limit > 0 ? spec.value / spec.limit : 0;
  const pct = Math.max(0, Math.min(100, r * 100));
  return (
    <div className={`gauge ${spec.tone} ${compact ? 'compact' : ''}`} role="img" aria-label={`${spec.label} ${spec.text}`}>
      <div className="gauge-top">
        <span className="gauge-label">{spec.label}</span>
        <span className={`gauge-val num ${spec.tone}`}>{spec.text}</span>
      </div>
      <div className="gauge-track">
        <span className="gauge-fill" style={{ width: `${pct}%` }} />
        <span className="gauge-needle" style={{ left: `${pct}%` }} />
      </div>
      {spec.by !== undefined && !compact && !(spec.id === 'rest' && spec.value >= spec.limit) && <div className="gauge-by tiny dim">{spec.tone === 'good' && spec.id !== 'rest' ? 'until' : 'by'} {spec.unit === 'pct' ? fmtDateTime(spec.by) : fmtTime(spec.by)} UTC</div>}
    </div>
  );
}

/** Up to three gauges in a row (the duty modal's per-seat strip). */
export function GaugeRow({ specs }: { specs: GaugeSpec[] }) {
  if (!specs.length) return null;
  return <div className="gauge-row">{specs.map((s) => <Gauge key={`${s.id}-${s.crewId ?? ''}`} spec={s} compact />)}</div>;
}
