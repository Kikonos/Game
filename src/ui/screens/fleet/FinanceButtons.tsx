// v0.16 Fleet › aircraft card (UPDATE-0.16.md §A.3–A.4; lane finance): "Borrow against it" and "Sell and lease back" on
// an owned aircraft; the loan line when one stands; the lessor line on an aircraft we sold and leased back.

import { BadgeDollarSign, Repeat } from 'lucide-react';
import { fmtDay } from '../../../engine/core/time';
import type { Aircraft, GameState } from '../../../engine/core/types';
import { loanOn, pct1 } from '../../../engine/finance';
import { money } from '../../format';
import { store } from '../../store';

export function FinanceButtons({ g, ac }: { g: GameState; ac: Aircraft }) {
  const o = ac.ownership;
  if (o.kind === 'dryLeaseIn') {
    if (!o.leaseback) return null;
    return <div className="fl-row small"><span className="upper dim nowrap">Leased back</span><span className="muted">Sold to {o.lessor} and leased back: {money(o.rentPerMonth)} a month, back by {fmtDay(o.leaseEnd)}</span></div>;
  }
  if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return null;
  const loan = loanOn(g, ac.id);
  return (
    <>
      {loan && (
        <div className={`fl-row small ${loan.calledDue ? 'warn' : ''}`}>
          <span className="upper dim nowrap">Loan</span>
          <span className="grow muted">{money(loan.balance)} left with {loan.bank} at {pct1(loan.rate)} · {loan.calledDue ? `called: all due ${fmtDay(loan.calledDue)}` : `${money(loan.instalment)} a month, next ${fmtDay(loan.nextDue)}`}</span>
          <button className="btn btn-sm" onClick={() => store.navigate('finance')}>Finance</button>
        </div>
      )}
      {!ac.sale && (
        <div className="row gap-8 fl-actions mt-8">
          {!loan && <button className="btn grow" onClick={() => store.openModal({ kind: 'financing', what: 'loan', id: ac.id })}><BadgeDollarSign /> Borrow against it…</button>}
          <button className="btn grow" onClick={() => store.openModal({ kind: 'financing', what: 'leaseback', id: ac.id })}><Repeat /> Sell and lease back…</button>
        </div>
      )}
    </>
  );
}
