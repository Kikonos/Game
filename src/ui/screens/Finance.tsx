// Finance (B5): KPIs, monthly statement (current month + last 5 closed), 90-day cash forecast and
// receivables by due date. DESIGN.md §6.3.

import { Banknote, Clock, Landmark, TrendingUp, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { statementTotals } from '../../engine/core/ledger';
import { DAY, fmtDay, fmtMonth } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { cashForecast } from '../../engine/ops';
import { problemAt } from '../../engine/problems';
import { LineChart } from '../components/charts';
import { ProblemCardView } from '../components/ProblemCard';
import { Why } from '../components/Why';
import { Card, Kpi } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { ScreenHead, useRenderCount } from './common';
import { earnedUnbilled, statementView } from './screenLogic';

const tone = (v: number) => (v < 0 ? 'bad' : v > 0 ? 'good' : '');

function Statement({ g, earned }: { g: GameState; earned: number }) {
  const { months, rows } = statementView(g.finance.current, g.finance.history, 5);
  const totals = months.map((m) => statementTotals(m.lines));
  const cell = (v: number) => (Math.abs(v) < 0.5 ? <span className="dim">—</span> : money(v));
  return (
    <div className="table-wrap">
      <table className="table sc-statement">
        <thead>
          <tr>
            <th>Line</th>
            {months.map((m, i) => <th key={m.month} className="num">{fmtMonth(m.month)}{i === 0 ? ' (so far)' : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.filter((r) => r.revenue).map((r) => (
            <tr key={r.cat}><td>{r.label}</td>{r.values.map((v, i) => <td key={i} className="num">{cell(v)}</td>)}</tr>
          ))}
          <tr className="sc-total"><td>Revenue</td>{totals.map((t, i) => <td key={i} className="num">{money(t.revenue)}</td>)}</tr>
          {rows.filter((r) => !r.revenue).map((r) => (
            <tr key={r.cat}><td>{r.label}</td>{r.values.map((v, i) => <td key={i} className="num">{cell(v)}</td>)}</tr>
          ))}
          <tr className="sc-total"><td>Costs</td>{totals.map((t, i) => <td key={i} className="num">{money(t.costs)}</td>)}</tr>
          <tr className="sc-total sc-profit"><td>Profit</td>{totals.map((t, i) => <td key={i} className={`num ${tone(t.profit)}`}>{money(t.profit)}</td>)}</tr>
          {earned > 0 && <tr><td className="dim">Wet lease earned, invoiced at month end (est.)</td>{months.map((m, i) => <td key={m.month} className="num dim">{i === 0 ? money(earned) : ''}</td>)}</tr>}
          <tr><td className="dim">Block hours</td>{months.map((m) => <td key={m.month} className="num dim">{Math.round(m.bh).toLocaleString('en-US')}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

function Receivables({ g }: { g: GameState }) {
  const open = g.finance.receivables.filter((r) => r.paid === null).sort((a, b) => a.due - b.due);
  if (!open.length) return <div className="small muted sc-pad">No unpaid invoices.</div>;
  return (
    <div className="sc-list">
      {open.slice(0, 30).map((r) => {
        const cl = g.clients[r.clientId];
        const late = g.now - r.due;
        // v0.7.1 §14: a WHY? on an invoice the engine calls a problem (30 days late).
        const prob = late > 0 && r.contractId ? problemAt(g, { kind: 'contract', id: r.contractId }) : null;
        return (
          <div key={r.id} className={`sc-list-row sc-recv ${late > 0 ? 'late' : ''}`} onClick={() => r.contractId && store.navigate('contracts', { view: 'active', sel: { kind: 'contract', id: r.contractId } })}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row gap-8">{prob && <Why refs={{ kind: 'contract', id: r.contractId! }} tone={prob.severity === 'red' ? 'bad' : 'warn'} />}<b className="ellipsis">{cl?.name ?? 'Client'}</b>{cl?.kind === 'government' && <span className="chip sc-chip">Government</span>}{r.factored && <span className="chip sc-chip">Factored</span>}</div>
              <div className="small muted ellipsis">{r.desc} · issued {fmtDay(r.issued)}</div>
            </div>
            <div className="right nowrap">
              <b className="num">{money(r.amount)}</b>
              <div className={`tiny ${late > 0 ? 'warn' : 'dim'}`}>{late > 0 ? `${Math.ceil(late / DAY)} d overdue` : `due ${fmtDay(r.due)}`}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FinanceScreen() {
  useRenderCount('finance');
  const g = useGame();
  const cur = statementTotals(g.finance.current.lines);
  const open = g.finance.receivables.filter((r) => r.paid === null);
  const outstanding = open.reduce((s, r) => s + r.amount, 0);
  const overdue = open.filter((r) => r.due < g.now).reduce((s, r) => s + r.amount, 0);
  const day = Math.floor(g.now / DAY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fc = useMemo(() => {
    try {
      return cashForecast(g, 90);
    } catch {
      return [];
    }
  }, [g, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const low = fc.reduce((m, p) => Math.min(m, p.cash), Infinity);
  // Wet leases invoice at month end; show what is already earned so mid-month profit is not misleading.
  const earned = earnedUnbilled(g);
  // v0.7.1 §14: the money cards on top (cash running out, a losing month) with the date it bites.
  const cards = [problemAt(g, { kind: 'cash', id: 'cash' }), problemAt(g, { kind: 'statement', id: String(g.finance.current.month) })].filter((c) => !!c);
  return (
    <div className="screen sc-finance">
      <ScreenHead title="Finance" sub={`${fmtMonth(g.finance.current.month, false)} so far · revenue when invoiced (wet leases at month end), costs when incurred`} />
      {cards.map((c) => <div key={c.subject.kind} className="fin-card"><ProblemCardView card={c} g={g} /></div>)}
      <div className="sc-kpis">
        <Kpi label="Cash" icon={<Wallet />} value={<span className={g.company.cash < 0 ? 'bad' : ''}>{money(g.company.cash)}</span>} sub={fc.length ? `90-day low ${money(low)}` : undefined} />
        <Kpi label="Revenue" icon={<TrendingUp />} value={money(cur.revenue)} sub={earned > 0 ? <span className="good">+{money(earned)} earned, invoiced at month end</span> : 'invoiced this month'} />
        <Kpi label="Costs" icon={<Banknote />} value={money(cur.costs)} sub="this month" />
        <Kpi label="Profit" icon={<Landmark />} value={<span className={tone(cur.profit)}>{money(cur.profit)}</span>} sub={earned > 0 ? <span className={tone(cur.profit + earned)}>≈ {money(cur.profit + earned)} with earned revenue</span> : 'this month'} />
        <Kpi label="Receivables" icon={<Clock />} value={money(outstanding)} sub={overdue > 0 ? <span className="warn">{money(overdue)} overdue</span> : 'none overdue'} />
      </div>
      <div className="sc-fin-cols mt-16">
        <Card title="Cash forecast" sub="90 days: invoices due, salaries, rent and planned flying">
          {fc.length > 1 ? (
            <LineChart height={190} labels={fc.map((p) => fmtDay(p.t))} series={[{ name: 'Cash', color: 'var(--accent)', values: fc.map((p) => p.cash) }]} format={(v) => money(v)} zero />
          ) : (
            <div className="small muted">No forecast yet.</div>
          )}
        </Card>
        <Card title="Receivables" sub={`${open.length} unpaid · ${money(outstanding)}`} bodyClass="flush">
          <Receivables g={g} />
        </Card>
      </div>
      <Card title="Statement" className="mt-16">
        <Statement g={g} earned={earned} />
      </Card>
    </div>
  );
}
