// v0.16 the bank's dialogs (UPDATE-0.16.md §A; lane finance): open the credit line, borrow against an owned aircraft,
// sell and lease it back, sell an invoice. Each shows the quote line by line, what it costs over time and the one
// reason it cannot be done, then one button.

import { BadgeDollarSign, Landmark, Receipt, Repeat } from 'lucide-react';
import { useState } from 'react';
import { BAL } from '../../engine/core/balance';
import { typeOf } from '../../engine/core/perf';
import { fmtDay } from '../../engine/core/time';
import {
  arrangementFee, benchmarkRate, creditLimitFor, creditMargin, creditOpenWhy, factorQuote, factorInvoice, leasebackQuote, leasebackTermsFor, loanQuote, loanTermsFor, openCreditLine, pct1, sellAndLeaseBack, takeLoan,
} from '../../engine/finance';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

const F = BAL.v016.finance;

function Line({ k, v, tone, strong }: { k: string; v: string; tone?: string; strong?: boolean }) {
  return <div className={`row between small gap-12 ${tone ?? ''}`}><span className={strong ? '' : 'muted'}>{k}</span>{strong ? <b className="num nowrap">{v}</b> : <span className="num nowrap">{v}</span>}</div>;
}

function CreditModal({ close }: { close: () => void }) {
  const g = useGame();
  const why = creditOpenWhy(g);
  const limit = creditLimitFor(g);
  const margin = creditMargin(g);
  const rate = benchmarkRate(g) + margin;
  const fee = arrangementFee(limit);
  const open = () => {
    if (store.act((gg) => openCreditLine(gg)).ok) close();
  };
  return (
    <Modal title="Ask for a credit line" icon={<Landmark className="accent" />} onClose={close} footer={<>
      <span className="grow small muted">Renewed and re-sized every year</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-primary" disabled={!!why} onClick={open}><Landmark /> Open the line</button>
    </>}>
      <div className="col gap-12">
        <div className="sl-price"><span className="muted small">The bank offers</span><b className="num">{money(limit)}</b></div>
        <div className="ls-lines">
          <Line k="Sized on" v={`${F.credit.revenueMonths} × average monthly revenue + ${Math.round(F.credit.bookShare * 100)} % of the owned fleet`} />
          <Line k="On what is drawn" v={`${pct1(rate)} a year (bank rate ${pct1(benchmarkRate(g))} + ${pct1(margin)})`} />
          <Line k="On the undrawn part" v={`${pct1(F.credit.commitmentFee)} a year`} />
          <Line k="Arrangement fee" v={`${money(fee)} now, and at each renewal`} />
          <Line k="Draw and repay" v={`any time, in steps of ${money(F.credit.drawStep)}`} />
        </div>
        <div className="small"><b>Two covenants</b>, checked at every month end: cash plus undrawn credit must cover next month's bill, and net debt must stay under {F.credit.leverage} × the last year's EBITDA. A breach costs a {pct1(F.credit.waiverFee)} waiver fee; a second month adds {pct1(F.credit.stepUp)} to the margin; a third freezes the line and the bank takes the drawn money back in {F.credit.repayParts} parts.</div>
        {why && <div className="small warn">{why}</div>}
      </div>
    </Modal>
  );
}

function LoanModal({ aircraftId, close }: { aircraftId: string; close: () => void }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const terms = ac ? loanTermsFor(g, ac) : [];
  const [years, setYears] = useState(terms.includes(5) ? 5 : terms[terms.length - 1] ?? 5);
  const q = ac ? loanQuote(g, aircraftId, years) : null;
  if (!ac || !q) return <Modal title="Borrow against an aircraft" onClose={close}><p className="muted">This aircraft has left the fleet.</p></Modal>;
  const take = () => {
    if (store.act((gg) => takeLoan(gg, aircraftId, years)).ok) close();
  };
  return (
    <Modal title={`Borrow against ${ac.reg}`} icon={<BadgeDollarSign className="accent" />} onClose={close} footer={<>
      <span className="grow small muted">{q.why ? '' : `${money(q.instalment)} a month for ${years} years`}</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-primary" disabled={!!q.why} onClick={take}><BadgeDollarSign /> Borrow {money(q.principal)}</button>
    </>}>
      <div className="col gap-12">
        <div className="sl-price"><span className="muted small">{q.bank} lends</span><b className="num">{money(q.principal)}</b></div>
        {terms.length > 1 && <div className="row between gap-8 wrap"><span className="upper dim">Term</span><Seg value={years} options={terms.map((y) => ({ value: y, label: `${y} years` }))} onChange={setYears} /></div>}
        <div className="ls-lines">
          <Line k={`Market value ${ac.builtYear} ${typeOf(ac.typeId).short}`} v={money(q.value)} />
          <Line k={`Loan, ${Math.round(F.loan.ltv * 100)} % of it`} v={money(q.principal)} strong />
          <Line k="Fixed rate" v={`${pct1(q.rate)} a year (bank rate + ${pct1(F.loan.margin)})`} />
          <Line k="Monthly instalment" v={`${money(q.instalment)} on the 1st, ${years * 12} times`} />
          <Line k="Interest over the term" v={money(q.interest)} tone="warn" />
          <Line k="Arrangement fee" v={money(q.fee)} tone="warn" />
        </div>
        <div className="small dim">{ac.reg} cannot be sold until the loan is repaid (a sale clears it from the proceeds). Early repayment costs {Math.round(F.loan.earlyFee * 100)} % of the balance, {Math.round(F.loan.earlyFeeLate * 100)} % after half the term. A missed instalment is still taken plus a {Math.round(F.loan.lateFee * 100)} % late fee; two misses in a year and the bank calls the loan.</div>
        {q.why && <div className="small warn">{q.why}</div>}
      </div>
    </Modal>
  );
}

function LeasebackModal({ aircraftId, close }: { aircraftId: string; close: () => void }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const terms = ac ? leasebackTermsFor(g, ac) : [];
  const [years, setYears] = useState(terms.includes(6) ? 6 : terms[terms.length - 1] ?? 6);
  const q = ac ? leasebackQuote(g, aircraftId, years) : null;
  if (!ac || !q) return <Modal title="Sell and lease back" onClose={close}><p className="muted">This aircraft has left the fleet.</p></Modal>;
  const go = () => store.openModal({
    kind: 'confirm', title: `Sell ${ac.reg} to ${q.lessor} and lease it back?`, confirm: `Sell and lease back for ${money(q.price)}`,
    body: `${money(q.cashIn)} comes in today (price ${money(q.price)}${q.loanRepaid ? `, less ${money(q.loanRepaid)} to clear the loan` : ''}, less a ${money(q.deposit)} deposit). From then ${ac.reg} costs ${money(q.rentPerMonth)} a month for ${years} years and goes back to ${q.lessor} by ${fmtDay(g.now + Math.round(years * 12 * 30.44 * 1440))} in half-life condition. It cannot be undone.`,
    onConfirm: () => { if (store.act((gg) => sellAndLeaseBack(gg, aircraftId, years)).ok) close(); },
  });
  const end = fmtDay(g.now + Math.round(years * 12 * 30.44 * 1440));
  return (
    <Modal title={`Sell and lease back ${ac.reg}`} icon={<Repeat className="accent" />} onClose={close} footer={<>
      <span className="grow small muted">{q.why ? '' : `Cash in today ${money(q.cashIn)}`}</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-primary" disabled={!!q.why} onClick={go}><Repeat /> Sell and lease back</button>
    </>}>
      <div className="col gap-12">
        <div className="sl-price"><span className="muted small">{q.lessor} pays</span><b className="num">{money(q.price)}</b></div>
        {terms.length > 1 && <div className="row between gap-8 wrap"><span className="upper dim">Lease</span><Seg value={years} options={terms.map((y) => ({ value: y, label: `${y} years` }))} onChange={setYears} /></div>}
        <div className="ls-lines">
          <Line k="Price" v={`${money(q.price)} (${Math.round(((g.company.standing ?? 0) === 0 ? F.leaseback.priceShareNewcomer : F.leaseback.priceShare) * 100)} % of market value)`} />
          <Line k="Book value" v={money(q.bookValue)} />
          <Line k={q.gain >= 0 ? 'Gain over book value' : 'Loss against book value'} v={`${q.gain >= 0 ? '+' : '−'}${money(Math.abs(q.gain))}`} tone={q.gain >= 0 ? 'good' : 'bad'} />
          {q.loanRepaid > 0 && <Line k="Loan cleared from the price" v={`−${money(q.loanRepaid)}`} tone="warn" />}
          <Line k="Deposit (two months' rent, back at the return)" v={`−${money(q.deposit)}`} tone="warn" />
          <Line k="Cash in today" v={money(q.cashIn)} strong />
        </div>
        <div className="ls-lines">
          <Line k="Rent" v={`${money(q.rentPerMonth)} a month (${(q.lrf * 100).toFixed(2)} % of the price)`} strong />
          <Line k="Maintenance reserves" v={`${money(q.reservesPerFH)} per flight hour`} />
          <Line k={`Rent over ${years} years`} v={money(q.totalRent)} tone="warn" />
          <Line k="Return" v={`by ${end}, half-life condition, ${BAL.leaseReturn.noticeDays ?? 120}-day notice`} />
        </div>
        <div className="small dim">{ac.reg} keeps its registration, crews, contracts and livery; it is simply leased from {q.lessor} from today. Cash now and the debt off the books, against a higher monthly cost over the term and the return conditions.</div>
        {q.why && <div className="small warn">{q.why}</div>}
      </div>
    </Modal>
  );
}

function FactorModal({ receivableId, close }: { receivableId: string; close: () => void }) {
  const g = useGame();
  const r = g.finance.receivables.find((x) => x.id === receivableId);
  const [recourse, setRecourse] = useState(true);
  const q = r ? factorQuote(g, receivableId, recourse) : null;
  if (!r || !q) return <Modal title="Sell an invoice" onClose={close}><p className="muted">This invoice is gone.</p></Modal>;
  const cl = g.clients[r.clientId];
  const sell = () => {
    if (store.act((gg) => factorInvoice(gg, receivableId, recourse)).ok) close();
  };
  return (
    <Modal title={`Sell the invoice: ${cl?.name ?? 'client'}`} icon={<Receipt className="accent" />} onClose={close} footer={<>
      <span className="grow small muted">{q.why ? '' : `${money(q.balance)} more when ${cl?.name ?? 'the client'} pays`}</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-primary" disabled={!!q.why} onClick={sell}><Receipt /> Sell for {money(q.advance)} now</button>
    </>}>
      <div className="col gap-12">
        <div className="sl-price"><span className="muted small">The bank pays now</span><b className="num">{money(q.advance)}</b></div>
        <div className="row between gap-8 wrap"><span className="upper dim">Risk</span><Seg value={recourse ? 'with' : 'without'} options={[{ value: 'with', label: 'With recourse' }, { value: 'without', label: 'Without recourse' }]} onChange={(v) => setRecourse(v === 'with')} /></div>
        <div className="ls-lines">
          <Line k={`${r.desc}`} v={money(r.amount)} />
          <Line k={q.days >= 0 ? `Due in ${q.days} days` : `${-q.days} days overdue`} v={fmtDay(r.due)} tone={q.days < 0 ? 'warn' : undefined} />
          <Line k={`Advance now (${Math.round((q.advance / r.amount) * 100)} %)`} v={money(q.advance)} strong />
          <Line k={`Fee (${(q.feePct * 100).toFixed(1)} %)`} v={`−${money(q.fee)}`} tone="warn" />
          <Line k="The rest, when the client pays" v={money(q.balance)} />
        </div>
        <div className="small dim">{recourse
          ? `With recourse: if ${cl?.name ?? 'the client'} has not paid ${F.factoring.buyBackDays} days past due, the invoice comes back to us and the bank takes its advance back (the fee stays with them).`
          : `Without recourse: the bank keeps the risk. If ${cl?.name ?? 'the client'} never pays, nothing more happens to us; the fee is ${pct1(F.factoring.nonRecourse)} higher${cl?.kind === 'government' ? `, ${pct1(F.factoring.government)} more for a government` : ''}.`}</div>
        {q.why && <div className="small warn">{q.why}</div>}
      </div>
    </Modal>
  );
}

export function FinancingModal({ what, id }: { what: 'loan' | 'leaseback' | 'factor' | 'credit'; id?: string }) {
  const close = () => store.closeModal();
  if (what === 'credit') return <CreditModal close={close} />;
  if (what === 'loan' && id) return <LoanModal aircraftId={id} close={close} />;
  if (what === 'leaseback' && id) return <LeasebackModal aircraftId={id} close={close} />;
  if (what === 'factor' && id) return <FactorModal receivableId={id} close={close} />;
  return null;
}
