// v0.12 Scenarios mode in play: the goals (top-bar chip, the goals dialog, the Company panel) and the results card
// (stars, the key numbers, Retry, Back to scenarios). Engine views in engine/scenario/index.ts.

import { ArrowLeft, Check, Flag, RotateCcw, Star, Target, X } from 'lucide-react';
import { useEffect } from 'react';
import { DIFFICULTY_LABEL } from '../../data/setups';
import type { GameState } from '../../engine/core/types';
import { fmtValue, scenarioNumbers, scenarioView, type ScenarioView } from '../../engine/scenario';
import { Modal } from '../components/ui';
import { store, useStore } from '../store';

/** ★★☆ (filled, empty), with an accessible label. */
export function Stars({ n, size = 16, label }: { n: number; size?: number; label?: string }) {
  return (
    <span className="sc-stars" role="img" aria-label={label ?? `${n} of 3 stars`}>
      {[0, 1, 2].map((i) => <Star key={i} width={size} height={size} className={i < n ? 'on' : ''} aria-hidden />)}
    </span>
  );
}

/** The goals: the measure against its three thresholds, the conditions, days left. */
export function ScenarioGoals({ v, compact }: { v: ScenarioView; compact?: boolean }) {
  const u = v.metric.unit;
  return (
    <div className={`sc-goals ${compact ? 'compact' : ''}`}>
      <div className="sc-goal-head">
        <Target aria-hidden />
        <div className="grow">
          <div className="small muted">{v.metric.label}</div>
          <b className="big">{v.valueText}</b>
        </div>
        <Stars n={v.stars} size={18} label={`${v.stars} of 3 stars so far`} />
      </div>
      <div className="sc-steps" aria-label="Star thresholds">
        {v.def.stars.map((x, i) => (
          <div key={i} className={`sc-step ${v.value >= x ? 'done' : ''}`}>
            <Stars n={i + 1} size={12} label={`${i + 1} star${i ? 's' : ''}`} />
            <span>{fmtValue(u, x)}</span>
          </div>
        ))}
      </div>
      <div className="bar sc-bar" aria-hidden><i style={{ width: `${Math.round(v.progress * 100)}%` }} /></div>
      <div className="small muted">{v.next ? `Next: ${v.next.text} for ${'★'.repeat(v.next.stars)}` : 'Three stars reached. Keep it there.'}</div>
      {v.musts.length > 0 && (
        <ul className="sc-musts">
          {v.musts.map((m) => (
            <li key={m.text} className={m.ok ? 'ok' : 'no'}>
              {m.ok ? <Check aria-hidden /> : <X aria-hidden />}
              <span className="grow">{m.text}</span>
              <b className="small">{m.now}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="tiny dim">
        {v.result ? 'The scenario is over.' : `${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left · ends ${v.endText}.`}
        {v.floor && !compact ? ` ${v.floor}` : ''} Bankruptcy ends it with no stars.
      </div>
    </div>
  );
}

/** Top bar: the scenario's stars so far and the days left; a tap opens the goals. */
export function ScenarioChip({ g }: { g: GameState }) {
  const v = scenarioView(g);
  if (!v) return null;
  return (
    <button className="sc-chip" onClick={() => store.openModal({ kind: 'scenario' })} aria-label={`${v.def.name}: ${v.stars} of 3 stars, ${v.daysLeft} days left. Goals`}>
      <Stars n={v.stars} size={13} label="" />
      <span className="sc-chip-d">{v.daysLeft}d</span>
    </button>
  );
}

/** The goals dialog (the chip, the Company panel's link). */
export function ScenarioModal() {
  const s = useStore();
  const v = s.game ? scenarioView(s.game) : null;
  if (!v) return null;
  return (
    <Modal title={v.def.name} icon={<Flag className="accent" />} onClose={() => store.closeModal()}>
      <p className="muted small sc-story">{v.def.story} {v.def.region} · {v.def.aircraft} · {DIFFICULTY_LABEL[v.def.difficulty]}.</p>
      <ScenarioGoals v={v} />
    </Modal>
  );
}

/** Company screen: the goals in a panel (scenario games only). */
export function ScenarioPanel({ g }: { g: GameState }) {
  const v = scenarioView(g);
  if (!v) return null;
  return (
    <section className="card sc-panel" aria-label="Scenario goals">
      <div className="row gap-8 sc-panel-head">
        <Flag className="accent" aria-hidden />
        <b className="grow">{v.def.name}</b>
        <span className="chip">{DIFFICULTY_LABEL[v.def.difficulty]}</span>
      </div>
      <ScenarioGoals v={v} compact />
    </section>
  );
}

/** The end: stars, the numbers, Retry and Back to scenarios. The best result is kept on this device. */
export function ScenarioResultModal() {
  const s = useStore();
  const g = s.game!;
  const v = scenarioView(g);
  useEffect(() => {
    if (g.scen) store.recordScenario(g);
  }, [g]);
  if (!v || !v.result || s.modal) return null;
  const r = v.result;
  const best = s.settings.scenarioBest[v.def.id];
  const title = r.stars === 3 ? 'Outstanding' : r.stars === 2 ? 'Well flown' : r.stars === 1 ? 'Done' : 'Not this time';
  const id = v.def.id;
  return (
    <Modal title={`${v.def.name}: ${title}`} icon={<Flag className="accent" />} className="sc-result">
      <div className="sc-result-stars"><Stars n={r.stars} size={40} /></div>
      <div className="sc-result-main">
        <div className="small muted">{v.metric.label}</div>
        <b className="big">{fmtValue(v.metric.unit, r.value)}</b>
        <div className="tiny dim">★ {fmtValue(v.metric.unit, v.def.stars[0])} · ★★ {fmtValue(v.metric.unit, v.def.stars[1])} · ★★★ {fmtValue(v.metric.unit, v.def.stars[2])}</div>
      </div>
      {r.failed && <p className="sc-failed small">{r.failed}</p>}
      <div className="sc-numbers">
        {scenarioNumbers(g).map(([k, x]) => (
          <div key={k}><span className="tiny dim">{k}</span><b>{x}</b></div>
        ))}
      </div>
      {best && <div className="tiny dim">Best on this device: <Stars n={best.stars} size={11} /> {fmtValue(v.metric.unit, best.value)}</div>}
      <div className="row gap-8 mt-16 wrap sc-result-actions">
        <button className="btn btn-primary" onClick={() => store.startScenario(id)}><RotateCcw /> Retry</button>
        <button className="btn" onClick={() => { store.quitToTitle(); store.setScreen('scenarios'); }}><ArrowLeft /> Back to scenarios</button>
      </div>
    </Modal>
  );
}
