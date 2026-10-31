// v0.7 lease end (UPDATE-0.7.md §F6.6, §F6.7): extend 12 or 36 months, or return to the lessor at the return
// site (ferry + return check, costs posted at the check). Live quotes from leaseView / returnQuote; the same
// choices resolve the 'leaseEnd' decision. v0.7 fix: a card only selects; the footer button commits.
// v0.7.2 (UPDATE-0.7.2.md §6.2): a 'Return early' tab: the end date (30 days' notice), rent saved, deposit, the
// early-return fee and the return costs, with the four-line card when signed work still flies on it.

import { CalendarClock, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { DAY, fmtDate, fmtDayRange, fmtDayRel, yearOf } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { chooseLease, earlyReturnQuote, leaseView, returnEarly, returnQuote, type EarlyReturnQuote, type LeaseChoice } from '../../engine/ops';
import { mkHurt, type ProblemCard } from '../../engine/problems';
import { ProblemCardView } from '../components/ProblemCard';
import { Term } from '../components/Term';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

/** The return costs, line by line, and the deposit coming back (LeaseModal, the lease-end decision). */
export function ReturnLines({ g, aircraftId }: { g: GameState; aircraftId: string }) {
  const q = returnQuote(g, aircraftId);
  if (!q) return null;
  return (
    <div className="ls-lines">
      <div className="upper dim">Return at {q.site} · {q.checkDays}-day check</div>
      {q.lines.map((l) => <div key={l.label} className="row between small"><span className="muted">{l.label}</span><span className="num">{money(l.amount)}</span></div>)}
      <div className="row between small"><b>Return costs</b><b className="num">{money(q.total)}</b></div>
      {q.deposit > 0 && <div className="row between small good"><span>Deposit back at the end</span><span className="num">+{money(q.deposit)}</span></div>}
      {q.ferry.length > 0 && <div className="tiny dim">Return ferry {q.ferry.map((l) => `${l.from}–${l.to}`).join(', ')} {fmtDayRel(q.ferry[0].std, g.now)}</div>}
    </div>
  );
}

type Tab = 'renew' | 'early';

/** The four-line card for an early return that signed work still blocks (local: blockers as WHY). */
function earlyCard(reg: string, aircraftId: string, q: EarlyReturnQuote, now: number): ProblemCard {
  return {
    subject: { kind: 'leaseReturn', ref: { kind: 'aircraft', id: aircraftId } }, severity: 'amber',
    title: `${reg} can't go back early on ${fmtDayRel(q.end, now)}`, what: `${reg} can't go back early on ${fmtDayRel(q.end, now)}`,
    why: `${q.blockers[0]}${q.blockers.length > 1 ? ` (and ${q.blockers.length - 1} more)` : ''}.`,
    hurt: { ...mkHurt({}), text: 'Not yet: nothing lost' },
    actions: [{ id: 'schedule', label: 'Open Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: aircraftId } }, primary: true }],
    details: q.blockers, visuals: {}, terms: ['earlyReturn'],
  };
}

/** v0.7.2: hand the aircraft back before the lease ends. */
function EarlyReturn({ g, aircraftId, end, setEnd }: { g: GameState; aircraftId: string; end: number | null; setEnd: (t: number) => void }) {
  const q0 = earlyReturnQuote(g, aircraftId);
  const ac = g.fleet[aircraftId];
  const leaseEnd = ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.leaseEnd : 0;
  // The earliest workable end, then a month and two later (still 90+ days before the lease end).
  const ends = [q0.end, q0.end + 30 * DAY, q0.end + 61 * DAY].filter((t, i) => i === 0 || leaseEnd - t >= 90 * DAY);
  const at = end ?? q0.end;
  const q = at === q0.end ? q0 : earlyReturnQuote(g, aircraftId, at);
  const r = q.returnCosts;
  return (
    <div className="col gap-12">
      {/* v0.12.1 with the year when it is not this year's (an early return can be a year out). */}
      <p className="muted small">The lessor takes it back {fmtDayRel(q.end, g.now)} after a ferry to {r.site || 'the return site'} and the return check, for an <Term id="earlyReturn">early-return fee</Term>. It needs 30 days' notice.</p>
      {q0.why && !q0.blockers.length ? <div className="small warn">{q0.why}</div> : (
        <>
          <div className="row gap-8 wrap" role="group" aria-label="Return date">
            {ends.map((t, i) => (
              <button key={t} className={`cv-chip rf-chip ${t === at ? 'on' : ''}`} aria-pressed={t === at} onClick={() => setEnd(t)}>
                <b>{fmtDayRel(t, g.now)}</b><span className="tiny dim">{i === 0 ? 'earliest' : `+${i} month${i > 1 ? 's' : ''}`}</span>
              </button>
            ))}
          </div>
          {!q.ok && q.blockers.length > 0 && <ProblemCardView card={earlyCard(ac.reg, aircraftId, q, g.now)} g={g} />}
          <div className="ls-lines">
            <div className="row between small"><span className="muted">Rent saved ({Math.round((leaseEnd - q.end) / (30.44 * DAY))} months)</span><span className="num good">+{money(q.rentSaved)}</span></div>
            {q.deposit > 0 && <div className="row between small"><span className="muted">Deposit back</span><span className="num good">+{money(q.deposit)}</span></div>}
            <div className="row between small"><span className="muted">Early-return fee</span><span className="num">−{money(q.fee)}</span></div>
            <div className="row between small"><span className="muted">Return costs at {r.site} ({r.checkDays}-day check)</span><span className="num">−{money(r.total)}</span></div>
            <div className={`row between small ${q.net >= 0 ? 'good' : 'bad'}`}><b>{q.net >= 0 ? 'Better off by' : 'Costs us'}</b><b className="num">{money(Math.abs(q.net))}</b></div>
          </div>
        </>
      )}
    </div>
  );
}

export function LeaseModal({ aircraftId, tab: tab0 }: { aircraftId: string; tab?: Tab }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const lv = ac ? leaseView(g, aircraftId) : null;
  const [sel, setSel] = useState<LeaseChoice | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const earlyOk = !!lv && !lv.returning && lv.daysLeft >= 90;
  const [tab, setTab] = useState<Tab>(tab0 === 'early' || (tab0 === undefined && lv && lv.daysLeft > 180) ? 'early' : 'renew');
  const close = () => store.closeModal();
  if (!ac || !lv) return null;
  const opt = lv.options.find((o) => o.id === sel && !(o.id === 'return' && lv.returning));
  const commit = () => {
    if (opt && store.act((gg) => chooseLease(gg, aircraftId, opt.id)).ok) close();
  };
  const label = !opt ? 'Choose an option' : opt.id === 'return' ? `Book return · ≈ ${money(opt.cost ?? 0)}` : `${opt.label} · ${money(opt.rent ?? 0)}/month`;
  const m = lv.returning ? g.maintenance[lv.returning.maintId] : undefined;
  const early = tab === 'early' && earlyOk;
  const eq = early ? earlyReturnQuote(g, aircraftId, end ?? undefined) : null;
  const goEarly = () => {
    if (eq && store.act((gg) => returnEarly(gg, aircraftId, eq.end)).ok) close();
  };
  return (
    <Modal className="ls-modal" title={`Lease of ${ac.reg}`} icon={<CalendarClock className="accent" />} onClose={close} footer={
      early ? (
        <>
          <button className="btn" onClick={close}>Close</button>
          <button className="btn btn-primary" onClick={goEarly} disabled={!eq?.ok}><Undo2 /> Return on {fmtDayRel(eq?.end ?? g.now, g.now)} · fee {money(eq?.fee ?? 0)}</button>
        </>
      ) : (
        <>
          {opt && opt.id !== 'extend12' && <span className="grow small muted">{opt.id === 'return' ? `${ac.reg} leaves the fleet at the lease end` : 'Binding for 36 months'}</span>}
          <button className="btn" onClick={close}>Close</button>
          <button className="btn btn-primary" onClick={commit} disabled={!opt}>{label}</button>
        </>
      )
    }>
      <p className="muted small">
        {lv.lessor} · {money(lv.rent)}/month · ends {fmtDate(lv.ends)} ({lv.daysLeft} days).
        {lv.returning && m ? ` Return booked: check at ${lv.returning.site} ${fmtDayRange(m.start, m.end)}${yearOf(m.start) !== yearOf(g.now) ? ` ${yearOf(m.start)}` : ''}.` : ' If nothing is chosen, the lessor extends 12 months.'}
      </p>
      {earlyOk && (
        <div className="mt-12"><Seg<Tab> value={tab} onChange={setTab} options={[{ value: 'renew', label: 'At the lease end' }, { value: 'early', label: 'Return early' }]} /></div>
      )}
      {early ? <div className="mt-12"><EarlyReturn g={g} aircraftId={aircraftId} end={end} setEnd={setEnd} /></div> : (
        <>
          <div className="col gap-8 mt-12">
            {lv.options.map((o) => {
              const cur = o.id === 'return' && !!lv.returning;
              return (
                <button key={o.id} className={`decision-opt sc-opt ${cur ? 'current' : ''} ${sel === o.id ? 'on' : ''}`} aria-pressed={sel === o.id} onClick={() => setSel(o.id)} disabled={cur}>
                  <span className="row between gap-8"><b>{o.label}</b>{o.id === 'extend12' && <span className="badge">Default</span>}{cur && <span className="badge info">Booked</span>}</span>
                  <span className="sc-chips">{o.chips.filter((c) => !/^Deposit \$0 back$/.test(c)).map((c) => <span key={c} className="chip sc-chip">{c}</span>)}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-12"><ReturnLines g={g} aircraftId={aircraftId} /></div>
        </>
      )}
    </Modal>
  );
}
