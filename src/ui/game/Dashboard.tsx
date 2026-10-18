import {
  AlertTriangle, ArrowRight, Fuel, Gauge, Newspaper, Plane, PlaneTakeoff, Plus, Route as RouteIcon, ShoppingCart, Star,
  Target, Trophy, Users, Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS_BY_REGION } from '../../data/airports';
import { monthProfit } from '../../engine/economy';
import { airlineRank } from '../../engine/market';
import { activeGoals, levelProgress } from '../../engine/progression';
import type { GameState } from '../../engine/types';
import { formatDate, hash, monthLabel } from '../../engine/util';
import { BarChart, Sparkline } from '../components/charts';
import { TailBadge } from '../components/Logo';
import { Bar, Card, Kpi, Stars } from '../components/ui';
import { compact, int, money, pct } from '../format';
import { WorldMap } from '../map/WorldMap';
import { store, useClock, useGame } from '../store';
import { mapRotate, routeAircraft, routeWeek } from './common';

export function networkMap(g: GameState, highlight?: string) {
  const maxFreq = Math.max(1, ...g.routes.map((r) => routeAircraft(g, r.id).reduce((s, x) => s + x.freq, 0)));
  const routes = g.routes.map((r) => {
    const freq = routeAircraft(g, r.id).reduce((s, x) => s + x.freq, 0);
    return {
      id: r.id, from: r.from, to: r.to, weight: freq / maxFreq, dashed: freq === 0, highlight: r.id === highlight,
      planes: freq === 0 ? 0 : Math.min(4, Math.ceil(freq / 10)), color: g.airline.livery.primary === '#202733' || g.airline.livery.primary === '#0b1f4d' ? '#3ee6ff' : undefined,
    };
  });
  const served = new Set(g.routes.flatMap((r) => [r.from, r.to]));
  const airports = [...served].map((code) => ({ code, state: g.hubs.some((h) => h.code === code) ? ('hub' as const) : ('served' as const), label: true }));
  return { routes, airports, fit: [...served] };
}

function Onboarding({ g }: { g: GameState }) {
  const hasAircraft = g.fleet.length > 0;
  const hasRoute = g.routes.length > 0;
  const assigned = g.fleet.some((a) => a.assignments.length > 0);
  const steps = [
    { done: hasAircraft, title: 'Get your first aircraft', desc: 'Leasing is the quickest, cheapest way to start — try an ATR 72 or A320neo.', action: () => store.navigate('market', { marketTab: 'lease' }), cta: 'Aircraft Market', icon: <ShoppingCart /> },
    { done: hasRoute, title: 'Open a route', desc: 'Pick a destination with strong demand and low competition.', action: () => store.openModal({ kind: 'planner' }), cta: 'Route Planner', icon: <RouteIcon /> },
    { done: assigned, title: 'Assign the aircraft', desc: 'Set a weekly frequency in the route screen. Then press play!', action: () => store.navigate('routes'), cta: 'Routes', icon: <PlaneTakeoff /> },
  ];
  return (
    <section className="card onboarding">
      <div className="ob-head">
        <div>
          <div className="upper accent">Welcome aboard</div>
          <h2>Let’s get {g.airline.name} into the sky</h2>
          <p className="muted">Three steps to your first revenue flight. Time is paused until you press play (Space).</p>
        </div>
      </div>
      <div className="ob-steps">
        {steps.map((s, i) => (
          <div key={s.title} className={`ob-step ${s.done ? 'done' : ''}`}>
            <div className="ob-n">{s.done ? '✓' : i + 1}</div>
            <div className="grow">
              <b>{s.title}</b>
              <div className="small muted">{s.desc}</div>
            </div>
            {!s.done && <button className="btn btn-primary btn-sm" onClick={s.action}>{s.icon}{s.cta}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

interface BoardRow { time: number; flight: string; dest: string; city: string; type: string; status: string; tone: string; gate: string }

function DepartureBoard({ g }: { g: GameState }) {
  const frac = useClock();
  const hub = g.hubs[0].code;
  const rows = useMemo(() => {
    const out: BoardRow[] = [];
    g.routes.filter((r) => r.from === hub).forEach((r, ri) => {
      const list = routeAircraft(g, r.id);
      const freq = list.reduce((s, x) => s + x.freq, 0);
      if (!freq) return;
      const n = Math.floor(freq / 7) + ((g.day * freq) % 7 < freq % 7 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const h = hash(`${r.id}-${g.day}-${j}`);
        const time = 6 + ((j + 0.5) / n) * 16.5 + ((ri * 0.37) % 1) * 0.8 - 0.4;
        const ac = list[j % list.length].ac;
        const cancelled = ac.lastDisruption === g.day || ac.status !== 'active';
        const delayed = !cancelled && h % 100 < 7;
        out.push({
          time, flight: `${g.airline.code} ${r.flightNo + j * 2}`, dest: r.to, city: AIRPORT_BY_CODE[r.to].city,
          type: AIRCRAFT_BY_ID[ac.typeId].short, status: cancelled ? 'Cancelled' : delayed ? `Delayed ${10 + (h % 5) * 10}m` : '', tone: cancelled ? 'bad' : delayed ? 'warn' : '',
          gate: `${'ABCDE'[h % 5]}${(h >> 3) % 40 + 1}`,
        });
      }
    });
    return out.sort((a, b) => a.time - b.time);
  }, [g, g.day, hub]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = frac * 24;
  const idx = Math.max(0, rows.findIndex((r) => r.time > now - 0.4));
  const visible = rows.slice(Math.max(0, idx - 1), Math.max(0, idx - 1) + 8);
  const fmt = (t: number) => `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`;
  return (
    <section className="card board">
      <div className="board-head">
        <span className="row gap-8"><PlaneTakeoff size={16} /> DEPARTURES</span>
        <span className="mono">{AIRPORT_BY_CODE[hub].city.toUpperCase()} · {hub}</span>
      </div>
      <div className="board-rows">
        <div className="board-row board-th"><span>TIME</span><span>FLIGHT</span><span>DESTINATION</span><span className="hide-sm">GATE</span><span>REMARKS</span></div>
        {visible.length === 0 && <div className="board-empty mono">NO DEPARTURES SCHEDULED</div>}
        {visible.map((r, i) => {
          const departed = r.time + 0.25 < now;
          const boarding = !departed && r.time - 0.6 < now;
          const status = r.status || (departed ? 'Departed' : boarding ? 'Boarding' : 'On time');
          const tone = r.tone || (departed ? 'dim' : boarding ? 'boarding' : 'ok');
          return (
            <div key={`${r.flight}-${i}`} className={`board-row ${departed ? 'departed' : ''}`}>
              <span>{fmt(r.time)}</span>
              <span>{r.flight}</span>
              <span className="ellipsis">{r.city.toUpperCase()}</span>
              <span className="hide-sm">{r.gate}</span>
              <span className={`st ${tone}`}>{status.toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Alerts({ g }: { g: GameState }) {
  const items: { tone: 'bad' | 'warn' | 'info'; text: string; action?: () => void }[] = [];
  if (g.cash < 0) items.push({ tone: 'bad', text: `Cash is negative (${money(g.cash)}). Take a loan or cut costs before you go bankrupt.`, action: () => store.navigate('finance') });
  const idle = g.fleet.filter((a) => a.status === 'active' && !a.assignments.some((x) => x.freq > 0));
  if (idle.length) items.push({ tone: 'warn', text: `${idle.length} aircraft idle — they cost money but earn nothing.`, action: () => store.navigate('fleet') });
  const empty = g.routes.filter((r) => routeAircraft(g, r.id).length === 0);
  if (empty.length) items.push({ tone: 'warn', text: `${empty.length} route${empty.length > 1 ? 's' : ''} without aircraft: ${empty.slice(0, 3).map((r) => `${r.from}–${r.to}`).join(', ')}`, action: () => store.navigate('routes', { routeId: empty[0].id }) });
  const losing = g.routes.filter((r) => r.history.length >= 3 && r.history.slice(-3).every((w) => w.rev < w.cost));
  if (losing.length) items.push({ tone: 'warn', text: `${losing.length} route${losing.length > 1 ? 's are' : ' is'} losing money: ${losing.slice(0, 3).map((r) => `${r.from}–${r.to}`).join(', ')}`, action: () => store.navigate('routes', { routeId: losing[0].id }) });
  const full = g.routes.filter((r) => { const w = routeWeek(r); return w && w.lf > 0.97; });
  if (full.length) items.push({ tone: 'info', text: `${full.length} route${full.length > 1 ? 's are' : ' is'} full — raise fares or add capacity.`, action: () => store.navigate('routes', { routeId: full[0].id }) });
  const worn = g.fleet.filter((a) => a.condition < 45 && a.status === 'active');
  if (worn.length) items.push({ tone: 'warn', text: `${worn.length} aircraft in poor condition — schedule heavy checks.`, action: () => store.navigate('fleet') });
  const deliveries = g.fleet.filter((a) => a.status === 'delivering' && a.statusUntil - g.day <= 14);
  if (deliveries.length) items.push({ tone: 'info', text: `${deliveries.length} aircraft arriving within two weeks.`, action: () => store.navigate('fleet') });
  if (!items.length) items.push({ tone: 'info', text: 'All systems nominal. Keep growing!' });
  return (
    <Card title="Operations alerts" icon={<AlertTriangle className="ico" />}>
      <div className="alerts">
        {items.slice(0, 6).map((it, i) => (
          <button key={i} className={`alert ${it.tone}`} onClick={it.action} disabled={!it.action}>
            <span className="dot" />
            <span className="grow">{it.text}</span>
            {it.action && <ArrowRight size={14} />}
          </button>
        ))}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const g = useGame();
  const lp = levelProgress(g);
  const last = g.finance.history[g.finance.history.length - 1];
  const prev = g.finance.history[g.finance.history.length - 2];
  const lastProfit = last ? monthProfit(last) : 0;
  const weekPax = g.stats.weeklyPax[g.stats.weeklyPax.length - 1] ?? 0;
  const lf = (() => {
    let p = 0, s = 0;
    for (const r of g.routes) { const w = routeWeek(r); if (w) { p += w.pax; s += w.seats; } }
    return s ? p / s : 0;
  })();
  const net = networkMap(g);
  const months = g.finance.history.slice(-12);
  const goals = activeGoals(g, 3);
  const rank = airlineRank(g);
  const myPaxM = Math.max(g.stats.yearPax, g.stats.lastYearPax) / 1e6;
  const ranking = [...g.ai.map((a) => ({ name: a.name, pax: a.paxM, color: a.color, me: false, cont: a.continent })), { name: g.airline.name, pax: myPaxM, color: g.airline.livery.primary, me: true, cont: null }]
    .sort((a, b) => b.pax - a.pax);
  const myIdx = ranking.findIndex((r) => r.me);
  const around = ranking.slice(Math.max(0, myIdx - 2), Math.max(0, myIdx - 2) + 5);
  const news = g.messages.filter((m) => m.category === 'news' || m.category === 'market').slice(0, 5);
  const delivering = g.fleet.filter((a) => a.status === 'delivering').length;

  return (
    <div className="screen dashboard">
      <section className="hero card">
        <div className="hero-bg" style={{ background: `radial-gradient(600px 220px at 0% 0%, ${g.airline.livery.primary}55, transparent 70%)` }} />
        <div className="row gap-16 hero-main">
          <TailBadge primary={g.airline.livery.primary} secondary={g.airline.livery.secondary} code={g.airline.code} size={64} />
          <div className="grow">
            <div className="upper dim">{formatDate(g.day, true)} · {g.hubs.map((h) => h.code).join(' · ')}</div>
            <h1>{g.airline.name}</h1>
            <div className="row gap-12 mt-8 hero-level">
              <span className="badge accent">Level {g.level}</span>
              <span className="muted">{lp.cur.title}</span>
              <div style={{ width: 200 }}><Bar value={lp.pct} /></div>
              <span className="dim small">{lp.next ? `${int(lp.next.xp - g.xp)} XP to ${lp.next.title}` : 'Max level'}</span>
            </div>
          </div>
          <div className="row gap-8 hero-actions">
            <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'planner' })}><Plus /> Plan route</button>
            <button className="btn" onClick={() => store.navigate('market')}><ShoppingCart /> Buy aircraft</button>
          </div>
        </div>
      </section>

      {(g.fleet.length === 0 || g.routes.length === 0 || !g.fleet.some((a) => a.assignments.length > 0)) && <Onboarding g={g} />}

      <div className="kpi-row">
        <Kpi label="Cash" icon={<Wallet />} value={money(g.cash)} sub={<span className={g.cash < 0 ? 'bad' : 'dim'}>{g.loans.length ? `${g.loans.length} loan${g.loans.length > 1 ? 's' : ''}` : 'Debt free'}</span>} />
        <Kpi label="Last month" icon={<Gauge />} value={<span className={lastProfit >= 0 ? 'good' : 'bad'}>{last ? `${lastProfit >= 0 ? '+' : ''}${money(lastProfit)}` : '—'}</span>} sub={prev ? <span className="dim">Prev {money(monthProfit(prev))}</span> : <span className="dim">Net profit</span>} />
        <Kpi label="Passengers / wk" icon={<Users />} value={compact(weekPax)} sub={<span className="dim">{compact(g.stats.totalPax)} all-time</span>}>
          <div className="kpi-spark"><Sparkline values={g.stats.weeklyPax.slice(-26)} /></div>
        </Kpi>
        <Kpi label="Load factor" icon={<Target />} value={g.routes.length ? pct(lf) : '—'} sub={<Bar value={lf} tone="auto" />} />
        <Kpi label="Fleet" icon={<Plane />} value={g.fleet.length - delivering} sub={<span className="dim">{delivering ? `+${delivering} on order` : `${g.routes.length} routes`}</span>} />
        <Kpi label="Reputation" icon={<Star />} value={Math.round(g.reputation)} sub={<Stars value={g.reputation} />} />
      </div>

      <div className="dash-grid">
        <section className="card dash-map">
          <div className="card-head">
            <Plane className="ico" size={16} />
            <h3>Network</h3>
            <span className="sub">{g.routes.length} routes · {net.airports.length} airports</span>
            <div className="actions"><button className="btn btn-sm" onClick={() => store.navigate('map')}>Open map <ArrowRight /></button></div>
          </div>
          <div className="dash-map-body">
            <WorldMap
              rotate={mapRotate(g)}
              routes={net.routes}
              airports={net.airports.length ? net.airports : [{ code: g.hubs[0].code, state: 'hub', label: true }]}
              fit={net.fit.length > 1 ? net.fit : AIRPORTS_BY_REGION[g.airline.homeRegion].map((a) => a.code)}
              interactive={false}
              controls={false}
              animate={store.settings.mapAnimations}
              planesKey={net.routes.map((r) => `${r.id}:${r.planes}`).join(',')}
            />
          </div>
        </section>
        <DepartureBoard g={g} />

        <Card title="Goals" icon={<Trophy className="ico" />} actions={<button className="btn btn-ghost btn-sm" onClick={() => store.navigate('goals')}>All goals</button>}>
          <div className="goal-list">
            {goals.map((goal) => (
              <div key={goal.id} className="goal">
                <div className="row between">
                  <b>{goal.title}</b>
                  <span className="badge gold">{money(goal.reward.cash, 0)}</span>
                </div>
                <div className="small muted">{goal.desc}</div>
                <div className="row gap-8 mt-8">
                  <div className="grow"><Bar value={goal.progress(g)} /></div>
                  <span className="dim small num">{goal.status ? goal.status(g) : pct(goal.progress(g))}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Alerts g={g} />
        <Card title="Monthly net profit" icon={<Wallet className="ico" />} sub="last 12 months">
          {months.length ? (
            <BarChart values={months.map(monthProfit)} labels={months.map((m) => monthLabel(m.key))} format={(v) => money(v)} height={190} name="Net profit" />
          ) : <div className="empty small">Your first monthly results arrive at the end of the month.</div>}
        </Card>
        <Card title="Industry ranking" icon={<Trophy className="ico" />} sub="passengers / year" actions={<span className="badge accent">#{rank}</span>}>
          <div className="rank-list">
            {around.map((r) => (
              <div key={r.name} className={`rank-row ${r.me ? 'me' : ''}`}>
                <span className="dim num">#{ranking.indexOf(r) + 1}</span>
                <span className="dot" style={{ background: r.color }} />
                <span className="grow ellipsis">{r.name}</span>
                <span className="num">{r.pax >= 1 ? `${r.pax.toFixed(1)}M` : `${int(r.pax * 1e6)}`}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Latest news" icon={<Newspaper className="ico" />} className="span-2-lg">
          <div className="news-list">
            {news.map((m) => (
              <div key={m.id} className="news-item">
                <span className={`dot ${m.kind}`} />
                <div>
                  <div className="small"><b>{m.title}</b></div>
                  <div className="tiny dim">{formatDate(m.day)} · {m.body.slice(0, 120)}{m.body.length > 120 ? '…' : ''}</div>
                </div>
              </div>
            ))}
            {!news.length && <div className="small muted">Quiet skies so far.</div>}
          </div>
        </Card>
        <Card title="Fuel" icon={<Fuel className="ico" />} sub="jet fuel $/kg">
          <div className="row between">
            <span className="kpi-value">${g.market.fuel.toFixed(2)}</span>
            <Sparkline values={g.market.fuelHistory.slice(-52)} color="var(--series-2)" width={140} height={40} />
          </div>
          <div className="small muted mt-8">{g.hedge && g.hedge.until > g.day ? `Hedged ${pct(g.hedge.pct)} at $${g.hedge.price.toFixed(2)} until ${formatDate(g.hedge.until)}` : 'No fuel hedge in place.'}</div>
        </Card>
      </div>
    </div>
  );
}
