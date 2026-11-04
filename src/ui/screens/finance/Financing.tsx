// v0.16 Finance › The bank (UPDATE-0.16.md §A; lane finance): the credit line (draw / repay, covenants, renewal), the
// loans per aircraft, spare cash in the money market and the debt line. Each block is short; iPhone landscape stacks
// them. The factoring buttons sit on the receivables rows (Finance.tsx); borrowing and leaseback on the Fleet card.

import { Landmark, Plane, Wallet } from 'lucide-react';
import { useState } from 'react';
import { BAL } from '../../../engine/core/balance';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import {
  benchmarkRate, closeCreditLine, creditLimitFor, creditOpenWhy, creditView, drawCredit, ebitda12, loanPayoff, moneyMarketBalance, moneyMarketRate, netDebt, pct1, repayCredit, repayLoan, totalDebt,
} from '../../../engine/finance';
import { Bar, Card, Stepper } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';

const F = BAL.v016.finance;
const STATUS: Record<string, [string, string]> = { open: ['Open', 'good'], breach: ['In breach', 'bad'], frozen: ['Frozen', 'bad'], closing: ['Not renewed', 'warn'] };

function CreditBlock({ g }: { g: GameState }) {
  const v = creditView(g);
  const [draw, setDraw] = useState<number>(F.credit.drawStep);
  const [repay, setRepay] = useState<number>(F.credit.drawStep);
  if (!v) {
    const why = creditOpenWhy(g);
    const limit = creditLimitFor(g);
    return (
      <div className="fb-block">
        <div className="fb-head"><Landmark /><b>Credit line</b></div>
        <div className="small muted">A revolving line from the bank: draw and repay any time, interest only on what is drawn. The bank sizes it on your last six months' revenue and the owned fleet{limit ? `: about ${money(limit)} today` : ''}.</div>
        <div className="row gap-8 wrap">
          <button className="btn btn-primary" disabled={!!why} onClick={() => store.openModal({ kind: 'financing', what: 'credit' })}><Landmark /> Ask for a credit line…</button>
          {why && <span className="small warn">{why}</span>}
        </div>
      </div>
    );
  }
  const { line } = v;
  const [label, tone] = STATUS[v.status];
  const maxDraw = v.undrawn;
  const maxRepay = Math.min(line.drawn, Math.max(0, g.company.cash));
  const d = Math.min(draw, maxDraw);
  const r = Math.min(repay, maxRepay);
  return (
    <div className="fb-block">
      <div className="fb-head"><Landmark /><b>Credit line</b><span className={`chip sc-chip fb-status ${tone}`}>{label}</span><span className="grow" /><b className="num">{money(line.drawn)}<span className="dim"> / {money(line.limit)}</span></b></div>
      <Bar value={line.limit ? line.drawn / line.limit : 0} tone={v.status === 'open' ? 'auto' : 'bad'} size="thin" title={`${money(line.drawn)} drawn of ${money(line.limit)}`} />
      <div className="small muted">{money(v.undrawn)} undrawn · {pct1(v.rate)} a year on the drawn part · this month so far {money(Math.round(v.accrued))} interest and fees</div>
      <div className="fb-cov">
        {v.lines.map((l, i) => <div key={i} className={`small ${l.endsWith('· broken') ? 'bad' : i === 1 || i === 2 ? 'good' : 'muted'}`}>{l}</div>)}
        {v.repay.map((x) => <div key={x.at} className="small warn">Repayment on the bank's schedule: {money(x.amount)} on {fmtDay(x.at)}</div>)}
      </div>
      <div className="fb-ops">
        <div className="fb-op">
          <span className="upper dim">Draw</span>
          <Stepper value={d} min={Math.min(F.credit.drawStep, maxDraw)} max={maxDraw} step={F.credit.drawStep} onChange={setDraw} format={(x) => money(x)} />
          <button className="btn btn-sm btn-primary" disabled={d <= 0 || !!line.frozen} onClick={() => store.act((gg) => drawCredit(gg, d))}>Draw</button>
        </div>
        <div className="fb-op">
          <span className="upper dim">Repay</span>
          <Stepper value={r} min={Math.min(F.credit.drawStep, maxRepay)} max={maxRepay} step={F.credit.drawStep} onChange={setRepay} format={(x) => money(x)} />
          <button className="btn btn-sm" disabled={r <= 0} onClick={() => store.act((gg) => repayCredit(gg, r))}>Repay</button>
          {line.drawn > 0 && maxRepay > 0 && <button className="btn btn-sm btn-ghost" onClick={() => store.act((gg) => repayCredit(gg, maxRepay))}>All</button>}
        </div>
        {line.drawn <= 0 && !line.notRenewed && <button className="btn btn-sm btn-ghost" onClick={() => store.openModal({ kind: 'confirm', title: 'Close the credit line?', body: 'Nothing is drawn. Closing it stops the commitment fee; a new line costs an arrangement fee again.', confirm: 'Close the line', onConfirm: () => store.act((gg) => closeCreditLine(gg)) })}>Close</button>}
      </div>
    </div>
  );
}

function LoansBlock({ g }: { g: GameState }) {
  const loans = g.treasury?.loans ?? [];
  return (
    <div className="fb-block">
      <div className="fb-head"><Plane /><b>Loans on aircraft</b><span className="grow" />{loans.length > 0 && <b className="num">{money(loans.reduce((s, l) => s + l.balance, 0))}</b>}</div>
      {!loans.length && <div className="small muted">None. Borrow up to {Math.round(F.loan.ltv * 100)} % of an owned aircraft's value from its Fleet card; {F.loan.terms.join(', ')} years, monthly repayments, bank rate + {pct1(F.loan.margin)}.</div>}
      {loans.map((l) => {
        const ac = g.fleet[l.aircraftId];
        const p = loanPayoff(g, l.id)!;
        const due = l.calledDue ?? l.nextDue;
        return (
          <div key={l.id} className="fb-loan">
            <div className="row gap-8 wrap">
              <b>{ac?.reg ?? 'Aircraft'}</b><span className="muted small">{l.bank} · {pct1(l.rate)} fixed</span>
              <span className="grow" />
              <b className="num">{money(l.balance)}</b>
            </div>
            <div className={`small ${l.calledDue ? 'bad' : l.missed.length ? 'warn' : 'muted'}`}>
              {l.calledDue ? `Called: the whole balance is due ${fmtDay(due)}` : `${money(l.instalment)} a month, next ${fmtDay(due)} · ${l.paid} of ${l.months} paid`}{l.missed.length ? ` · ${l.missed.length} missed` : ''}
            </div>
            <div className="row gap-8 wrap">
              <button className="btn btn-sm" disabled={g.company.cash < p.total} onClick={() => store.openModal({
                kind: 'confirm', title: `Repay the loan on ${ac?.reg ?? 'the aircraft'}?`, confirm: `Repay ${money(p.total)}`,
                body: `${money(p.balance)} to ${l.bank}${p.fee ? ` plus a ${money(p.fee)} early repayment fee (${Math.round((l.paid >= l.months / 2 ? F.loan.earlyFeeLate : F.loan.earlyFee) * 100)} % of the balance)` : ''}. The aircraft is free of charge again and can be sold.`,
                onConfirm: () => store.act((gg) => repayLoan(gg, l.id)),
              })}>Repay {money(p.total)}</button>
              {ac && <button className="btn btn-sm btn-ghost" onClick={() => store.navigate('fleet', { sel: { kind: 'aircraft', id: ac.id } })}>Fleet</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CashBlock({ g }: { g: GameState }) {
  const t = g.treasury;
  const bal = moneyMarketBalance(g);
  const debt = totalDebt(g);
  const nd = netDebt(g);
  const e = ebitda12(g);
  const leasebacks = Object.values(g.fleet).filter((a) => a.ownership.kind === 'dryLeaseIn' && a.ownership.leaseback).length;
  return (
    <div className="fb-block">
      <div className="fb-head"><Wallet /><b>Spare cash and debt</b></div>
      <div className="small muted">Bank rate {pct1(benchmarkRate(g))} a year ({g.market.cycle?.phase ?? 'steady'} market).</div>
      <div className="small">
        <span className="muted">Money market: </span>cash above a {money(F.moneyMarket.float)} float earns {pct1(moneyMarketRate(g))}.
        {bal > 0 ? ` ${money(bal)} earning now; ${money(Math.round(t?.mmAccrued ?? 0))} this month so far, paid at the month end.` : ' Nothing above the float today.'}
      </div>
      <div className="small"><span className="muted">Debt: </span>{debt > 0 ? `${money(debt)} (credit line and loans); net of cash ${money(nd)}` : 'none'}. <span className="muted">EBITDA, last 12 months: </span>{money(e)}.</div>
      <div className="small muted">Sell an invoice to the bank from a receivable row ({Math.round(F.factoring.advance * 100)} % now, the rest when the client pays). Sell and lease back an owned aircraft from its Fleet card{leasebacks ? ` (${leasebacks} leased back so far)` : ''}.</div>
    </div>
  );
}

export function Financing({ g }: { g: GameState }) {
  return (
    <Card title="The bank" sub="credit line, loans on aircraft, spare cash" className="mt-16 fin-bank" bodyClass="fb-body">
      <CreditBlock g={g} />
      <LoansBlock g={g} />
      <CashBlock g={g} />
    </Card>
  );
}
