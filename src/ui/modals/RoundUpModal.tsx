// v0.7.4 Round up (Crew planning): the hire flow pre-filled with exactly the crew that complete `target` sets of a
// family: per role the count, type rating(s), join date and cost; cabin crew may hold more fleet types (tick boxes);
// the total cost, the monthly payroll change and one confirm (hireBatch).

import { Check, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDay } from '../../engine/core/time';
import { crewPlan, familyName, hireBatch, roundUpQuote } from '../../engine/crew';
import { Modal } from '../components/ui';
import { money } from '../format';
import { isPilotRole } from '../screens/screenLogic';
import { store, useGame } from '../store';
import { FAMILY_TICK } from './HireModal';

const ROLE_ONE: Record<string, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['relief pilot', 'relief pilots'], PUR: ['purser', 'pursers'], CC: ['cabin crew', 'cabin crew'],
};

export function RoundUpModal({ family, target }: { family: RatingFamily; target: number }) {
  const g = useGame();
  const plan = crewPlan(g).find((p) => p.family === family);
  const fleetFams = [...new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family))].filter((f) => f !== family);
  const [types, setTypes] = useState<RatingFamily[]>([family]);
  if (!plan) return null;
  const q = roundUpQuote(g, plan, target, types);
  const n = q.lines.reduce((s, l) => s + l.req.count, 0);
  const cabin = q.lines.some((l) => !isPilotRole(l.req.role));
  const tick = (f: RatingFamily) => setTypes(types.includes(f) ? types.filter((x) => x !== f) : types.length < 3 ? [...types, f] : types);
  const hire = () => {
    const res = store.act((gg) => hireBatch(gg, q.lines.map((l) => l.req)));
    if (res.ok) store.closeModal();
  };
  const days = (t: number) => Math.max(1, Math.round((t - g.now) / DAY));
  return (
    <Modal size="wide" title={`Round up · ${plan.label}`} icon={<UserPlus className="accent" />} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <span className="grow small muted">{n ? `${plan.setsComplete} → ${target} complete sets` : ''}</span>
        <button className="btn btn-primary" onClick={hire} disabled={!n || g.company.cash < q.cost}><UserPlus /> Hire {n} for {money(q.cost)}</button>
      </>
    }>
      <div className="col gap-12">
        <div className="small muted">{target} complete sets of the {plan.label}: needed {plan.setsNeeded}, complete with the joiners {plan.setsComplete}.</div>
        {!n ? (
          <div className="small good">Nothing to hire: you already have {target} complete sets.</div>
        ) : (
          <table className="cp-table ru-table">
            <thead><tr><th>Who</th><th>Type</th><th>Joins</th><th>Hiring</th><th>Payroll / month</th></tr></thead>
            <tbody>
              {q.lines.map((l) => (
                <tr key={l.req.role}>
                  <td><b className="num">{l.req.count}</b> {ROLE_ONE[l.req.role][l.req.count === 1 ? 0 : 1]}</td>
                  <td>{isPilotRole(l.req.role) ? familyName(l.req.family) : (l.req.families ?? [l.req.family]).map((f) => FAMILY_TICK[f]).join(' + ')}</td>
                  <td>{fmtDay(l.readyAt)} <span className="tiny muted">(~{days(l.readyAt)} days)</span>{l.beyondPool ? <span className="tiny warn"> · {l.beyondPool} via agency</span> : null}</td>
                  <td className="num">{money(l.cost)}</td>
                  <td className="num">+{money(l.payroll)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cabin && fleetFams.length > 0 && (
          <div className="field">
            <label>Cabin crew also hold <span className="dim">(up to 3 types; each extra type adds half the hiring cost and about 3 days)</span></label>
            <div className="hm-ticks" role="group" aria-label="Cabin crew types">
              {fleetFams.map((f) => {
                const on = types.includes(f);
                const full = !on && types.length >= 3;
                return (
                  <button key={f} className={`chip hm-tick ${on ? 'on' : ''}`} aria-pressed={on} disabled={full} onClick={() => tick(f)}>
                    <span className="hm-box" aria-hidden>{on && <Check />}</span>{FAMILY_TICK[f]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {n > 0 && (
          <div className="cv-cost">
            <div className="row between small"><span className="muted">Hiring cost (one-off)</span><b className="num">{money(q.cost)}</b></div>
            <div className="row between small"><span className="muted">Payroll change (salary + on-costs)</span><b className="num">+{money(q.payroll)} / month</b></div>
            <div className="row between small"><span className="muted">Cash after</span><b className={`num ${g.company.cash - q.cost < 0 ? 'bad' : ''}`}>{money(g.company.cash - q.cost)}</b></div>
          </div>
        )}
        <div className="small dim">Cabin crew join in about a week; pilots take 5–9 weeks (notice periods, checks and line training). They join at {g.company.homeBase}.</div>
      </div>
    </Modal>
  );
}
