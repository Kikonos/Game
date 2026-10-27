// Hire crew (B5): role, type family, base, count; quote (cost, ready date) from crew.hireQuote.
// v0.7.2: cabin crew (PUR/CC) take up to 3 types as tick boxes (price and joining time grow per type); pilots keep one rating.

import { Check, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay } from '../../engine/core/time';
import type { GameState, Role } from '../../engine/core/types';
import { hireCrew, hireQuote, type HireRequest, salaryFor, staffing } from '../../engine/crew';
import { Modal, Seg, Stepper } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { isPilotRole, ROLE_LABEL, ROLES } from '../screens/screenLogic';
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

/** Tick-box names for cabin crew types. */
export const FAMILY_TICK: Record<RatingFamily, string> = {
  A320: 'A320 family', B737: '737', 'B757/767': '757/767', 'A330/340': 'A330/A340', B777: '777', B787: '787', A350: 'A350', A380: 'A380', B747: '747',
};
/** Short names for a quote line: 'A320 + A330'. */
const famShort = (f: RatingFamily) => FAMILY_TICK[f].replace(' family', '').replace('/A340', '');
const MAX_TYPES = 3;

export function HireModal({ role: role0, family: fam0, base: base0, count: count0 }: { role?: Role; family?: RatingFamily; base?: string; count?: number }) {
  const g = useGame();
  const fams = families(g);
  const [role, setRole] = useState<Role>(role0 ?? 'CC');
  const [family, setFamily] = useState<RatingFamily>(fam0 ?? fams[0] ?? 'A320');
  // v0.7.2: the cabin crew's ticked types (the first is the primary family).
  const [ticked, setTicked] = useState<RatingFamily[]>([fam0 ?? fams[0] ?? 'A320']);
  const [base, setBase] = useState(base0 ?? g.company.homeBase);
  const [count, setCount] = useState(Math.max(1, Math.min(30, Math.round(count0 ?? 1))));
  const pilot = isPilotRole(role);
  const req: HireRequest = pilot ? { role, family, base, count } : { role, family: ticked[0], base, count, families: ticked };
  const q = hireQuote(g, req);
  const lines = staffing(g);
  const shown = pilot ? [family] : ticked;
  const salary = salaryFor(role, req.family);
  const days = Math.max(1, Math.round((q.readyAt - g.now) / DAY));
  const tick = (f: RatingFamily) => {
    if (ticked.includes(f)) { if (ticked.length > 1) setTicked(ticked.filter((x) => x !== f)); }
    else if (ticked.length < MAX_TYPES) setTicked([...ticked, f]);
  };
  const pickRole = (r: Role) => {
    // Switching between pilots and cabin keeps the type in front.
    if (isPilotRole(r) && !pilot) setFamily(ticked[0]);
    if (!isPilotRole(r) && pilot && !ticked.includes(family)) setTicked([family]);
    setRole(r);
  };
  const hire = () => {
    const res = store.act((gg) => hireCrew(gg, req));
    if (res.ok) store.closeModal();
  };
  const who = pilot ? `${count} ${ROLE_LABEL[role].toLowerCase()}${count === 1 ? '' : 's'}` : `${count} ${role === 'PUR' ? `purser${count === 1 ? '' : 's'}` : 'cabin crew'}`;
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
          <div className="sc-seg-wrap"><Seg<Role> value={role} onChange={pickRole} options={ROLES.map((r) => ({ value: r, label: r }))} /></div>
          <div className="small muted">{ROLE_LABEL[role]}{pilot ? ' · one type rating' : ' · up to 3 aircraft types'}</div>
        </div>
        {pilot ? (
          <div className="grid-2">
            <div className="field">
              <label>Type rating</label>
              <select className="select" value={family} onChange={(e) => setFamily(e.target.value as RatingFamily)}>
                {fams.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <BaseField g={g} base={base} setBase={setBase} />
          </div>
        ) : (
          <>
            <div className="field">
              <label>Aircraft types <span className="dim">({ticked.length} of {MAX_TYPES})</span></label>
              <div className="hm-ticks" role="group" aria-label="Aircraft types">
                {fams.map((f) => {
                  const on = ticked.includes(f);
                  const full = !on && ticked.length >= MAX_TYPES;
                  return (
                    <button key={f} className={`chip hm-tick ${on ? 'on' : ''}`} aria-pressed={on} disabled={full} onClick={() => tick(f)} data-tip={full ? 'Up to 3 types' : undefined}>
                      <span className="hm-box" aria-hidden>{on && <Check />}</span>{FAMILY_TICK[f]}
                    </button>
                  );
                })}
              </div>
              <div className="tiny dim">{ticked.length >= MAX_TYPES ? 'Up to 3 types: untick one to pick another.' : 'Each extra type adds half the hiring cost and about 3 days of training.'}</div>
            </div>
          </>
        )}
        <div className="row between gap-16">
          <div className="row gap-16">
            <div className="field"><label>How many</label><Stepper value={count} min={1} max={30} onChange={setCount} /></div>
            {!pilot && <BaseField g={g} base={base} setBase={setBase} />}
          </div>
          <div className="col hm-cover">
            {shown.map((f) => {
              const l = lines.find((x) => x.family === f && x.role === role);
              if (!l) return <div key={f} className="small muted">{famShort(f)} {role}: none in the fleet</div>;
              return <div key={f} className={`small ${l.have < l.need ? 'warn' : 'muted'}`}>{famShort(f)} {role}: {l.have} of {l.need} needed{l.shared ? ` (${l.shared} also on another type)` : ''}</div>;
            })}
          </div>
        </div>
        {pilot ? (
          <KV rows={[
            ['Hiring cost', money(q.cost)],
            ['Ready to fly', `${fmtDate(q.readyAt)} (about ${days} day${days === 1 ? '' : 's'})`],
            ['Salary', `${money(salary)} / month each`],
          ]} />
        ) : (
          <div className="hm-quote">
            <b>{who} · {ticked.map(famShort).join(' + ')} · {money(q.cost)} · join {fmtDay(q.readyAt)} (about {days} day{days === 1 ? '' : 's'})</b>
            <div className="small muted">Salary {money(salary)} / month each</div>
          </div>
        )}
        {q.beyondPool > 0 && <div className="small warn">The market has few rated {req.family} {role} free: {q.beyondPool} of these come through an agency (+{money(q.fee)} fee) and take longer to join.</div>}
        <div className="small dim">Cabin crew join in about a week; pilots take 5–9 weeks (notice periods, checks and line training). They join at {base}.</div>
      </div>
    </Modal>
  );
}

function BaseField({ g, base, setBase }: { g: GameState; base: string; setBase: (b: string) => void }) {
  return (
    <div className="field">
      <label>Base</label>
      <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
        {bases(g).map((b) => <option key={b} value={b}>{b}{b === g.company.homeBase ? ' (home)' : ''}</option>)}
      </select>
    </div>
  );
}
