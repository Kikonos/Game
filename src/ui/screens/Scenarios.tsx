// v0.12 Scenarios mode: the list. One card per scenario (name, story, region, aircraft, goal, time limit, difficulty and
// the best stars on this device); a tap starts it. Definitions: engine/scenario/defs.ts.

import { ArrowLeft, Clock, MapPin, Plane, Play, Target } from 'lucide-react';
import { DIFFICULTY_LABEL } from '../../data/setups';
import { DAY, fmtDay } from '../../engine/core/time';
import { fmtValue, METRICS, SCENARIOS, scenarioStart } from '../../engine/scenario';
import { LogoMark } from '../components/Logo';
import { Stars } from '../modals/ScenarioModals';
import { store, useStore } from '../store';

export function Scenarios() {
  const s = useStore();
  const best = s.settings.scenarioBest;
  const total = SCENARIOS.reduce((n, d) => n + (best[d.id]?.stars ?? 0), 0);
  return (
    <div className="newgame acmi-ng sc-list-screen">
      <header className="ng-head">
        <div className="row gap-12">
          <LogoMark size={36} />
          <div className="grow">
            <div className="upper dim">Block Hours · scenarios</div>
            <h2>Ten challenges. Up to three stars each.</h2>
          </div>
          <div className="sc-total" aria-label={`${total} of ${SCENARIOS.length * 3} stars`}><Stars n={1} size={14} label="" /> {total} / {SCENARIOS.length * 3}</div>
        </div>
      </header>
      <div className="sc-list">
        {SCENARIOS.map((d) => {
          const b = best[d.id];
          const m = METRICS[d.metric];
          const start = scenarioStart(d);
          return (
            <button key={d.id} className="card sc-card hoverable" onClick={() => store.startScenario(d.id)} aria-label={`Play ${d.name}`}>
              <div className="sc-card-head">
                <b className="sc-card-name">{d.name}</b>
                <span className={`chip sc-diff d${d.difficulty}`}>{DIFFICULTY_LABEL[d.difficulty]}</span>
              </div>
              <p className="small muted sc-card-story">{d.story}</p>
              <ul className="sc-facts small">
                <li><MapPin aria-hidden /><span>{d.region}</span></li>
                <li><Plane aria-hidden /><span>{d.aircraft}</span></li>
                <li><Target aria-hidden /><span>{d.goal}: {fmtValue(m.unit, d.stars[0])} for ★</span></li>
                <li><Clock aria-hidden /><span>{d.days} days, {fmtDay(start)} – {fmtDay(start + d.days * DAY - 1)}</span></li>
              </ul>
              <div className="sc-card-foot">
                <span className="small">{b ? <><Stars n={b.stars} size={14} /> <span className="dim">best</span></> : <span className="dim">Not played yet</span>}</span>
                <span className="sc-play"><Play aria-hidden /> Play</span>
              </div>
            </button>
          );
        })}
      </div>
      <footer className="ng-foot">
        <button className="btn btn-ghost" onClick={() => store.setScreen('title')}><ArrowLeft /> Back to menu</button>
        <div className="ng-foot-sum"><span className="small dim">Each scenario starts the same way every time. Best results stay on this device.</span></div>
      </footer>
    </div>
  );
}
