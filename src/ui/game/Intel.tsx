import { CalendarDays, Fuel, Globe2, Lock, Radar, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { flag } from '../../data/countries';
import { CONTINENT_ORDER, CONTINENTS, REGION_BY_ID } from '../../data/regions';
import { competition, competitionLabel, marketDemand, totalOf } from '../../engine/demand';
import { upcomingEvents } from '../../engine/events';
import { distance } from '../../engine/geo';
import { airlineRank } from '../../engine/market';
import { formatDate } from '../../engine/util';
import { LineChart } from '../components/charts';
import { Bar, Card, Tabs, useSort } from '../components/ui';
import { dist, int } from '../format';
import { store, useGame } from '../store';
import { AirportTag } from './common';

type ITab = 'markets' | 'events' | 'economy' | 'rivals';

export function Intel() {
  const [tab, setTab] = useState<ITab>('markets');
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Market Intelligence</h1>
          <div className="subtitle">Where the demand is, what’s coming up and who you’re up against.</div>
        </div>
        <div className="actions">
          <Tabs<ITab> value={tab} onChange={setTab} tabs={[
            { id: 'markets', label: 'Top markets', icon: <Radar /> },
            { id: 'events', label: 'Event calendar', icon: <CalendarDays /> },
            { id: 'economy', label: 'Economy & fuel', icon: <Globe2 /> },
            { id: 'rivals', label: 'Rivals', icon: <Trophy /> },
          ]} />
        </div>
      </div>
      {tab === 'markets' && <Markets />}
      {tab === 'events' && <Events />}
      {tab === 'economy' && <Economy />}
      {tab === 'rivals' && <Rivals />}
    </div>
  );
}

function Markets() {
  const g = useGame();
  const [hub, setHub] = useState(g.hubs[0].code);
  const [scope, setScope] = useState<'unlocked' | 'locked'>('unlocked');
  const rows = useMemo(() => AIRPORTS
    .filter((a) => a.code !== hub && distance(hub, a.code) >= 150 && (scope === 'unlocked' ? g.unlockedRegions.includes(a.region) : !g.unlockedRegions.includes(a.region)))
    .map((a) => {
      const m = marketDemand(g, hub, a.code);
      const c = competition(g, hub, a.code);
      const served = g.routes.some((r) => (r.from === hub && r.to === a.code) || (r.to === hub && r.from === a.code));
      return { a, total: totalOf(m) * 2, premium: (m.J + m.F) * 2, d: distance(hub, a.code), comp: c.level, served, trend: g.market.trend[a.code] ?? 1 };
    })
    .sort((x, y) => y.total - x.total)
    .slice(0, 60), [g, hub, scope, g.day >> 3]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sorted, th } = useSort(rows, { key: 'total', dir: -1 }, {
    dest: (x) => x.a.city, d: (x) => x.d, total: (x) => x.total, premium: (x) => x.premium, comp: (x) => x.comp, trend: (x) => x.trend,
  });
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="card intel-markets">
      <div className="card-head">
        <h3>Biggest markets from</h3>
        <select className="select sm" value={hub} onChange={(e) => setHub(e.target.value)}>
          {g.hubs.map((h) => <option key={h.code} value={h.code}>{h.code} · {AIRPORT_BY_CODE[h.code].city}</option>)}
        </select>
        <div className="actions">
          <button className={`chip ${scope === 'unlocked' ? 'active' : ''}`} onClick={() => setScope('unlocked')}>Unlocked regions</button>
          <button className={`chip ${scope === 'locked' ? 'active' : ''}`} onClick={() => setScope('locked')}><Lock size={12} /> Locked (preview)</button>
        </div>
      </div>
      <div className="card-body">
        <div className="table-wrap mk-wrap">
          <table className="table sticky-first">
            <thead>
              <tr>
                {th('dest', 'Destination')}
                {th('d', 'Distance', 'num')}
                {th('total', 'Market / day', 'num')}
                {th('premium', 'Premium / day', 'num')}
                {th('comp', 'Rivals')}
                {th('trend', 'Trend', 'num')}
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((x) => {
                const cl = competitionLabel(x.comp);
                return (
                  <tr key={x.a.code}>
                    <td><div className="mk-dest"><AirportTag code={x.a.code} /><span className="tiny dim">{REGION_BY_ID[x.a.region].name}</span></div></td>
                    <td className="num">{dist(x.d)}</td>
                    <td className="num" style={{ minWidth: 130 }}><div className="row gap-8"><div className="grow"><Bar value={x.total / max} size="thin" /></div>{int(x.total)}</div></td>
                    <td className="num">{int(x.premium)}</td>
                    <td><span className={`small ${cl.tone}`}>{cl.label}</span></td>
                    <td className={`num small ${x.trend > 1.02 ? 'good' : x.trend < 0.98 ? 'bad' : 'dim'}`}>{x.trend >= 1 ? '+' : ''}{Math.round((x.trend - 1) * 100)}%</td>
                    <td>
                      {x.served ? <span className="badge accent">Flying</span> : scope === 'locked' ? <button className="btn btn-sm mk-act" onClick={() => store.navigate('expansion')}><Lock /> Unlock</button> : <button className="btn btn-sm mk-act" onClick={() => store.openModal({ kind: 'planner', hub, dest: x.a.code })}>Plan</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Events() {
  const g = useGame();
  const ev = upcomingEvents(g, 540);
  const active = g.modifiers.filter((m) => m.startDay <= g.day && m.endDay >= g.day && !ev.some((e) => e.id === m.id));
  return (
    <div className="grid-2">
      <Card title="Scheduled events" icon={<CalendarDays className="ico" />} sub="plan capacity ahead">
        <div className="event-list">
          {ev.map((e) => (
            <div key={e.id} className={`event ${e.live ? 'live' : ''}`}>
              <div className="ev-date">
                <span className="mono">{formatDate(e.start).split(' ').slice(0, 2).join(' ')}</span>
                <span className="tiny dim">{Math.max(0, Math.round((e.end - e.start)))} days</span>
              </div>
              <div className="grow">
                <div className="row gap-8"><b>{e.title}</b>{e.live && <span className="badge good">Live</span>}</div>
                <div className="small muted">{e.body}</div>
                <div className="tiny dim mt-8">
                  {e.scope === 'airport' ? e.targets.slice(0, 10).join(' · ') + (e.targets.length > 10 ? ` +${e.targets.length - 10}` : '') : e.targets.map((t) => `${flag(t)} ${t}`).join(' · ')}
                </div>
              </div>
              <span className="badge gold">+{Math.round((e.mult - 1) * 100)}%</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Active market conditions" icon={<Radar className="ico" />}>
        {active.length === 0 && <div className="small muted">No unusual market conditions right now.</div>}
        <div className="event-list">
          {active.map((m) => (
            <div key={m.id} className="event">
              <div className="grow">
                <b>{m.label}</b>
                <div className="tiny dim">{m.kind === 'capacity' ? 'Flights disrupted' : m.kind === 'crew' ? 'Crew costs' : m.kind === 'fees' ? 'Airport charges' : 'Passenger demand'} · until {formatDate(m.endDay)}</div>
              </div>
              <span className={`badge ${(m.kind === 'demand' ? m.mult >= 1 : m.mult <= 1) ? 'good' : 'bad'}`}>{m.mult >= 1 ? '+' : ''}{Math.round((m.mult - 1) * 100)}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Economy() {
  const g = useGame();
  const trends = AIRPORTS.map((a) => ({ a, t: g.market.trend[a.code] ?? 1 }));
  const rising = [...trends].sort((x, y) => y.t - x.t).slice(0, 8);
  const falling = [...trends].sort((x, y) => x.t - y.t).slice(0, 8);
  const fuel = g.market.fuelHistory;
  return (
    <div className="grid-2">
      <Card title="Regional economies" icon={<Globe2 className="ico" />} sub="demand index">
        <div className="col gap-12">
          {CONTINENT_ORDER.map((c) => {
            const e = g.market.econ[c];
            return (
              <div key={c}>
                <div className="row between small"><span className="row gap-8"><span className="dot" style={{ background: CONTINENTS[c].color }} />{CONTINENTS[c].name}</span><b className={e >= 1.02 ? 'good' : e <= 0.98 ? 'bad' : ''}>{e >= 1 ? '+' : ''}{Math.round((e - 1) * 100)}%</b></div>
                <Bar value={(e - 0.7) / 0.6} tone={e >= 1 ? 'good' : 'warn'} />
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Jet fuel price" icon={<Fuel className="ico" />} sub="$/kg, weekly">
        <LineChart series={[{ name: 'Jet fuel', color: 'var(--series-2)', values: fuel }]} labels={fuel.map((_, i) => `Wk ${Math.max(0, Math.floor(g.day / 7) - fuel.length + 1 + i)}`)} format={(v) => `$${v.toFixed(2)}`} zero={false} height={230} />
      </Card>
      <Card title="Rising cities" icon={<TrendingUp className="ico" />}>
        {rising.map(({ a, t }) => <div key={a.code} className="row between small trend-row"><AirportTag code={a.code} /><b className="good">+{Math.round((t - 1) * 100)}%</b></div>)}
      </Card>
      <Card title="Cooling cities" icon={<TrendingDown className="ico" />}>
        {falling.map(({ a, t }) => <div key={a.code} className="row between small trend-row"><AirportTag code={a.code} /><b className="bad">{Math.round((t - 1) * 100)}%</b></div>)}
      </Card>
    </div>
  );
}

export function Rivals() {
  const g = useGame();
  const myPaxM = Math.max(g.stats.yearPax, g.stats.lastYearPax) / 1e6;
  const rows = [...g.ai.map((a) => ({ ...a, me: false })), { id: 'me', name: g.airline.name, code: g.airline.code, color: g.airline.livery.primary, continent: REGION_BY_ID[g.airline.homeRegion].continent, paxM: myPaxM, fleet: g.fleet.length, growth: 0, me: true }]
    .sort((a, b) => b.paxM - a.paxM);
  const max = rows[0].paxM;
  return (
    <Card title="World airline rankings" icon={<Trophy className="ico" />} sub={`You are #${airlineRank(g)}`}>
      <div className="table-wrap">
        <table className="table rivals-table">
          <thead><tr><th>#</th><th>Airline</th><th>Home</th><th className="num">Fleet</th><th>Passengers / year</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.me ? 'selected' : ''}>
                <td className="num dim">{i + 1}</td>
                <td><span className="row gap-8"><span className="dot" style={{ background: r.color }} /><b>{r.name}</b> <span className="code">{r.code}</span>{r.me && <span className="badge accent">You</span>}</span></td>
                <td className="small muted">{CONTINENTS[r.continent].name}</td>
                <td className="num">{int(r.fleet)}</td>
                <td style={{ minWidth: 200 }}><div className="row gap-8"><div className="grow"><Bar value={r.paxM / max} size="thin" /></div><span className="num small">{r.paxM >= 1 ? `${r.paxM.toFixed(1)}M` : int(r.paxM * 1e6)}</span></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
