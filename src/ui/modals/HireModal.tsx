// Hire crew (B5): role, type family, base, count; quote (cost, ready date) from crew.hireQuote.

import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { fmtDate } from '../../engine/core/time';
import type { GameState, Role } from '../../engine/core/types';
import { hireCrew, hireQuote, salaryFor, staffing } from '../../engine/crew';
import { Modal, Seg, Stepper } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { ROLE_LABEL, ROLES } from '../screens/screenLogic';
import { store, useGame } from '../store';

/** Families flown or on order first, then the rest of the catalogue. */
function families(g: GameState): RatingFamily[] {
  const fleet = [...new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family))];
  const all = [...new Set(ACMI_TYPES_LIST.map((t) => t.family))];
  return [...fleet, ...all.filter((f) => !fleet.includes(f))];
}

function bases(g: GameState): string[] {
  const out = [g.company.homeBase];
  for (const d of Object.values(g.deployments)) if (!out.includes(d.base)) out.push(d.base);
  return out;
}

export function HireModal({ role: role0, family: fam0, base: base0 }: { role?: Role; family?: RatingFamily; base?: string }) {
  const g = useGame();
  const fams = families(g);
  const [role, setRole] = useState<Role>(role0 ?? 'CC');
  const [family, setFamily] = useState<RatingFamily>(fam0 ?? fams[0] ?? 'A320');
  const [base, setBase] = useState(base0 ?? g.company.homeBase);
  const [count, setCount] = useState(1);
  const req = { role, family, base, count };
  const q = hireQuote(g, req);
  const line = staffing(g).find((l) => l.family === family && l.role === role);
  const salary = salaryFor(role, family);
  const hire = () => {
    const res = store.act((gg) => hireCrew(gg, req));
    if (res.ok) store.closeModal();
  };
  return (
    <Modal title="Hire crew" icon={<UserPlus className="accent" />} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={hire} disabled={g.company.cash < q.cost}><UserPlus /> Hire {count} for {money(q.cost)}</button>
      </>
    }>
      <div className="col gap-16">
        <div className="field">
          <label>Role</label>
          <div className="sc-seg-wrap"><Seg<Role> value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: r }))} /></div>
          <div className="small muted">{ROLE_LABEL[role]}</div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Type rating</label>
            <select className="select" value={family} onChange={(e) => setFamily(e.target.value as RatingFamily)}>
              {fams.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Base</label>
            <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
              {bases(g).map((b) => <option key={b} value={b}>{b}{b === g.company.homeBase ? ' (home)' : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="row between">
          <div className="field"><label>How many</label><Stepper value={count} min={1} max={30} onChange={setCount} /></div>
          {line && <div className={`small ${line.have < line.need ? 'warn' : 'muted'}`}>{family} {role}: {line.have} of {line.need} needed</div>}
        </div>
        <KV rows={[
          ['Hiring cost', money(q.cost)],
          ['Ready to fly', fmtDate(q.readyAt)],
          ['Salary', `${money(salary)} / month each`],
        ]} />
        <div className="small dim">Rated crew from the market: recruitment, checks and line training take weeks. They join at {base}.</div>
      </div>
    </Modal>
  );
}
