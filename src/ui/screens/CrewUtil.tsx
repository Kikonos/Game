// v0.18.2 Crew › Utilisation (the player: "all crew have very little flying hours by month or year: just ACMI sparse
// duties, or really underused?"): block hours per person against what ACMI crew typically fly, idle crew by base, type
// and rank, crew per aircraft, the monthly cost of crew beyond what the flying needs, and what to do about a surplus.

import { Gauge, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RatingFamily } from '../../data/acmiTypes';
import type { GameState, Role } from '../../engine/core/types';
import { fmtDay } from '../../engine/core/time';
import {
  crewRev, crewUtilisation, makeRedundant, offerUnpaidLeave, redundancyQuote, REDUNDANCY, roleWords, unpaidQuote, UNPAID, UTIL_TYPICAL, type UtilSurplus,
} from '../../engine/crew';
import { Seg, Stepper } from '../components/ui';
import { RankMark } from '../components/RankMark';
import { store } from '../store';

const ROLE_PLURAL: Record<Role, string> = { CPT: 'Captains', FO: 'First officers', CRP: 'Relief pilots', PUR: 'Pursers', CC: 'Cabin crew' };
const k = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`);
const h = (v: number) => `${Math.round(v)} h`;

/** One surplus line and its actions (unpaid leave, furlough, redundancy), each with its quote before it is done. */
function SurplusRow({ g, s }: { g: GameState; s: UtilSurplus }) {
  const [act, setAct] = useState<'none' | 'unpaid' | 'redundant'>('none');
  const [n, setN] = useState(Math.min(s.n, 4));
  const [months, setMonths] = useState(UNPAID.months[0]);
  const fam = s.family as RatingFamily;
  const uq = act === 'unpaid' ? unpaidQuote(g, fam, s.role, n, months) : null;
  const rq = act === 'redundant' ? redundancyQuote(g, fam, s.role, n) : null;
  return (
    <div className="cu-sur">
      <div className="cu-sur-line">
        <span className="row gap-6 cu-sur-who"><RankMark role={s.role} /><b>{roleWords(s.role, s.n)}</b><span className="muted small">{s.label}</span></span>
        <span className="num small cu-sur-cost">{k(s.cost)}<span className="dim"> a month</span></span>
        <span className="cu-sur-act">
          <button className={`btn btn-sm ${act === 'unpaid' ? 'btn-on' : ''}`} onClick={() => setAct(act === 'unpaid' ? 'none' : 'unpaid')} aria-pressed={act === 'unpaid'}>Unpaid leave</button>
          <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'distress', id: 'furlough' })}>Furlough</button>
          <button className={`btn btn-sm ${act === 'redundant' ? 'btn-on' : ''}`} onClick={() => setAct(act === 'redundant' ? 'none' : 'redundant')} aria-pressed={act === 'redundant'}>Redundancy</button>
        </span>
      </div>
      {uq && (
        <div className="cu-quote small">
          <div className="cu-q-ctl">
            <span className="muted">Ask</span><Stepper value={n} min={1} max={Math.max(1, s.n)} onChange={setN} />
            <span className="muted">for</span><Seg<number> value={months} onChange={setMonths} options={UNPAID.months.map((m) => ({ value: m, label: `${m} month${m === 1 ? '' : 's'}` }))} />
          </div>
          <p className="muted">{uq.why ?? `${uq.ids.length} of the ${uq.asked} least-flown asked take it, from ${fmtDay(uq.from)}: about ${k(uq.saved)} saved. Voluntary, so morale holds; their trips are crewed again.`}</p>
          <button className="btn btn-sm btn-primary" disabled={!!uq.why} onClick={() => { store.act((gg) => offerUnpaidLeave(gg, fam, s.role, n, months)); setAct('none'); }}>Offer unpaid leave</button>
        </div>
      )}
      {rq && (
        <div className="cu-quote small">
          <div className="cu-q-ctl"><span className="muted">Let go</span><Stepper value={Math.min(n, s.n)} min={1} max={Math.max(1, s.n)} onChange={setN} /></div>
          <p className="muted">{rq.why ?? `The least flown, then the newest. ${rq.noticeDays} days' notice (they fly as rostered until ${fmtDay(rq.leaves - 1)}); severance ${k(rq.severance)} now, half a month's pay a year served; then ${k(rq.saved)} a month less. Morale ${REDUNDANCY.moraleGroup} for their colleagues, ${REDUNDANCY.moraleAll} for everyone else.`}</p>
          <button className="btn btn-sm btn-danger" disabled={!!rq.why} onClick={() => { store.act((gg) => makeRedundant(gg, fam, s.role, n)); setAct('none'); }}>Give notice</button>
        </div>
      )}
    </div>
  );
}

export function UtilisationView({ g }: { g: GameState }) {
  const rev = crewRev(g);
  const day = Math.floor(g.now / 1440);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const u = useMemo(() => crewUtilisation(g), [g, rev, day, Object.keys(g.crew).length]);
  const [all, setAll] = useState(false);
  const [who, setWho] = useState<'pilots' | 'cabin'>('pilots');
  const pilot = (r: Role) => r === 'CPT' || r === 'FO' || r === 'CRP';
  const people = u.people.filter((p) => g.crew[p.id]?.status !== 'joining' && (who === 'pilots' ? pilot(p.role) : !pilot(p.role))).sort((a, b) => a.d28 - b.d28 || a.name.localeCompare(b.name));
  const shown = all ? people : people.slice(0, 12);
  const groups = u.groups.filter((x) => x.idle > 0 || x.n >= 3);
  const lowP = u.avg28.pilots < UTIL_TYPICAL.monthLo;
  return (
    <div className="cu">
      <section className="cu-tiles">
        <div className="card cu-tile"><span className="tiny upper dim">Pilots · 28 d</span><b className={`num ${lowP ? 'warn' : ''}`}>{h(u.avg28.pilots)}</b><span className="tiny muted">each{u.avg12.pilots ? ` · ${h(u.avg12.pilots)} a year` : ''}</span></div>
        <div className="card cu-tile"><span className="tiny upper dim">Cabin · 28 d</span><b className={`num ${u.avg28.cabin < UTIL_TYPICAL.monthLo ? 'warn' : ''}`}>{h(u.avg28.cabin)}</b><span className="tiny muted">each{u.avg12.cabin ? ` · ${h(u.avg12.cabin)} a year` : ''}</span></div>
        <div className="card cu-tile"><span className="tiny upper dim">Per aircraft</span><b className="num">{u.perAircraft.pilots.toFixed(1)} <span className="cu-unit">pilots</span></b><span className="tiny muted">{u.perAircraft.cabin.toFixed(1)} cabin crew · {u.aircraft} aircraft</span></div>
        <div className="card cu-tile"><span className="tiny upper dim">Surplus</span><b className={`num ${u.surplusCost ? 'warn' : 'good'}`}>{u.surplusCost ? k(u.surplusCost) : 'None'}</b><span className="tiny muted">{u.surplusCost ? `a month · ${u.surplus.reduce((s, x) => s + x.n, 0)} people` : 'crew match the sets needed'}</span></div>
      </section>
      <p className="small muted cu-typical"><Gauge className="sc-ico-s" aria-hidden /> ACMI crew typically fly {UTIL_TYPICAL.monthLo}–{UTIL_TYPICAL.monthHi} h a month in season ({UTIL_TYPICAL.yearLo}–{UTIL_TYPICAL.yearHi} a year; the law allows 100 h in 28 days), with about 10–12 pilots per narrowbody. Fewer hours in winter are normal; idle all year is not. The crew desk holds hiring for a rank while it flies under {UTIL_TYPICAL.hold28} h in 28 days.</p>
      <div className="cu-cols">
        <section className="card cu-card">
          <div className="lv-head"><h3>More crew than the flying needs</h3></div>
          {u.surplus.length ? u.surplus.map((s) => <SurplusRow key={`${s.family}:${s.role}`} g={g} s={s} />) : <p className="small muted">None: every family has the crew its sets need and no more.</p>}
          <p className="tiny dim">Counted against the crew sets the flying needs (Planning), and only those with nothing on the roster for four weeks. Nobody leaves without your say: unpaid leave is asked for, furlough is the company-wide cut (Finance), redundancy comes with notice and severance.</p>
        </section>
        <section className="card cu-card">
          <div className="lv-head"><h3>Idle crew</h3><span className="sub small muted">under {UTIL_TYPICAL.idle28} h in 28 days</span></div>
          <div className="lv-table cu-table" role="table">
            <div className="cu-tr lv-th tiny upper dim" role="row"><span>Base · type · rank</span><span className="num">People</span><span className="num">28 days</span><span className="num">Idle</span></div>
            {groups.map((x) => (
              <div key={x.key} className="cu-tr small" role="row">
                <span className="ellipsis">{x.base} · {x.label} · {ROLE_PLURAL[x.role]}</span>
                <span className="num">{x.n}</span>
                <span className={`num ${x.avg28 < UTIL_TYPICAL.hold28 ? 'warn' : ''}`}>{h(x.avg28)}</span>
                <span className={`num ${x.idle ? 'warn' : 'dim'}`}>{x.idle}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="card cu-card">
        <div className="lv-head"><Users className="sc-ico" aria-hidden /><h3>Each person</h3><span className="sub"><Seg<'pilots' | 'cabin'> value={who} onChange={(v) => { setWho(v); setAll(false); }} options={[{ value: 'pilots', label: 'Pilots' }, { value: 'cabin', label: 'Cabin' }]} /></span></div>
        <div className="cu-table" role="table">
          <div className="cu-pr lv-th tiny upper dim" role="row"><span>Least flown first</span><span className="num">Month</span><span className="num">28 d</span><span className="num">12 mo</span></div>
          {shown.map((p) => (
            <button key={p.id} className="cu-pr small" role="row" onClick={() => store.openPerson(p.id)}>
              <span className="row gap-6 cu-name"><b className="ellipsis">{p.name}</b><RankMark role={p.role} /><span className="tiny dim ellipsis">{p.family}{p.away ? ' · away' : ''}</span></span>
              <span className="num">{Math.round(p.month)}</span>
              <span className={`num ${p.idle ? 'warn' : ''}`}>{Math.round(p.d28)}</span>
              <span className="num muted">{Math.round(p.y12)}</span>
            </button>
          ))}
          {people.length > shown.length && <button className="btn btn-ghost" onClick={() => setAll(true)}>Show all {people.length}</button>}
        </div>
      </section>
    </div>
  );
}
