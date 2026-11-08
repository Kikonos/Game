// v0.16 Fleet › aircraft card (UPDATE-0.16.md §A.3–A.4; lane finance): "Borrow against it" and "Sell and lease back" on
// an owned aircraft; the loan line when one stands; the lessor line on an aircraft we sold and leased back.

import { BadgeDollarSign, Repeat } from 'lucide-react';
import { fmtDay } from '../../../engine/core/time';
import type { ReactNode } from 'react';
import type { Aircraft, GameState } from '../../../engine/core/types';
import { loanOn, pct1 } from '../../../engine/finance';
import { money } from '../../format';
import { store } from '../../store';

/** v0.18.1 `lead`: the card's own sale or early-return button, first in the same even row. */
export function FinanceButtons({ g, ac, lead }: { g: GameState; ac: Aircraft; lead?: ReactNode }) {
  const o = ac.ownership;
  const only = lead ? <div className="fl-actions fl-money">{lead}</div> : null;
  if (o.kind === 'dryLeaseIn') {
    if (!o.leaseback) return only;
    return <>{only}<div className="fl-row small"><span className="upper dim nowrap">Leased back</span><span className="muted">Sold to {o.lessor} and leased back: {money(o.rentPerMonth)} a month, back by {fmtDay(o.leaseEnd)}</span></div></>;
  }
  if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return only;
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
      {!ac.sale ? (
        <div className="fl-actions fl-money">
          {lead}
          {!loan && <button className="btn" title="Borrow against it" onClick={() => store.openModal({ kind: 'financing', what: 'loan', id: ac.id })}><BadgeDollarSign /> Borrow…</button>}
          <button className="btn" title="Sell and lease back" onClick={() => store.openModal({ kind: 'financing', what: 'leaseback', id: ac.id })}><Repeat /> Leaseback…</button>
        </div>
      ) : only}
    </>
  );
}
