import {
  ArrowLeft, ArrowRight, ChevronRight, Megaphone, Plane, Plus, Route as RouteIcon, Search, Sparkles, Swords, Trash2, Users, Wand2, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { flag } from '../../data/countries';
import { REGION_BY_ID } from '../../data/regions';
import { CLASS_COLOR, CLASS_NAME, CLASSES, type CabinClass } from '../../data/seats';
import * as A from '../../engine/actions';
import { cabinSeats, totalSeats } from '../../engine/cabin';
import {
  competition, competitionLabel, forecastRoute, marketDemand, optimizePrices, routeSupply, totalOf,
} from '../../engine/demand';
import { MAX_WEEKLY_HOURS, blockHours, refFare, roundTripHours } from '../../engine/economy';
import { upcomingEvents } from '../../engine/events';
import { distance } from '../../engine/geo';
import type { GameState, Route } from '../../engine/types';
import { formatDate } from '../../engine/util';
import { Legend, PairBars, Sparkline } from '../components/charts';
import { Bar, Card, Empty, Kpi, Modal, Stepper, useSort } from '../components/ui';
import { compact, dist, fare, hours, int, money, pct } from '../format';
import { WorldMap } from '../map/WorldMap';
import { store, useGame } from '../store';
import { useMedia, useTier } from '../useMedia';
import { AirportTag, lfTone, mapRotate, routeAircraft, routeFreq, routeWeek, utilization } from './common';

// ---------------------------------------------------------------------------
// Route list
// ---------------------------------------------------------------------------

export function Routes() {
  const g = useGame();
  const routeId = store.nav.routeId;
  const route = routeId ? g.routes.find((r) => r.id === routeId) : undefined;
  if (route) return <RouteDetail g={g} r={route} />;
  return <RouteList g={g} />;
}

type SortKey = 'route' | 'dist' | 'freq' | 'lf' | 'pax' | 'rev' | 'profit' | 'share';
type Filter = 'all' | 'loss' | 'low' | 'idle';
type Row = { r: Route; w: ReturnType<typeof routeWeek>; freq: number; ac: ReturnType<typeof routeAircraft> };

const SORT_GET: Record<SortKey, (x: Row) => number | string> = {
  route: (x) => `${x.r.from}${x.r.to}`,
  dist: (x) => x.r.dist,
  freq: (x) => x.freq,
  lf: (x) => x.w?.lf ?? -1,
  pax: (x) => x.w?.pax ?? 0,
  rev: (x) => x.w?.rev ?? 0,
  profit: (x) => x.w?.profit ?? -Infinity,
  share: (x) => x.r.last?.share ?? 0,
};
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'profit', label: 'Profit' }, { key: 'rev', label: 'Revenue' }, { key: 'lf', label: 'Load factor' }, { key: 'pax', label: 'Passengers' },
  { key: 'freq', label: 'Frequency' }, { key: 'dist', label: 'Distance' }, { key: 'route', label: 'A–Z' },
];
const FILTERS: { key: Filter; label: string; test: (x: Row) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'loss', label: 'Losing money', test: (x) => !!x.w && x.w.profit < 0 },
  { key: 'low', label: 'Load under 60%', test: (x) => !!x.w && x.w.lf < 0.6 },
  { key: 'idle', label: 'No aircraft', test: (x) => x.freq === 0 },
];

/** Search field with a clear button and iPad-keyboard friendly attributes. */
export function SearchField({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={`search ${className ?? ''}`}>
      <Search size={15} />
      <input
        className="input sm" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {value && <button className="search-clear" onClick={() => onChange('')} aria-label="Clear search"><X /></button>}
    </div>
  );
}

function RouteCell({ r, distInline }: { r: Route; distInline?: boolean }) {
  return (
    <div className="rt-cell">
      <div className="rt-codes"><span className="code">{r.from}</span><ArrowRight size={13} className="dim" /><span className="code">{r.to}</span></div>
      <div className="rt-sub ellipsis">{AIRPORT_BY_CODE[r.from].city} – {AIRPORT_BY_CODE[r.to].city}<span className={distInline ? '' : 'rt-dist'}> · {dist(r.dist)}</span></div>
    </div>
  );
}

function acSummary(ac: Row['ac']) {
  const types = [...new Set(ac.map((x) => AIRCRAFT_BY_ID[x.ac.typeId].short))];
  return `${types.slice(0, 2).join(', ')}${types.length > 2 ? ` +${types.length - 2}` : ''}`;
}

function RouteList({ g }: { g: GameState }) {
  const tier = useTier();
  const rowsView = tier !== 'wide';
  const [hub, setHub] = useState('all');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'profit', dir: -1 });
  const all: Row[] = useMemo(() => g.routes
    .filter((r) => hub === 'all' || r.from === hub)
    .map((r) => ({ r, w: routeWeek(r), freq: routeFreq(g, r.id), ac: routeAircraft(g, r.id) })), [g, g.day, hub]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, all.filter(f.test).length])) as Record<Filter, number>;
  const ql = q.trim().toLowerCase();
  const rows = all
    .filter(FILTERS.find((f) => f.key === filter)!.test)
    .filter((x) => !ql || `${x.r.from} ${x.r.to} ${AIRPORT_BY_CODE[x.r.from].city} ${AIRPORT_BY_CODE[x.r.to].city}`.toLowerCase().includes(ql));
  const get = SORT_GET[sort.key];
  const sorted = [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * sort.dir;
    return ((va as number) - (vb as number)) * sort.dir;
  });
  const pick = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (-s.dir) as 1 | -1 } : { key, dir: key === 'route' ? 1 : -1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');
  const th = (key: SortKey, label: string, className = '') => (
    <th className={`sortable ${sort.key === key ? 'sorted' : ''} ${className}`} onClick={() => pick(key)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {label}{arrow(key)}
    </th>
  );
  const tot = all.reduce((s, x) => ({ rev: s.rev + (x.w?.rev ?? 0), profit: s.profit + (x.w?.profit ?? 0), pax: s.pax + (x.w?.pax ?? 0), seats: s.seats + (x.w?.seats ?? 0), conn: s.conn + (x.w?.conn ?? 0), freq: s.freq + x.freq }), { rev: 0, profit: 0, pax: 0, seats: 0, conn: 0, freq: 0 });
  const open = (id: string) => store.navigate('routes', { routeId: id });

  return (
    <div className="screen routes-screen">
      <div className="screen-head">
        <div>
          <h1>Routes</h1>
          <div className="subtitle">{g.routes.length} routes · {int(tot.freq * 2)} weekly departures</div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'planner' })}><Plus /> Plan new route</button>
        </div>
      </div>
      <div className="route-kpis mb-16">
        <Kpi label="Revenue / week" value={money(tot.rev)} />
        <Kpi label="Route profit / week" value={<span className={tot.profit >= 0 ? 'good' : 'bad'}>{money(tot.profit)}</span>} sub={<span className="dim">Before leases & overheads</span>} />
        <Kpi label="Load factor" value={tot.seats ? pct(tot.pax / tot.seats) : '—'} sub={<Bar value={tot.seats ? tot.pax / tot.seats : 0} tone="auto" />} />
        <Kpi label="Connecting pax" value={tot.pax ? pct(tot.conn / tot.pax, 1) : '—'} sub={<span className="dim">{compact(tot.conn)} per week</span>} />
      </div>
      <section className="card route-card">
        {g.routes.length === 0 ? (
          <Empty icon={<RouteIcon className="big-ico" />} title="No routes yet">
            <p>Open your first route from {g.hubs[0].code}. The planner shows market size and competition for every destination.</p>
            <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'planner' })}><Plus /> Plan a route</button>
          </Empty>
        ) : (
          <>
            <div className="route-tools">
              <SearchField value={q} onChange={setQ} placeholder="Search routes or cities…" className="route-search" />
              {g.hubs.length > 1 && (
                <select className="select sm" value={hub} onChange={(e) => setHub(e.target.value)} aria-label="Hub">
                  <option value="all">All hubs</option>
                  {g.hubs.map((h) => <option key={h.code} value={h.code}>{h.code} · {AIRPORT_BY_CODE[h.code].city}</option>)}
                </select>
              )}
              <div className="chip-row" role="group" aria-label="Filter routes">
                {FILTERS.map((f) => (
                  <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)} disabled={f.key !== 'all' && counts[f.key] === 0 && filter !== f.key}>
                    {f.label} <span className="chip-n">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>
            {rowsView && (
              <div className="chip-row route-sorts" role="group" aria-label="Sort routes">
                <span className="upper dim">Sort</span>
                {SORTS.map((s) => (
                  <button key={s.key} className={`chip ${sort.key === s.key ? 'active' : ''}`} onClick={() => pick(s.key)}>{s.label}{arrow(s.key)}</button>
                ))}
              </div>
            )}
            {sorted.length === 0 ? (
              <div className="empty small">No routes match{q ? ` “${q}”` : ''}.</div>
            ) : rowsView ? (
              <div className="route-rows">
                {sorted.map(({ r, w, freq, ac }) => (
                  <button key={r.id} className="route-row" onClick={() => open(r.id)}>
                    <div className="rr-main"><RouteCell r={r} distInline /></div>
                    <div className="rr-ac">
                      <b>{freq}× <span className="dim">/ wk</span></b>
                      {ac.length ? <span className="dim ellipsis">{acSummary(ac)} · {ac.length} aircraft</span> : <span className="badge warn">No aircraft</span>}
                    </div>
                    <div className="rr-lf">
                      {w ? <><Bar value={w.lf} tone={lfTone(w.lf)} /><span className="num">{pct(w.lf)}</span></> : <span className="dim">—</span>}
                    </div>
                    <div className="rr-money">
                      <b className={w ? (w.profit >= 0 ? 'good' : 'bad') : 'dim'}>{w ? money(w.profit) : '—'}</b>
                      <span className="dim">{w ? `${money(w.rev)} revenue` : 'No results yet'}</span>
                    </div>
                    <ChevronRight className="rr-chev" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table route-table">
                  <thead>
                    <tr>
                      {th('route', 'Route')}
                      {th('dist', 'Distance', 'num col-dist')}
                      <th>Aircraft</th>
                      {th('freq', 'Weekly', 'num')}
                      {th('lf', 'Load factor')}
                      {th('pax', 'Pax / wk', 'num')}
                      {th('rev', 'Revenue / wk', 'num')}
                      {th('profit', 'Profit / wk', 'num')}
                      {th('share', 'Share', 'num col-share')}
                      <th className="col-trend">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(({ r, w, freq, ac }) => (
                      <tr key={r.id} className="clickable" onClick={() => open(r.id)}>
                        <td><RouteCell r={r} /></td>
                        <td className="num col-dist">{dist(r.dist)}</td>
                        <td>{ac.length ? <div className="ac-cell"><span className="ellipsis">{acSummary(ac)}</span><span className="dim">{ac.length} aircraft</span></div> : <span className="badge warn">None</span>}</td>
                        <td className="num">{freq}</td>
                        <td className="lf-cell">{w ? <div className="row gap-8"><div className="grow"><Bar value={w.lf} tone={lfTone(w.lf)} /></div><span className="num small">{pct(w.lf)}</span></div> : <span className="dim">—</span>}</td>
                        <td className="num">{w ? int(w.pax) : '—'}</td>
                        <td className="num">{w ? money(w.rev) : '—'}</td>
                        <td className={`num ${w ? (w.profit >= 0 ? 'good' : 'bad') : ''}`}>{w ? money(w.profit) : '—'}</td>
                        <td className="num col-share">{r.last ? pct(r.last.share) : '—'}</td>
                        <td className="col-trend"><Sparkline values={r.history.slice(-12).map((x) => x.rev - x.cost)} color={w && w.profit < 0 ? 'var(--neg)' : 'var(--pos)'} width={70} height={22} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route detail
// ---------------------------------------------------------------------------

function PricingCard({ g, r }: { g: GameState; r: Route }) {
  const supply = routeSupply(g, r, false);
  const fc = forecastRoute(g, r, supply);
  const offered = CLASSES.filter((c) => supply.seats[c] > 0);
  const classes = offered.length ? offered : (['Y'] as CabinClass[]);
  const set = (c: CabinClass, v: number) => store.update((gg) => { A.setPrices(gg, r.id, { [c]: v }); });
  return (
    <Card title="Fares" icon={<Sparkles className="ico" />} sub="one-way, per passenger" actions={
      <>
        <button className="btn btn-sm btn-ghost" onClick={() => store.update((gg) => { const x = gg.routes.find((y) => y.id === r.id)!; for (const c of CLASSES) x.prices[c] = Math.round(refFare(x.dist, c) / 5) * 5; })}>Market fares</button>
        <button className="btn btn-sm" disabled={!offered.length} onClick={() => store.update((gg) => { const x = gg.routes.find((y) => y.id === r.id)!; x.prices = optimizePrices(gg, x, routeSupply(gg, x, false)); store.toast('good', 'Fares optimised', 'Revenue-maximising fares set for current capacity.'); })}><Wand2 /> Optimise</button>
      </>
    }>
      <div className="fares">
        {classes.map((c) => {
          const ref = refFare(r.dist, c);
          const ratio = r.prices[c] / ref;
          const demand = fc.demand[c];
          const seats = supply.seats[c];
          const lf = seats > 0 ? Math.min(1, demand / seats) : 0;
          return (
            <div key={c} className="fare-row">
              <div className="row between">
                <span className="row gap-8"><span className="dot" style={{ background: CLASS_COLOR[c] }} /><b>{CLASS_NAME[c]}</b></span>
                <span className="row gap-8">
                  <span className={`small ${ratio > 1.15 ? 'warn' : ratio < 0.85 ? 'accent' : 'dim'}`}>{ratio >= 1 ? '+' : ''}{Math.round((ratio - 1) * 100)}% vs market</span>
                  <input className="input sm fare-input num" type="number" inputMode="numeric" enterKeyHint="done" aria-label={`${CLASS_NAME[c]} fare`} value={Math.round(r.prices[c])} min={5} onChange={(e) => set(c, Number(e.target.value))} />
                </span>
              </div>
              <input type="range" aria-label={`${CLASS_NAME[c]} fare vs market`} min={0.5} max={2.5} step={0.01} value={ratio} style={{ ['--fill' as string]: `${((ratio - 0.5) / 2) * 100}%` }} onChange={(e) => set(c, Number(e.target.value) * ref)} />
              <div className="row between tiny dim">
                <span>Market {fare(ref)}</span>
                {seats > 0 ? <span>Est. demand {int(demand * 2)} / {int(seats * 2)} seats daily · <span className={lfTone(lf)}>{pct(lf)}</span></span> : <span>No seats in this cabin</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="small muted mt-12">Higher fares earn more per seat but push passengers to rivals. Est. revenue <b className="num">{money(fc.revenuePerDay * 7)}</b> / week.</div>
    </Card>
  );
}

function AssignCard({ g, r }: { g: GameState; r: Route }) {
  const assigned = routeAircraft(g, r.id);
  const candidates = g.fleet.filter((ac) => ac.hub === r.from && !ac.assignments.some((x) => x.routeId === r.id) && !A.canFly(AIRCRAFT_BY_ID[ac.typeId], r.from, r.to) && A.maxFreqFor(g, ac, r.id) > 0);
  const [pick, setPick] = useState('');
  const sel = candidates.find((c) => c.id === pick) ?? candidates[0];
  const add = () => {
    if (!sel) return;
    store.act((gg) => {
      const ac = gg.fleet.find((x) => x.id === sel.id)!;
      return A.assignAircraft(gg, ac.id, r.id, A.suggestFreq(gg, ac, r.id));
    }, { toastOk: false });
  };
  return (
    <Card title="Aircraft & schedule" icon={<Plane className="ico" />} sub={`${routeFreq(g, r.id)} round trips / week`}>
      {assigned.length === 0 && <div className="small muted mb-12">No aircraft assigned — this route isn’t flying.</div>}
      <div className="assign-list">
        {assigned.map(({ ac, freq }) => {
          const t = AIRCRAFT_BY_ID[ac.typeId];
          const max = A.maxFreqFor(g, ac, r.id);
          return (
            <div key={ac.id} className="assign-row">
              <div className="grow">
                <button className="link reg-link" onClick={() => store.navigate('fleet', { aircraftId: ac.id })}><b>{ac.reg}</b></button>
                <span className="dim small"> · {t.name} · {totalSeats(cabinSeats(t, ac.cabin))} seats</span>
                <div className="row gap-8 mt-8">
                  <div className="grow"><Bar value={utilization(g, ac)} size="thin" /></div>
                  <span className="tiny dim">{pct(utilization(g, ac))} utilised</span>
                </div>
                {ac.status !== 'active' && <span className="badge warn mt-8">{ac.status === 'delivering' ? `Arrives ${formatDate(ac.statusUntil)}` : 'Out of service'}</span>}
              </div>
              <Stepper value={freq} min={0} max={max} onChange={(v) => store.act((gg) => A.assignAircraft(gg, ac.id, r.id, v), { toastOk: false, sound: 'click' })} format={(v) => `${v}×`} />
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => store.act((gg) => A.assignAircraft(gg, ac.id, r.id, 0), { toastOk: false })} aria-label="Remove"><X /></button>
            </div>
          );
        })}
      </div>
      <div className="divider" />
      {candidates.length ? (
        <div className="row gap-8">
          <select className="select sm grow" value={sel?.id ?? ''} onChange={(e) => setPick(e.target.value)}>
            {candidates.map((ac) => {
              const t = AIRCRAFT_BY_ID[ac.typeId];
              return <option key={ac.id} value={ac.id}>{ac.reg} · {t.name} · up to {A.maxFreqFor(g, ac, r.id)}×/wk{ac.assignments.length ? '' : ' · idle'}</option>;
            })}
          </select>
          <button className="btn btn-primary btn-sm" onClick={add}><Plus /> Assign</button>
        </div>
      ) : (
        <div className="row between small">
          <span className="muted">No spare aircraft at {r.from} can fly {dist(r.dist)}.</span>
          <button className="btn btn-sm" onClick={() => store.navigate('market')}>Get aircraft</button>
        </div>
      )}
    </Card>
  );
}

function DemandCard({ g, r }: { g: GameState; r: Route }) {
  const market = marketDemand(g, r.from, r.to);
  const last = r.last;
  const rows = CLASSES.filter((c) => market[c] > 0.5 || (last && last.seats[c] > 0));
  const max = Math.max(1, ...rows.map((c) => Math.max(market[c] * 2, last?.seats[c] ?? 0, last?.demand[c] ?? 0)));
  return (
    <Card title="Demand & capacity" icon={<Users className="ico" />} sub="daily, both directions">
      <div className="demand-rows">
        {rows.map((c) => (
          <div key={c} className="demand-row">
            <div className="row between small"><span className="row gap-8"><span className="dot" style={{ background: CLASS_COLOR[c] }} />{CLASS_NAME[c]}</span><span className="dim num">market {int(market[c] * 2)}</span></div>
            <div className="dbar" title="Market">
              <span className="m" style={{ width: `${(market[c] * 2 / max) * 100}%` }} />
              <span className="d" style={{ width: `${((last?.demand[c] ?? 0) / max) * 100}%`, background: CLASS_COLOR[c] }} />
              {last && last.seats[c] > 0 && <span className="s" style={{ left: `${(last.seats[c] / max) * 100}%` }} />}
            </div>
            <div className="row between tiny dim">
              <span>Your demand {int(last?.demand[c] ?? 0)}</span>
              <span>Seats {int(last?.seats[c] ?? 0)} · flown {int(last?.pax[c] ?? 0)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="tiny dim mt-8">Grey: whole market · colour: passengers choosing you · line: your seats.</div>
    </Card>
  );
}

function MarketCard({ g, r }: { g: GameState; r: Route }) {
  const c = competition(g, r.from, r.to);
  const cl = competitionLabel(c.level);
  const events = upcomingEvents(g, 120).filter((e) => e.targets.some((t) => t === r.from || t === r.to || t === AIRPORT_BY_CODE[r.to].country || t === AIRPORT_BY_CODE[r.from].country));
  return (
    <Card title="Competition" icon={<Swords className="ico" />}>
      <div className="row between"><span className="muted">Rival capacity</span><span className={cl.tone}>{cl.label}</span></div>
      <Bar value={c.level / 2} tone={cl.tone} />
      {c.name && <div className="small mt-8">Main rival: <b>{c.name}</b></div>}
      {c.priceIdx < 0.95 && <div className="badge bad mt-8">Fare war: rivals pricing {Math.round((1 - c.priceIdx) * 100)}% below market</div>}
      <div className="row between mt-12"><span className="muted">Your market share</span><b>{r.last ? pct(r.last.share) : '—'}</b></div>
      <div className="row between"><span className="muted">Connecting passengers</span><b>{r.last ? int(r.last.connPax) : 0}/day</b></div>
      {events.length > 0 && (
        <div className="mt-12">
          <div className="upper dim mb-8">Upcoming events</div>
          {events.map((e) => <div key={e.id} className="small"><span className="badge gold">+{Math.round((e.mult - 1) * 100)}%</span> {e.title} · {formatDate(e.start)}</div>)}
        </div>
      )}
    </Card>
  );
}

function RouteDetail({ g, r }: { g: GameState; r: Route }) {
  const w = routeWeek(r);
  const hist = r.history.slice(-26);
  const A2 = AIRPORT_BY_CODE[r.to];
  const typical = routeAircraft(g, r.id)[0]?.ac;
  const block = typical ? blockHours(AIRCRAFT_BY_ID[typical.typeId], r.dist) : r.dist / 830 + 0.42;
  const promo = r.promoUntil >= g.day;
  const close = () => store.openModal({
    kind: 'confirm', title: `Close ${r.from}–${r.to}?`, body: 'Assigned aircraft become available for other routes. The station stays open if other routes use it.',
    confirm: 'Close route', danger: true, onConfirm: () => { store.act((gg) => A.closeRoute(gg, r.id), { toastOk: false }); store.navigate('routes'); },
  });
  return (
    <div className="screen route-detail">
      <button className="back" onClick={() => store.navigate('routes')}><ArrowLeft /> All routes</button>
      <div className="screen-head">
        <div>
          <div className="route-title">
            <AirportTag code={r.from} city={false} />
            <span className="rt-line"><Plane size={16} /></span>
            <AirportTag code={r.to} city={false} />
            <h1>{AIRPORT_BY_CODE[r.from].city} – {A2.city}</h1>
          </div>
          <div className="subtitle">{flag(A2.country)} {A2.name} · {dist(r.dist)} · ~{hours(block)} block · {g.airline.code} {r.flightNo} · opened {formatDate(r.createdDay)}</div>
        </div>
        <div className="actions">
          <button className="btn" disabled={promo} onClick={() => store.act((gg) => A.promoteRoute(gg, r.id), { sound: 'cash' })}><Megaphone /> {promo ? `Promo until ${formatDate(r.promoUntil)}` : `Promote (${money(A.ROUTE_PROMO_COST(r.dist))})`}</button>
          <button className="btn btn-danger" onClick={close}><Trash2 /> Close</button>
        </div>
      </div>
      <div className="kpi-row">
        <Kpi label="Passengers / wk" value={w ? int(w.pax) : '—'} />
        <Kpi label="Load factor" value={w ? pct(w.lf) : '—'} sub={w && <Bar value={w.lf} tone={lfTone(w.lf)} />} />
        <Kpi label="Revenue / wk" value={w ? money(w.rev) : '—'} />
        <Kpi label="Profit / wk" value={w ? <span className={w.profit >= 0 ? 'good' : 'bad'}>{money(w.profit)}</span> : '—'} sub={<span className="dim">Excl. leases</span>} />
        <Kpi label="Market share" value={r.last ? pct(r.last.share) : '—'} />
        <Kpi label="Lifetime profit" value={<span className={r.lifetime.rev - r.lifetime.cost >= 0 ? 'good' : 'bad'}>{money(r.lifetime.rev - r.lifetime.cost)}</span>} sub={<span className="dim">{compact(r.lifetime.pax)} pax</span>} />
      </div>
      <div className="route-grid">
        <AssignCard g={g} r={r} />
        <PricingCard g={g} r={r} />
        <DemandCard g={g} r={r} />
        <MarketCard g={g} r={r} />
        <Card title="Weekly performance" icon={<RouteIcon className="ico" />} className="span-2" actions={<Legend items={[{ name: 'Revenue', color: 'var(--series-1)' }, { name: 'Costs', color: 'var(--series-2)' }]} />}>
          {hist.length ? (
            <PairBars a={{ name: 'Revenue', color: 'var(--series-1)', values: hist.map((x) => x.rev) }} b={{ name: 'Costs', color: 'var(--series-2)', values: hist.map((x) => x.cost) }} labels={hist.map((x) => `Wk ${x.week}`)} format={(v) => money(v)} />
          ) : <div className="empty small">Weekly results appear after the first full week of flying.</div>}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route planner (modal)
// ---------------------------------------------------------------------------

export function RoutePlanner({ hub: hub0, dest: dest0 }: { hub?: string; dest?: string }) {
  const g = useGame();
  // Narrow dialogs (portrait, Split View) show the list and the details one at a time.
  const steps = useMedia('(max-width: 939.98px)');
  const [hub, setHub] = useState(hub0 ?? g.hubs[0].code);
  const [dest, setDest] = useState<string | null>(dest0 ?? null);
  const [showDetail, setShowDetail] = useState(!!dest0);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('all');
  const cands = useMemo(() => AIRPORTS
    .filter((a) => a.code !== hub && g.unlockedRegions.includes(a.region) && distance(hub, a.code) >= 150)
    .map((a) => {
      const m = marketDemand(g, hub, a.code);
      const c = competition(g, hub, a.code);
      const existing = g.routes.find((r) => (r.from === hub && r.to === a.code) || (r.to === hub && r.from === a.code));
      return { a, total: totalOf(m) * 2, d: distance(hub, a.code), comp: c.level, err: A.routeCheck(g, hub, a.code), existing, score: (totalOf(m) * 2) / (0.5 + c.level) };
    }), [g, hub]); // eslint-disable-line react-hooks/exhaustive-deps
  const ql = q.trim().toLowerCase();
  const filtered = cands.filter((x) => (region === 'all' || x.a.region === region) && (!ql || `${x.a.code} ${x.a.city} ${x.a.name}`.toLowerCase().includes(ql)));
  const { sorted, th } = useSort(filtered, { key: 'score', dir: -1 }, {
    dest: (x) => x.a.city, dist: (x) => x.d, total: (x) => x.total, comp: (x) => x.comp, score: (x) => x.score,
  });
  const regions = [...new Set(cands.map((c) => c.a.region))];
  const maxScore = Math.max(1, ...cands.map((c) => c.score));
  const sel = dest ? cands.find((c) => c.a.code === dest) : undefined;
  const cost = sel ? A.routeOpenCost(g, sel.a.code) : 0;

  const open = () => {
    if (!sel) return;
    const res = store.act((gg) => A.openRoute(gg, hub, sel.a.code), { toastOk: false });
    if (res.ok && 'routeId' in res && res.routeId) {
      store.closeModal();
      store.navigate('routes', { routeId: res.routeId });
    }
  };
  const choose = (code: string) => { setDest(code); setShowDetail(true); };

  const footer = (
    <>
      <div className="planner-foot grow">
        {sel ? (
          <>
            <b>{hub} → {sel.a.code}</b>
            <span className="dim small ellipsis">{sel.a.city} · {dist(sel.d)}{sel.err && !sel.existing ? ` · ${sel.err}` : ''}</span>
          </>
        ) : <span className="dim small">Pick a destination to see its market.</span>}
      </div>
      {sel?.existing ? (
        <button className="btn" onClick={() => { store.closeModal(); store.navigate('routes', { routeId: sel.existing!.id }); }}><RouteIcon /> View route</button>
      ) : (
        <button className="btn btn-primary" disabled={!sel || !!sel.err} onClick={open}><Plus /> Open route{sel && !sel.err && cost ? ` · ${money(cost)}` : ''}</button>
      )}
    </>
  );

  return (
    <Modal title="Route planner" icon={<RouteIcon className="accent" />} size="xwide" className="planner-modal" onClose={() => store.closeModal()} footer={footer}>
      <div className={`planner ${steps ? 'steps' : ''} ${steps && showDetail && sel ? 'show-detail' : ''}`}>
        <div className="planner-list">
          <div className="planner-tools">
            <select className="select sm" value={hub} onChange={(e) => { setHub(e.target.value); setDest(null); setShowDetail(false); }} aria-label="From hub">
              {g.hubs.map((h) => <option key={h.code} value={h.code}>From {h.code} · {AIRPORT_BY_CODE[h.code].city}</option>)}
            </select>
            <select className="select sm" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
              <option value="all">All unlocked regions</option>
              {regions.map((r) => <option key={r} value={r}>{REGION_BY_ID[r].name}</option>)}
            </select>
            <SearchField value={q} onChange={setQ} placeholder="Search destinations…" className="grow" />
          </div>
          <div className="planner-scroll">
            {sorted.length === 0 ? <div className="empty small">No destinations match{q ? ` “${q}”` : ''}.</div> : (
              <table className="table planner-table">
                <thead>
                  <tr>
                    {th('dest', 'Destination')}
                    {th('dist', 'Distance', 'num col-dist')}
                    {th('total', 'Market / day', 'num')}
                    {th('comp', 'Rivals')}
                    {th('score', 'Opportunity')}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((x) => {
                    const cl = competitionLabel(x.comp);
                    return (
                      <tr key={x.a.code} className={`clickable ${dest === x.a.code ? 'selected' : ''}`} onClick={() => choose(x.a.code)}>
                        <td>
                          <div className="pl-dest">
                            <div className="pl-name"><span className="code">{x.a.code}</span><span className="ellipsis">{flag(x.a.country)} {x.a.city}</span></div>
                            <div className="pl-sub dim">
                              <span className="pl-dist">{dist(x.d)} · </span>{REGION_BY_ID[x.a.region].name}
                              {x.existing && <span className="badge accent">Flying</span>}
                            </div>
                          </div>
                        </td>
                        <td className="num col-dist">{dist(x.d)}</td>
                        <td className="num">{int(x.total)}</td>
                        <td><span className={`small ${cl.tone}`}>{cl.label}</span></td>
                        <td className="pl-score"><Bar value={x.score / maxScore} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="planner-detail">
          {steps && <button className="back" onClick={() => setShowDetail(false)}><ArrowLeft /> All destinations</button>}
          {sel ? <PlannerDetail g={g} hub={hub} sel={sel} /> : (
            <Empty icon={<Search className="big-ico" />} title="Pick a destination">
              <p className="small">Opportunity weighs market size against competition. Business-heavy cities pay higher fares; leisure spots swing with the seasons.</p>
            </Empty>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PlannerDetail({ g, hub, sel }: { g: GameState; hub: string; sel: { a: typeof AIRPORTS[number]; d: number; err: string | null; existing?: Route } }) {
  const a = sel.a;
  const m = marketDemand(g, hub, a.code);
  const c = competition(g, hub, a.code);
  const cl = competitionLabel(c.level);
  const cost = A.routeOpenCost(g, a.code);
  const fleetFits = g.fleet.filter((ac) => ac.hub === hub && !A.canFly(AIRCRAFT_BY_ID[ac.typeId], hub, a.code));
  const types = [...new Set(fleetFits.map((ac) => ac.typeId))];
  const sample = AIRCRAFT_BY_ID[types[0] ?? (sel.d < 600 ? 'atr72' : sel.d < 5500 ? 'a320neo' : 'b789')];
  const rt = roundTripHours(sample, sel.d);
  return (
    <div className="col gap-12">
      <div className="planner-map card">
        <WorldMap rotate={mapRotate(g)} routes={[{ id: 'p', from: hub, to: a.code, weight: 1, highlight: true, planes: 1 }]} airports={[{ code: hub, state: 'hub', label: true }, { code: a.code, state: 'served', label: true }]} fit={[hub, a.code]} interactive={false} controls={false} animate={store.settings.mapAnimations} />
      </div>
      <div>
        <h2>{AIRPORT_BY_CODE[hub].city} → {a.city}</h2>
        <div className="small muted">{flag(a.country)} {a.name} · {REGION_BY_ID[a.region].name}</div>
      </div>
      {sel.err && !sel.existing && <div className="badge warn planner-err">{sel.err}</div>}
      <div className="grid-2 planner-stats">
        <div><span className="dim small">Distance</span><b>{dist(sel.d)}</b></div>
        <div><span className="dim small">Block time ({sample.short})</span><b>{hours(blockHours(sample, sel.d))}</b></div>
        <div><span className="dim small">Market (both ways)</span><b>{int(totalOf(m) * 2)} / day</b></div>
        <div><span className="dim small">Competition</span><b className={cl.tone}>{cl.label}</b></div>
        <div><span className="dim small">Max frequency ({sample.short})</span><b>{Math.floor(MAX_WEEKLY_HOURS / rt)}× / week</b></div>
        <div><span className="dim small">Station set-up</span><b>{cost ? money(cost) : 'Already served'}</b></div>
      </div>
      <div className="class-mix">
        {CLASSES.filter((cl2) => m[cl2] > 0.3).map((cl2) => (
          <div key={cl2} className="row between small">
            <span className="row gap-8"><span className="dot" style={{ background: CLASS_COLOR[cl2] }} />{CLASS_NAME[cl2]}</span>
            <span className="num">{int(m[cl2] * 2)}/day · {fare(refFare(sel.d, cl2))}</span>
          </div>
        ))}
      </div>
      <div className="small muted">
        {fleetFits.length
          ? `${fleetFits.length} of your aircraft at ${hub} can fly this route (${types.map((t) => AIRCRAFT_BY_ID[t].short).join(', ')}).`
          : `None of your aircraft at ${hub} can fly this yet — you'll need one with ${int(sel.d)}+ km range.`}
      </div>
    </div>
  );
}
