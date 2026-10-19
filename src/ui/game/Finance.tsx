import { Banknote, Fuel, Landmark, LineChart as LineIcon, PiggyBank, Receipt, Scale, Shield, Wallet } from 'lucide-react';
import { useState } from 'react';
import * as A from '../../engine/actions';
import {
  availableCredit, companyValue, creditRating, equity, loanPayment, monthExpenses, monthProfit, monthRevenue, totalDebt,
} from '../../engine/economy';
import type { ExpCat, GameState, MonthFinance, RevCat } from '../../engine/types';
import { EXP_CATS, REV_CATS } from '../../engine/types';
import { formatDate, monthLabel } from '../../engine/util';
import { Legend, LineChart, PairBars, Sparkline } from '../components/charts';
import { Bar, Card, Kpi, Seg } from '../components/ui';
import { money, pct } from '../format';
import { store, useGame } from '../store';

const REV_LABEL: Record<RevCat, string> = { tickets: 'Ticket sales', ancillary: 'Ancillary (bags, seats)', cargo: 'Belly cargo', other: 'Other income' };
const EXP_LABEL: Record<ExpCat, string> = {
  fuel: 'Fuel', crew: 'Crew', maintenance: 'Maintenance', airport: 'Airport & handling', navigation: 'Air navigation',
  service: 'Catering & service', distribution: 'Sales & distribution', leases: 'Aircraft leases', depreciation: 'Depreciation',
  interest: 'Interest', overhead: 'Staff & overhead', stations: 'Hubs & stations', marketing: 'Marketing', insurance: 'Insurance',
  training: 'Training', licenses: 'Licences & traffic rights', other: 'Other',
};

function sumMonths(ms: MonthFinance[]): MonthFinance {
  const out = structuredClone(ms[0] ?? { key: 0, rev: {}, exp: {}, capex: 0, assetSales: 0, cashEnd: 0, pax: 0, flights: 0 }) as MonthFinance;
  for (const c of REV_CATS) out.rev[c] = ms.reduce((s, m) => s + (m.rev[c] ?? 0), 0);
  for (const c of EXP_CATS) out.exp[c] = ms.reduce((s, m) => s + (m.exp[c] ?? 0), 0);
  return out;
}

function Statement({ g }: { g: GameState }) {
  const cur = g.finance.current;
  const last = g.finance.history[g.finance.history.length - 1];
  const year = g.finance.history.length ? sumMonths(g.finance.history.slice(-12)) : null;
  const cols: { label: string; m: MonthFinance | null }[] = [
    { label: 'This month', m: cur },
    { label: last ? monthLabel(last.key, false) : 'Last month', m: last ?? null },
    { label: 'Last 12 months', m: year },
  ];
  const cell = (key: string, m: MonthFinance | null, f: (m: MonthFinance) => number) => <td key={key} className="num">{m ? money(f(m)) : '—'}</td>;
  const expRows = EXP_CATS.filter((c) => cols.some((x) => x.m && x.m.exp[c] > 0));
  return (
    <div className="table-wrap">
      <table className="table statement">
        <thead>
          <tr><th>Income statement</th>{cols.map((c) => <th key={c.label} className="num">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {REV_CATS.map((c) => (
            <tr key={c}><td>{REV_LABEL[c]}</td>{cols.map((x) => <td key={x.label} className="num">{x.m ? money(x.m.rev[c]) : '—'}</td>)}</tr>
          ))}
          <tr className="subtotal"><td>Total revenue</td>{cols.map((x) => cell(x.label, x.m, monthRevenue))}</tr>
          {expRows.map((c) => (
            <tr key={c}><td className="muted">{EXP_LABEL[c]}</td>{cols.map((x) => <td key={x.label} className="num muted">{x.m ? money(-x.m.exp[c]) : '—'}</td>)}</tr>
          ))}
          <tr className="subtotal"><td>Total expenses</td>{cols.map((x) => cell(x.label, x.m, (m) => -monthExpenses(m)))}</tr>
          <tr className="total">
            <td>Net profit</td>
            {cols.map((x) => {
              const p = x.m ? monthProfit(x.m) : 0;
              return <td key={x.label} className={`num ${p >= 0 ? 'good' : 'bad'}`}>{x.m ? money(p) : '—'}</td>;
            })}
          </tr>
          <tr><td className="dim">Margin</td>{cols.map((x) => <td key={x.label} className="num dim">{x.m && monthRevenue(x.m) > 0 ? pct(monthProfit(x.m) / monthRevenue(x.m), 1) : '—'}</td>)}</tr>
          <tr><td className="dim">Aircraft purchases (capex)</td>{cols.map((x) => <td key={x.label} className="num dim">{x.m ? money(-x.m.capex) : '—'}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

function Loans({ g }: { g: GameState }) {
  const [months, setMonths] = useState<24 | 60 | 120>(60);
  const terms = A.loanTerms(g, months);
  const max = Math.floor(terms.max / 1e6) * 1e6;
  const [amount, setAmount] = useState(Math.min(10e6, Math.max(1e6, max)));
  const amt = Math.min(amount, max);
  return (
    <Card title="Loans" icon={<Landmark className="ico" />} sub={`Credit rating ${creditRating(g)}`}>
      {g.loans.length > 0 && (
        <div className="loan-list mb-12">
          {g.loans.map((l) => (
            <div key={l.id} className="loan">
              <div className="grow">
                <b>{money(l.balance)}</b> <span className="dim small">of {money(l.principal)} · {(l.rate * 100).toFixed(1)}% · {l.monthsLeft} months left</span>
                <Bar value={1 - l.balance / l.principal} size="thin" />
              </div>
              <span className="small num">{money(l.payment)}/mo</span>
              <button className="btn btn-sm" onClick={() => store.act((gg) => A.repayLoan(gg, l.id), { sound: 'cash' })}>Repay</button>
            </div>
          ))}
        </div>
      )}
      {max >= 1e6 ? (
        <div className="col gap-12">
          <div className="row between"><span className="muted small">Borrow</span><b className="num">{money(amt)}</b></div>
          <input type="range" min={1e6} max={max} step={1e6} value={amt} style={{ ['--fill' as string]: `${((amt - 1e6) / Math.max(1, max - 1e6)) * 100}%` }} onChange={(e) => setAmount(Number(e.target.value))} />
          <div className="fin-opt">
            <span className="small muted">Term</span>
            <Seg value={months} onChange={setMonths} options={[{ value: 24, label: '2 years' }, { value: 60, label: '5 years' }, { value: 120, label: '10 years' }]} />
          </div>
          <div className="row between small"><span className="muted">{(terms.rate * 100).toFixed(1)}% interest</span><b className="num">{money(loanPayment(amt, terms.rate, months))}/mo</b></div>
          <button className="btn btn-primary" onClick={() => store.act((gg) => A.takeLoan(gg, amt, months), { sound: 'cash' })}><Banknote /> Take loan</button>
          <div className="tiny dim">Credit available: {money(terms.max)}. Owned aircraft and profits raise your limit.</div>
        </div>
      ) : <div className="small muted">No credit available. Grow profits or buy aircraft to build collateral.</div>}
    </Card>
  );
}

function Hedging({ g }: { g: GameState }) {
  const [p, setP] = useState(0.5);
  const [m, setM] = useState(6);
  const q = A.hedgeQuote(g, p, m);
  const active = g.hedge && g.hedge.until > g.day;
  return (
    <Card title="Fuel hedging" icon={<Fuel className="ico" />} sub="lock in today’s price">
      <div className="row between">
        <div>
          <div className="kpi-value">${g.market.fuel.toFixed(3)}<span className="small dim"> /kg</span></div>
          <div className="tiny dim">Jet fuel spot price</div>
        </div>
        <Sparkline values={g.market.fuelHistory.slice(-52)} color="var(--series-2)" width={150} height={44} />
      </div>
      {active ? (
        <div className="note good small mt-12">Hedged {pct(g.hedge!.pct)} of consumption at ${g.hedge!.price.toFixed(3)}/kg until {formatDate(g.hedge!.until)}.</div>
      ) : (
        <div className="col gap-8 mt-12">
          <div className="fin-opt"><span className="small muted">Coverage</span><Seg value={p} onChange={setP} options={[{ value: 0.25, label: '25%' }, { value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }]} /></div>
          <div className="fin-opt"><span className="small muted">Duration</span><Seg value={m} onChange={setM} options={[{ value: 3, label: '3 mo' }, { value: 6, label: '6 mo' }, { value: 12, label: '12 mo' }]} /></div>
          <button className="btn" disabled={q.cost <= 0} onClick={() => store.act((gg) => A.hedgeFuel(gg, p, m))}><Shield /> Hedge for {money(q.cost)}</button>
          <div className="tiny dim">Premium ≈ 3% of the hedged fuel bill. Protects you from spikes — but you miss the dips.</div>
        </div>
      )}
    </Card>
  );
}

export function Finance() {
  const g = useGame();
  const hist = g.finance.history.slice(-24);
  const labels = hist.map((m) => monthLabel(m.key));
  const rating = creditRating(g);
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Finance</h1>
          <div className="subtitle">Profit & loss, balance sheet, loans and fuel.</div>
        </div>
      </div>
      <div className="kpi-row fin-kpis">
        <Kpi label="Cash" icon={<Wallet />} value={<span className={g.cash < 0 ? 'bad' : ''}>{money(g.cash)}</span>} />
        <Kpi label="Equity" icon={<Scale />} value={money(equity(g))} sub={<span className="dim">Cash + aircraft − debt</span>} />
        <Kpi label="Company value" icon={<LineIcon />} value={money(companyValue(g))} />
        <Kpi label="Debt" icon={<Receipt />} value={money(totalDebt(g))} sub={<span className="dim">{g.loans.length} loans</span>} />
        <Kpi label="Credit rating" icon={<PiggyBank />} value={rating} sub={<span className="dim">{money(availableCredit(g))} available</span>} />
      </div>
      {g.finance.negativeMonths > 0 && <div className="note bad mb-16">Your cash was negative at the end of the month. {4 - g.finance.negativeMonths} month(s) left to recover before bankruptcy.</div>}
      <div className="fin-grid">
        <Card title="Revenue vs expenses" icon={<LineIcon className="ico" />} className="span-2 fin-chart" actions={<Legend items={[{ name: 'Revenue', color: 'var(--series-1)' }, { name: 'Expenses', color: 'var(--series-2)' }]} />}>
          {hist.length ? (
            <PairBars a={{ name: 'Revenue', color: 'var(--series-1)', values: hist.map(monthRevenue) }} b={{ name: 'Expenses', color: 'var(--series-2)', values: hist.map(monthExpenses) }} labels={labels} format={(v) => money(v)} height={220} />
          ) : <div className="empty small">Charts appear after your first full month.</div>}
        </Card>
        <Card title="Cash balance" icon={<Wallet className="ico" />} className="fin-cash">
          {hist.length ? <LineChart series={[{ name: 'Cash', color: 'var(--series-1)', values: hist.map((m) => m.cashEnd) }]} labels={labels} format={(v) => money(v)} height={220} /> : <div className="empty small">No history yet.</div>}
        </Card>
        <Card title="Income statement" icon={<Receipt className="ico" />} className="span-2 fin-statement"><Statement g={g} /></Card>
        <div className="col gap-16 fin-side">
          <Loans g={g} />
          <Hedging g={g} />
        </div>
      </div>
    </div>
  );
}
