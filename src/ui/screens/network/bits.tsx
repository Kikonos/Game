// v0.19 small shared pieces of the Network area (lazy chunk): the status chip, trend arrows and the launch timeline.

import { AlertTriangle, Check, Circle, CircleDot, Clock, X } from 'lucide-react';
import { fmtDay, fmtDayRel } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { LAUNCH_STAGES, type LaunchStage, type Route } from '../../../engine/network/types';
import { Bar } from '../../components/ui';
import { money } from '../../format';
import { STAGE_HINT, STAGE_LABEL, statusChip } from './networkLogic';

export function StatusChip({ r }: { r: Route }) {
  const s = statusChip(r);
  return <span className={`nw-chip ${s.tone}`}>{s.label}</span>;
}

export function TrendArrow({ dir, invert }: { dir: -1 | 0 | 1; invert?: boolean }) {
  if (!dir) return <span className="nw-trend flat" aria-label="steady">→</span>;
  const good = invert ? dir < 0 : dir > 0;
  return <span className={`nw-trend ${good ? 'good' : 'bad'}`} aria-label={dir > 0 ? 'up' : 'down'}>{dir > 0 ? '↗' : '↘'}</span>;
}

/** The stages in their order, with an empty one for any stage the route has not met yet. */
export function stagesOf(r: Route): LaunchStage[] {
  const by = new Map(r.stages.map((s) => [s.id, s]));
  return LAUNCH_STAGES.map((id) => by.get(id) ?? { id, state: 'todo', cost: 0 });
}

const STATE_WORD: Record<LaunchStage['state'], string> = { todo: 'To do', running: 'Running', waiting: 'Waiting for you', done: 'Done', delayed: 'Delayed', failed: 'Failed' };

function StageIcon({ s }: { s: LaunchStage }) {
  switch (s.state) {
    case 'done': return <Check className="nw-st-ico good" />;
    case 'running': return <CircleDot className="nw-st-ico accent" />;
    case 'waiting': return <Clock className="nw-st-ico warn" />;
    case 'delayed': return <AlertTriangle className="nw-st-ico warn" />;
    case 'failed': return <X className="nw-st-ico bad" />;
    default: return <Circle className="nw-st-ico dim" />;
  }
}

/** Compact (list row): progress and the stage now; full: the vertical timeline with costs and dates. */
export function LaunchProgress({ g, r, compact }: { g: GameState; r: Route; compact?: boolean }) {
  const st = stagesOf(r);
  const done = st.filter((s) => s.state === 'done').length;
  const wait = st.find((s) => s.state === 'waiting') ?? (r.status === 'case' ? st.find((s) => s.id === 'case') : undefined);
  const now = st.filter((s) => s.state === 'running' || s.state === 'delayed');
  const firstDue = r.firstFlight;
  if (compact) {
    return (
      <div className="nw-launch-mini">
        <Bar value={done / st.length} tone={st.some((s) => s.state === 'delayed' || s.state === 'failed') ? 'warn' : undefined} size="thin" />
        <span className="small ellipsis">
          {wait ? <b className="warn">Waiting for you: {STAGE_LABEL[wait.id].toLowerCase()}</b> : now.length ? `Now: ${now.map((s) => STAGE_LABEL[s.id]).join(', ')}` : `${done} of ${st.length} stages done`}
          {firstDue ? <span className="muted"> · first flight {fmtDayRel(firstDue, g.now)}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <ol className="nw-stages">
      {st.map((s) => (
        <li key={s.id} className={`nw-stage ${s.state}`}>
          <StageIcon s={s} />
          <div className="nw-stage-body">
            <div className="row between gap-8">
              <b className="small">{STAGE_LABEL[s.id]}</b>
              <span className={`tiny nowrap ${s.state === 'delayed' || s.state === 'waiting' ? 'warn' : s.state === 'failed' ? 'bad' : 'muted'}`}>{STATE_WORD[s.state]}</span>
            </div>
            <div className="tiny muted">
              {s.state === 'todo' ? STAGE_HINT[s.id] : [
                s.start ? `from ${fmtDay(s.start)}` : '',
                s.due ? `${s.state === 'done' ? 'done' : 'due'} ${fmtDayRel(s.due, g.now)}` : '',
                s.cost ? money(s.cost) : '',
              ].filter(Boolean).join(' · ')}
            </div>
            {s.setback && <div className="tiny warn nw-setback">{s.setback}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
