// v0.7 lease end (UPDATE-0.7.md §F6.6, §F6.7): extend 12 or 36 months, or return to the lessor at the return
// site (ferry + return check, costs posted at the check). Live quotes from leaseView / returnQuote; the same
// choices resolve the 'leaseEnd' decision. v0.7 fix: a card only selects; the footer button commits.

import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { fmtDate, fmtDay } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { chooseLease, leaseView, returnQuote, type LeaseChoice } from '../../engine/ops';
import { Modal } from '../components/ui';
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
      {q.ferry.length > 0 && <div className="tiny dim">Return ferry {q.ferry.map((l) => `${l.from}–${l.to}`).join(', ')} {fmtDay(q.ferry[0].std)}</div>}
    </div>
  );
}

export function LeaseModal({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const lv = ac ? leaseView(g, aircraftId) : null;
  const [sel, setSel] = useState<LeaseChoice | null>(null);
  const close = () => store.closeModal();
  if (!ac || !lv) return null;
  const opt = lv.options.find((o) => o.id === sel && !(o.id === 'return' && lv.returning));
  const commit = () => {
    if (opt && store.act((gg) => chooseLease(gg, aircraftId, opt.id)).ok) close();
  };
  const label = !opt ? 'Choose an option' : opt.id === 'return' ? `Book return · ≈ ${money(opt.cost ?? 0)}` : `${opt.label} · ${money(opt.rent ?? 0)}/month`;
  const m = lv.returning ? g.maintenance[lv.returning.maintId] : undefined;
  return (
    <Modal className="ls-modal" title={`Lease of ${ac.reg}`} icon={<CalendarClock className="accent" />} onClose={close} footer={
      <>
        {opt && opt.id !== 'extend12' && <span className="grow small muted">{opt.id === 'return' ? `${ac.reg} leaves the fleet at the lease end` : 'Binding for 36 months'}</span>}
        <button className="btn" onClick={close}>Close</button>
        <button className="btn btn-primary" onClick={commit} disabled={!opt}>{label}</button>
      </>
    }>
      <p className="muted small">
        {lv.lessor} · {money(lv.rent)}/month · ends {fmtDate(lv.ends)} ({lv.daysLeft} days).
        {lv.returning && m ? ` Return booked: check at ${lv.returning.site} ${fmtDay(m.start)}–${fmtDay(m.end)}.` : ' If nothing is chosen, the lessor extends 12 months.'}
      </p>
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
    </Modal>
  );
}
