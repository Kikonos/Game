// v0.16 the bank's dialogs (UPDATE-0.16.md §A; lane finance): open the credit line, borrow against an owned aircraft,
// sell and lease it back, sell an invoice. Each shows the quote line by line, what it costs over time and the one
// reason it cannot be done, then one button.

import { BadgeDollarSign, Landmark, LifeBuoy, Receipt, Repeat } from 'lucide-react';
import { useState } from 'react';
import { BAL } from '../../engine/core/balance';
import { typeOf } from '../../engine/core/perf';
import { fmtDate, fmtDay } from '../../engine/core/time';
import {
  benchmarkRate, borrowingBase, creditOpenWhy, creditTerms, factorQuote, factorInvoice, leasebackQuote, leasebackTermsFor, loanQuote, loanTermsFor, openCreditLine, pct1, sellAndLeaseBack, takeLoan,
} from '../../engine/finance';
import { Modal, Seg } from '../components/ui';
import { applyDistress, distressOptions, furloughQuote, investorQuote, perQuote, planQuote, prepayQuote, rentDeferralQuote, salaryDeferralQuote, stretchChecksQuote, type DistressId } from '../../engine/finance/distress';
import type { CreditorGroup } from '../../engine/core/types';
import { fmtDay as fmtD } from '../../engine/core/time';
import { money } from '../format';
import { store, useGame } from '../store';

const F = BAL.v016.finance;

function Line({ k, v, tone, strong }: { k: string; v: string; tone?: string; strong?: boolean }) {
  return <div className={`row between small gap-12 ${tone ?? ''}`}><span className={strong ? '' : 'muted'}>{k}</span>{strong ? <b className="num nowrap">{v}</b> : <span className="num nowrap">{v}</span>}</div>;
}

function CreditModal({ close }: { close: () => void }) {
  const g = useGame();
  const why = creditOpenWhy(g);
  // v0.16.3 below zero the bank offers a secured line on the borrowing base (engine/finance creditTerms).
  const terms = creditTerms(g);
  const limit = terms.limit;
  const margin = terms.margin;
  const rate = benchmarkRate(g) + margin;
  const fee = terms.fee;
  const open = () => {
    if (store.act((gg) => openCreditLine(gg)).ok) close();
  };
  if (terms.secured) {
    const S = BAL.v0163.secured;
    const b = borrowingBase(g);
    return (
      <Modal title="Ask for a secured credit line" icon={<Landmark className="accent" />} onClose={close} footer={<>
        <span className="grow small muted">Re-priced as a normal line once healthy</span>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" disabled={!!why} onClick={open}><Landmark /> Open the line</button>
      </>}>
        <div className="col gap-12">
          <div className="sl-price"><span className="muted small">The bank lends against security</span><b className="num">{money(limit)}</b></div>
          <div className="ls-lines">
            <Line k={`${Math.round(S.recvShare * 100)} % of receivables due within ${S.recvDays} days`} v={`${money(b.receivables)} → ${money(S.recvShare * b.receivables)}`} />
            <Line k={`${Math.round(S.acShare * 100)} % of owned aircraft without a loan`} v={`${money(b.aircraft)} → ${money(S.acShare * b.aircraft)}`} />
            <Line k="On what is drawn" v={`${pct1(rate)} a year (bank rate ${pct1(benchmarkRate(g))} + ${pct1(margin)})`} tone="warn" />
            <Line k="On the undrawn part" v={`${pct1(F.credit.commitmentFee)} a year`} />
            <Line k={`Arrangement fee (${Math.round(S.arrangementFee * 100)} %)`} v={money(fee)} tone="warn" />
            <Line k="Security" v={b.pledge.length ? b.pledge.map((id) => g.fleet[id]?.reg).filter(Boolean).join(', ') : 'receivables only'} tone="warn" />
          </div>
          <div className="small"><b>Tighter terms.</b> At each month end cash plus undrawn credit must cover {S.liquidityMonths} months' bills, and the bank re-measures the base: anything drawn above it is repaid within the month. The pledged aircraft cannot be sold, borrowed against or leased back until the line is repaid and closed. At the yearly renewal, with cash above zero and no breach, it becomes a normal line and the security is released.</div>
          {why && <div className="small warn">{why}</div>}
        </div>
      </Modal>
    );
  }
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
    body: `${money(q.cashIn)} comes in today (price ${money(q.price)}${q.loanRepaid ? `, less ${money(q.loanRepaid)} to clear the loan` : ''}, less a ${money(q.deposit)} deposit). From then ${ac.reg} costs ${money(q.rentPerMonth)} a month for ${years} years and goes back to ${q.lessor} by ${fmtDate(g.now + Math.round(years * 12 * 30.44 * 1440))} in half-life condition. It cannot be undone.`,
    onConfirm: () => { if (store.act((gg) => sellAndLeaseBack(gg, aircraftId, years)).ok) close(); },
  });
  const end = fmtDate(g.now + Math.round(years * 12 * 30.44 * 1440));
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
      <button className="btn btn-primary" disabled={!!q.why} onClick={sell}><Receipt /> Sell for {money(q.now)} now</button>
    </>}>
      <div className="col gap-12">
        <div className="sl-price"><span className="muted small">The bank pays now</span><b className="num">{money(q.now)}</b></div>
        <div className="row between gap-8 wrap"><span className="upper dim">Risk</span><Seg value={recourse ? 'with' : 'without'} options={[{ value: 'with', label: 'With recourse' }, { value: 'without', label: 'Without recourse' }]} onChange={(v) => setRecourse(v === 'with')} /></div>
        <div className="ls-lines">
          <Line k={`${r.desc}`} v={money(r.amount)} />
          <Line k={q.days >= 0 ? `Due in ${q.days} days` : `${-q.days} days overdue`} v={fmtDay(r.due)} tone={q.days < 0 ? 'warn' : undefined} />
          <Line k={`Advance (${Math.round((q.advance / r.amount) * 100)} %)`} v={money(q.advance)} />
          <Line k={`Fee (${(q.feePct * 100).toFixed(1)} %)`} v={`−${money(q.fee)}`} tone="warn" />
          <Line k="In now" v={money(q.now)} strong />
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

/** v0.16.3 the lines of one way out, by its id, choice and target (the dialog's quote). */
function distressLines(g: ReturnType<typeof useGame>, id: DistressId, choice: number | undefined, target: string | undefined): { head: [string, string] | null; lines: { k: string; v: string; tone?: string; strong?: boolean }[]; note: string; why: string | null } {
  const D = BAL.v0163;
  switch (id) {
    case 'prepay': {
      const q = target ? prepayQuote(g, target) : null;
      if (!q) return { head: null, lines: [], note: '', why: 'Pick an invoice' };
      const r = g.finance.receivables.find((x) => x.id === target);
      return {
        head: ['The client pays now', money(q.now)],
        lines: [{ k: r?.desc ?? 'Invoice', v: money(q.amount) }, { k: `Due in ${q.days} days`, v: r ? fmtD(r.due) : '' }, { k: `Discount (${(q.discount / Math.max(1, q.amount) * 100).toFixed(1)} %)`, v: `−${money(q.discount)}`, tone: 'warn' }, { k: 'In now', v: money(q.now), strong: true }, { k: 'Chance they agree', v: `${Math.round(q.agree * 100)} %` }],
        note: `They will know we needed it: relation ${D.prepay.relation} if they agree, ${D.prepay.refusedRelation} if they refuse (then the invoice simply stays due).`, why: q.why,
      };
    }
    case 'plan': {
      const q = planQuote(g, (target ?? 'mro') as CreditorGroup, choice ?? D.plan.months[1]);
      return {
        head: [`${q.creditor} lets us keep`, money(q.amount)],
        lines: [{ k: 'Their bills, last two months', v: money(q.bills) }, { k: `Spread (${Math.round(D.plan.share * 100)} % of it)`, v: money(q.amount), strong: true }, { k: `Fee (${Math.round(Math.max(D.plan.feeMin, D.plan.feePerMonth * q.months) * 100)} %)`, v: `−${money(q.fee)}`, tone: 'warn' }, { k: `${q.months} parts at the month ends`, v: `about ${money(q.instalment)} each` }],
        note: `The parts are taken whatever the cash. Two taken from an overdrawn account and ${q.creditor} calls the rest at once with a ${Math.round(D.plan.callFee * 100)} % fee and wants cash in advance.`, why: q.why,
      };
    }
    case 'rent': {
      const q = target ? rentDeferralQuote(g, target, choice ?? D.rent.months[0]) : null;
      if (!q) return { head: null, lines: [], note: '', why: 'Pick an aircraft' };
      return {
        head: [`${q.lessor} defers`, money(q.deferred)],
        lines: [{ k: 'Rent a month', v: money(q.rent) }, { k: `Kept at the next ${q.months} month ends`, v: money(q.deferred), strong: true }, { k: `Premium (${Math.round(D.rent.premium * 100)} %)`, v: `−${money(q.premium)}`, tone: 'warn' }, { k: `Repaid over ${q.months} month ends from`, v: fmtD(q.repayFrom) }, { k: `Lease ${q.extendMonths} months longer, to`, v: fmtD(q.newLeaseEnd), tone: 'warn' }],
        note: `Lessors talk: reliability ${D.rent.reliable}, clean ${D.rent.clean}. A repayment taken from an overdrawn account blocks ${q.lessor} for a year and costs reliability ${D.rent.defaultReliable}.`, why: q.why,
      };
    }
    case 'salary': {
      const q = salaryDeferralQuote(g, choice ?? D.salary.months[0]);
      return {
        head: ['Kept at each month end', money(q.perMonth)],
        lines: [{ k: `Crew pay deferred (${Math.round(q.share * 100)} %) and the heads' pay`, v: `${money(q.perMonth)} a month` }, { k: `Over ${q.months} month end${q.months === 1 ? '' : 's'}`, v: money(q.total), strong: true }, { k: `Repaid over ${D.salary.repayMonths} month ends from`, v: fmtD(q.repayFrom) }],
        note: `Morale ${D.salary.morale} now and at each deferred month end: more sick calls and resignations while it runs. No premium: the crew lend us their pay.`, why: q.why,
      };
    }
    case 'furlough': {
      const q = furloughQuote(g, choice ?? D.furlough.shares[0], Number(target ?? D.furlough.weeks[0]));
      const names = q.crewIds.slice(0, 4).map((id) => `${g.crew[id].first} ${g.crew[id].last}`).join(', ');
      return {
        head: ['Saved', money(q.total)],
        lines: [{ k: 'Crew on unpaid leave', v: `${q.crewIds.length}${names ? ` (${names}${q.crewIds.length > 4 ? '…' : ''})` : ''}` }, { k: 'From', v: `${fmtD(q.from)} to ${fmtD(q.until - 1)}` }, { k: 'Pay saved a month', v: money(q.saved) }, { k: `Over ${q.weeks} weeks`, v: money(q.total), strong: true }],
        note: `Those with the least work ahead go first, a share of each role. Morale ${D.furlough.morale} for them and ${D.furlough.moraleOthers} for the rest; resignations follow. Their trips are re-crewed now: check the roster.`, why: q.why,
      };
    }
    case 'checks': {
      const q = stretchChecksQuote(g);
      return {
        head: ['A-checks planned late for', `${q.days} days`],
        lines: [{ k: 'Booked at', v: `about ${Math.round((D.checks.dueX - 1) * 100)} % past the interval` }, { k: 'The authority allows', v: `${Math.round(BAL.overdueTolerance * 100)} % (never passed)` }, { k: 'Until', v: fmtD(q.until) }],
        note: 'Legal, and the checks still happen; the cash just goes out later. Deferred defects pile up meanwhile: more technical delays and AOGs until the next check clears them.', why: q.why,
      };
    }
    case 'investor': {
      const q = investorQuote(g);
      return {
        head: [`${q.name} offers`, money(q.amount)],
        lines: [{ k: 'Clears the overdraft and a month\'s bills', v: money(q.bill) }, { k: 'For', v: `${q.stake} % of the company`, strong: true }, { k: 'The forced rescue would take', v: `${q.forcedStake} %` }, { k: 'Board targets, every quarter', v: `cash above zero · margin ≥ ${Math.round(D.investor.marginMin * 100)} %` }],
        note: `Two quarters missed in a row and the board sells an aircraft; three and it replaces the management (the game ends). Met ${D.investor.metToRelease} quarters running, the board stands down. Reliability ${D.investor.reliable}, clean ${D.investor.clean}.${q.rescue ? ' Signed below zero this counts as your one rescue: insolvent again for 30 days afterwards and the company fails.' : ''}`, why: q.why,
      };
    }
    case 'per': {
      const q = perQuote(g);
      return {
        head: ['Written off today', money(q.writeOff)],
        lines: [{ k: 'Procedure', v: q.procedure }, { k: 'Unsecured claims', v: money(q.claims) }, { k: `Creditors write off ${Math.round(D.per.writeOff * 100)} %`, v: `${money(q.writeOff)} of the overdraft, plus deferrals`, strong: true }, { k: 'Court and advisers', v: `−${money(q.fee)}`, tone: 'warn' }, { k: 'Protection until', v: fmtD(q.until) }, { k: 'No new credit until', v: fmtD(q.noCreditUntil), tone: 'warn' }, { k: 'Label until', v: fmtD(q.labelUntil), tone: 'warn' }],
        note: `Claims are frozen and the 30-day insolvency clock stops for ${q.months} months. The price: reliability ${D.per.reliable}, clean ${D.per.clean}, every client we fly for ${D.per.relation}; some cancel; a lessor may take an aircraft back; offers carry a "Restructuring" label (${Math.round(D.per.ratePct * 100)} % rate, no deposits). Cash below zero on ${fmtD(q.until)} means liquidation: the game ends. Once only.`, why: q.why,
      };
    }
    default:
      return { head: null, lines: [], note: '', why: null };
  }
}

export function DistressModal({ id }: { id: DistressId }) {
  const g = useGame();
  const close = () => store.closeModal();
  const o = distressOptions(g).find((x) => x.id === id);
  const [choice, setChoice] = useState<number | undefined>(o?.choices?.[0]?.value);
  const [target, setTarget] = useState<string | undefined>(o?.targets?.find((t) => !t.why)?.id ?? o?.targets?.[0]?.id);
  if (!o) return <Modal title="Get out of debt" onClose={close}><p className="muted">This option is gone.</p></Modal>;
  const q = distressLines(g, id, choice, target);
  const why = q.why ?? (o.targets?.length && !target ? `Pick ${o.targetLabel?.toLowerCase() ?? 'one'}` : null);
  const danger = id === 'per' || id === 'investor';
  const go = () => {
    const run = () => { if (store.act((gg) => applyDistress(gg, id, choice, target)).ok) close(); };
    if (danger) store.openModal({ kind: 'confirm', title: `${o.title}?`, body: `${q.note} It cannot be undone.`, confirm: o.title, danger: true, onConfirm: run });
    else run();
  };
  return (
    <Modal title={o.title} icon={<LifeBuoy className="accent" />} onClose={close} footer={<>
      <span className="grow small muted">{o.consequence}</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!!why} onClick={go}><LifeBuoy /> {o.title}</button>
    </>}>
      <div className="col gap-12">
        {q.head && <div className="sl-price"><span className="muted small">{q.head[0]}</span><b className="num">{q.head[1]}</b></div>}
        {o.targets && o.targets.length > 0 && (
          <div className="row between gap-8 wrap">
            <span className="upper dim">{o.targetLabel ?? 'For'}</span>
            {o.targets.length <= 3
              ? <Seg value={target ?? ''} options={o.targets.map((t) => ({ value: t.id, label: t.label.split(' · ')[0] }))} onChange={(v) => setTarget(v)} />
              : <select className="select dp-select" value={target ?? ''} aria-label={o.targetLabel ?? 'Target'} onChange={(e) => setTarget(e.target.value)}>{o.targets.map((t) => <option key={t.id} value={t.id}>{t.label}{t.why ? ' · not today' : ''}</option>)}</select>}
          </div>
        )}
        {o.choices && o.choices.length > 0 && <div className="row between gap-8 wrap"><span className="upper dim">{o.choiceLabel ?? 'Choose'}</span><Seg value={choice ?? o.choices[0].value} options={o.choices.map((c) => ({ value: c.value, label: c.label }))} onChange={setChoice} /></div>}
        <div className="ls-lines">{q.lines.map((l, i) => <Line key={i} k={l.k} v={l.v} tone={l.tone} strong={l.strong} />)}</div>
        <div className="small dim">{q.note}</div>
        {why && <div className="small warn">{why}</div>}
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
