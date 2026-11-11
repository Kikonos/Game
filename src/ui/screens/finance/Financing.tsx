// v0.16 Finance › The bank (UPDATE-0.16.md §A; lane finance): the credit line (draw / repay, covenants, renewal), the
// loans per aircraft, spare cash in the money market and the debt line. The factoring buttons sit on the receivables
// rows (Finance.tsx); borrowing and leaseback on the Fleet card.
// v0.20.1 (report bmwb9xd836zep, "make the bank tab look neater"): one aligned list in the v0.20 At a glance style:
// each row a name, one plain line under it and its number on the right; the terms, covenants and buttons behind a tap.
// One primary action on the card: ask for a credit line while there is none (Draw sits in the open line's details).

import { ChevronDown, ChevronRight, CircleDollarSign, HandCoins, Landmark, Plane, Scale } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BAL } from '../../../engine/core/balance';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import {
  benchmarkRate, closeCreditLine, creditView, drawCredit, ebitda12, loanPayoff, moneyMarketBalance, moneyMarketRate, netDebt, pct1, repayCredit, repayLoan, totalDebt,
} from '../../../engine/finance';
import { covenantBreachCard } from '../../../engine/problems/money';
import { ProblemCardView } from '../../components/ProblemCard';
import { Bar, Card, Stepper } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';
import { creditOfferWords } from './bankLogic';
import { LessorRating } from './LessorRating';

const F = BAL.v016.finance;
const STATUS: Record<string, [string, string]> = { open: ['Open', 'good'], breach: ['In breach', 'bad'], frozen: ['Frozen', 'bad'], closing: ['Not renewed', 'warn'] };

/** One bank row: icon, name and a plain line, the number on the right; tapped, its details below. */
function BankRow({ icon, name, line, value, tone, action, open, onToggle, children }: {
  icon: ReactNode; name: string; line: ReactNode; value: ReactNode; tone?: string; action?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={`fb-row ${open ? 'open' : ''}`}>
      <div className="fb-line">
        <button className="fb-tap" onClick={onToggle} aria-expanded={open}>
          <span className="fb-ico" aria-hidden>{icon}</span>
          <span className="fb-name"><b>{name}</b><span className="small muted">{line}</span></span>
          <span className={`num fb-val ${tone ?? ''}`}>{value}</span>
          {open ? <ChevronDown className="fb-chev" aria-hidden /> : <ChevronRight className="fb-chev" aria-hidden />}
        </button>
        {action && <span className="fb-act">{action}</span>}
      </div>
      {open && <div className="fb-detail small">{children}</div>}
    </div>
  );
}

function CreditRow({ g, open, onToggle }: { g: GameState; open: boolean; onToggle: () => void }) {
  const v = creditView(g);
  const [draw, setDraw] = useState<number>(F.credit.drawStep);
  const [repay, setRepay] = useState<number>(F.credit.drawStep);
  if (!v) {
    // v0.22 the row names the line the dialog offers (below zero: the smaller secured one), never the normal limit.
    const { why, line, limit, secured } = creditOfferWords(g);
    return (
      <BankRow icon={<Landmark />} name="Credit line" line={line} value="None" tone="dim" open={open} onToggle={onToggle}
        action={<button className="btn btn-sm btn-primary" disabled={!!why} onClick={() => store.openModal({ kind: 'financing', what: 'credit' })}>Ask for one</button>}>
        {secured
          ? <p>A revolving line from the bank: draw and repay any time, interest only on what is drawn. With cash below zero the bank lends only against security, unpaid invoices and owned aircraft{limit ? `: about ${money(limit)} today` : ''}.</p>
          : <p>A revolving line from the bank: draw and repay any time, interest only on what is drawn. The bank sizes it on your last six months' revenue and the owned fleet{limit ? `: about ${money(limit)} today` : ''}.</p>}
      </BankRow>
    );
  }
  const { line } = v;
  const [label, tone] = STATUS[v.status];
  const maxDraw = v.undrawn;
  const maxRepay = Math.min(line.drawn, Math.max(0, g.company.cash));
  const d = Math.min(draw, maxDraw);
  const r = Math.min(repay, maxRepay);
  const share = line.limit ? line.drawn / line.limit : 0;
  return (
    <BankRow icon={<Landmark />} name="Credit line" open={open} onToggle={onToggle}
      line={<>{v.status !== 'open' && <span className={`fb-status ${tone}`}>{label} · </span>}{money(v.undrawn)} free · {pct1(v.rate)} a year</>}
      value={<>{money(line.drawn)}<span className="dim"> of {money(line.limit)}</span></>}>
      <Bar value={share} tone={v.status !== 'open' ? 'bad' : share > 0.8 ? 'warn' : 'good'} size="thin" title={`${money(line.drawn)} drawn of ${money(line.limit)}`} />
      <div className="fb-ops">
        <div className="fb-op">
          <span className="fb-op-l dim">Draw</span>
          <Stepper value={d} min={Math.min(F.credit.drawStep, maxDraw)} max={maxDraw} step={F.credit.drawStep} onChange={setDraw} format={(x) => money(x)} />
          <button className="btn btn-sm btn-primary" disabled={d <= 0 || !!line.frozen} onClick={() => store.act((gg) => drawCredit(gg, d))}>Draw</button>
        </div>
        <div className="fb-op">
          <span className="fb-op-l dim">Repay</span>
          <Stepper value={r} min={Math.min(F.credit.drawStep, maxRepay)} max={maxRepay} step={F.credit.drawStep} onChange={setRepay} format={(x) => money(x)} />
          <button className="btn btn-sm" disabled={r <= 0} onClick={() => store.act((gg) => repayCredit(gg, r))}>Repay</button>
          {line.drawn > 0 && maxRepay > 0 && <button className="btn btn-sm btn-ghost" onClick={() => store.act((gg) => repayCredit(gg, maxRepay))}>All</button>}
        </div>
      </div>
      <ul className="fb-terms">
        <li>This month so far: {money(Math.round(v.accrued))} interest and fees.</li>
        {v.lines.map((l, i) => <li key={i} className={l.endsWith('· broken') ? 'bad' : ''}>{l}.</li>)}
        {v.repay.map((x) => <li key={x.at} className="warn">Repayment on the bank's schedule: {money(x.amount)} on {fmtDay(x.at)}.</li>)}
      </ul>
      {line.drawn <= 0 && !line.notRenewed && <div><button className="btn btn-sm btn-ghost" onClick={() => store.openModal({ kind: 'confirm', title: 'Close the credit line?', body: 'Nothing is drawn. Closing it stops the commitment fee; a new line costs an arrangement fee again.', confirm: 'Close the line', onConfirm: () => store.act((gg) => closeCreditLine(gg)) })}>Close the line</button></div>}
    </BankRow>
  );
}

function LoansRow({ g, open, onToggle }: { g: GameState; open: boolean; onToggle: () => void }) {
  const loans = g.treasury?.loans ?? [];
  const total = loans.reduce((s, l) => s + l.balance, 0);
  const bad = loans.some((l) => l.calledDue);
  const late = loans.some((l) => l.missed.length);
  const next = loans.map((l) => l.calledDue ?? l.nextDue).sort((a, b) => a - b)[0];
  const monthly = loans.reduce((s, l) => s + (l.calledDue ? 0 : l.instalment), 0);
  return (
    <BankRow icon={<Plane />} name="Loans on aircraft" open={open} onToggle={onToggle}
      line={!loans.length ? `Up to ${Math.round(F.loan.ltv * 100)} % of an owned aircraft's value` : bad ? 'A loan is called: due in full' : `${loans.length} loan${loans.length === 1 ? '' : 's'} · ${money(monthly)} a month, next ${fmtDay(next)}${late ? ' · missed' : ''}`}
      value={loans.length ? money(total) : 'None'} tone={bad ? 'bad' : late ? 'warn' : loans.length ? '' : 'dim'}>
      {!loans.length && <p>Borrow up to {Math.round(F.loan.ltv * 100)} % of an owned aircraft's value from its Fleet card: {F.loan.terms.join(', ')} years, monthly repayments, bank rate + {pct1(F.loan.margin)}.</p>}
      {loans.map((l) => {
        const ac = g.fleet[l.aircraftId];
        const p = loanPayoff(g, l.id)!;
        const due = l.calledDue ?? l.nextDue;
        return (
          <div key={l.id} className="fb-loan">
            <div className="fb-loan-h"><b>{ac?.reg ?? 'Aircraft'}</b><span className="muted">{l.bank} · {pct1(l.rate)} fixed</span><b className="num fb-loan-v">{money(l.balance)}</b></div>
            <div className={l.calledDue ? 'bad' : l.missed.length ? 'warn' : 'muted'}>
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
    </BankRow>
  );
}

function SpareCashRow({ g, open, onToggle }: { g: GameState; open: boolean; onToggle: () => void }) {
  const bal = moneyMarketBalance(g);
  const accrued = Math.round(g.treasury?.mmAccrued ?? 0);
  return (
    <BankRow icon={<CircleDollarSign />} name="Spare cash" open={open} onToggle={onToggle}
      line={`Above ${money(F.moneyMarket.float)} earns ${pct1(moneyMarketRate(g))} a year`}
      value={bal > 0 ? money(bal) : 'None'} tone={bal > 0 ? 'good' : 'dim'}>
      <p>Cash above a {money(F.moneyMarket.float)} float goes to the money market by itself and earns {pct1(moneyMarketRate(g))} a year, paid at the month end.</p>
      <p>{bal > 0 ? `${money(bal)} earning now; ${money(accrued)} this month so far.` : 'Nothing above the float today.'}</p>
    </BankRow>
  );
}

function DebtRow({ g, open, onToggle }: { g: GameState; open: boolean; onToggle: () => void }) {
  const debt = totalDebt(g);
  const e = ebitda12(g);
  return (
    <BankRow icon={<Scale />} name="Debt" open={open} onToggle={onToggle}
      line={`Bank rate ${pct1(benchmarkRate(g))} · ${g.market.cycle?.phase ?? 'steady'} market`}
      value={debt > 0 ? money(debt) : 'None'} tone={debt > 0 ? 'warn' : 'dim'}>
      <p>{debt > 0 ? `${money(debt)} on the credit line and loans; ${money(netDebt(g))} net of cash.` : 'Nothing borrowed.'}</p>
      <p>Operating earnings before interest and depreciation (EBITDA), last 12 months: <b className={e < 0 ? 'bad' : ''}>{money(e)}</b>. The bank sizes lines and covenants on it.</p>
    </BankRow>
  );
}

function OtherRow({ g, open, onToggle }: { g: GameState; open: boolean; onToggle: () => void }) {
  const leasebacks = Object.values(g.fleet).filter((a) => a.ownership.kind === 'dryLeaseIn' && a.ownership.leaseback).length;
  return (
    <BankRow icon={<HandCoins />} name="Other ways to raise cash" open={open} onToggle={onToggle} line="Sell an invoice, or sell and lease back" value="">
      <p>Sell an invoice to the bank from its row under Receivables: {Math.round(F.factoring.advance * 100)} % now, the rest when the client pays.</p>
      <p>Sell an owned aircraft and lease it back from its Fleet card{leasebacks ? ` (${leasebacks} leased back so far)` : ''}.</p>
    </BankRow>
  );
}

type RowId = 'credit' | 'loans' | 'cash' | 'debt' | 'other';

export function Financing({ g }: { g: GameState }) {
  // The covenant card (four lines) sits on top of the bank while a breach stands.
  const breach = g.treasury?.credit?.breaches ? covenantBreachCard(g) : null;
  const v = creditView(g);
  // The line's details start open while it needs attention (a breach, frozen, not renewed or a repayment due).
  const [open, setOpen] = useState<Set<RowId>>(() => new Set<RowId>(v && (v.status !== 'open' || v.repay.length) ? ['credit'] : []));
  const toggle = (id: RowId) => () => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ref = useRef<HTMLDivElement>(null);
  const focus = store.nav.tab === 'finance' && store.nav.view === 'bank';
  useEffect(() => {
    if (!focus) return;
    setOpen((s) => new Set<RowId>([...s, 'credit']));
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus]);
  const debt = totalDebt(g);
  return (
    <div ref={ref} id="bank-panel">
      <Card title="The bank" icon={<Landmark className="sc-ico" aria-hidden />} sub={debt > 0 ? `${money(debt)} borrowed` : 'nothing borrowed'} className="mt-16 fin-bank" bodyClass="fb-body">
        {breach && <div className="fb-breach"><ProblemCardView card={breach} g={g} /></div>}
        <div className="fb-list">
          <CreditRow g={g} open={open.has('credit')} onToggle={toggle('credit')} />
          <LoansRow g={g} open={open.has('loans')} onToggle={toggle('loans')} />
          <DebtRow g={g} open={open.has('debt')} onToggle={toggle('debt')} />
          <SpareCashRow g={g} open={open.has('cash')} onToggle={toggle('cash')} />
          {/* v0.17 the lessor rating and letters of credit: a row that opens Fleet › Market. */}
          <LessorRating g={g} />
          <OtherRow g={g} open={open.has('other')} onToggle={toggle('other')} />
        </div>
      </Card>
    </div>
  );
}
