// v0.19 the route page (docs/UPDATE-0.19.md §J.2, §K): a sheet with Overview · Timetable · Sales · Costs. Loads by
// class, cargo, money per sector and per month with trends, and the controls a route needs (no more).

import { ArrowRightLeft, BarChart3, CalendarClock, CircleSlash, Fuel, Handshake, Megaphone, Pencil, Plane, Plus, Ticket, TrendingUp, Utensils } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { ROUTE_STATIONS } from '../../../data/routes';
import { fmtDay, fmtDayRel, fmtMonth, fmtTime } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import type { FareLevel, MarketingLevel, Rotation, Route } from '../../../engine/network/types';
import { BarChart } from '../../components/charts';
import { Bar, Modal, Seg, Toggle } from '../../components/ui';
import { Help } from '../../components/Help';
import { Term } from '../../components/Term';
import { int, money, moneyDelta, pct } from '../../format';
import { store, useGame } from '../../store';
import { StatusChip, TrendArrow } from './bits';
import { net } from './netApi';
import { sectorCost, type RouteLegCost } from '../../../engine/network/costs';
import {
  cargoLine, chainOf, depWords, history, kg, lastQuarters, lfTone, marketOf, modelLabel, monthBars, ratios, repWord, rotationLoad, rotationResult,
  routeCode, routeName, sectorLoad, seatsLine, seriesAircraft, seriesWords, hhmm, trend, upcoming, launchSpend,
} from './networkLogic';
import { TimetableEditor } from './TimetableEditor';
import { CabinRow } from './CabinChange';
import { confirmCancelRotation } from './live';

type Tab = 'overview' | 'timetable' | 'sales' | 'costs';

function Kpi({ label, value, sub, dir, tone }: { label: string; value: string; sub?: string; dir?: -1 | 0 | 1; tone?: string }) {
  return (
    <div className="nw-kpi">
      <span className="tiny dim upper">{label}</span>
      <b className={`num ${tone ?? ''}`}>{value}{dir !== undefined && <> <TrendArrow dir={dir} /></>}</b>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
}

function RotationLoads({ g, rot, from }: { g: GameState; rot: Rotation; from: string }) {
  const ac = rot.aircraftId ? g.fleet[rot.aircraftId] : undefined;
  const rival = rot.operatedBy ? g.rivals.find((x) => x.id === rot.operatedBy)?.name : undefined;
  return (
    <div className={`nw-rot ${rot.status}`}>
      <div className="nw-rot-head">
        <b className="small nowrap">{depWords(rot.dep, from)}</b>
        <span className="mono tiny muted nowrap">{chainOf(rot)}</span>
        <span className="tiny muted ellipsis">{rival ? `by ${rival}` : ac ? ac.reg : 'no aircraft yet'}</span>
        {rot.moved ? <span className="tiny warn nowrap">moved</span> : null}
      </div>
      <div className="nw-secs">
        {rot.sectors.map((s, i) => {
          const l = sectorLoad(s);
          return (
            <div key={i} className="nw-sec">
              <span className="mono tiny">{s.from}–{s.to}</span>
              <Bar value={l.lf} tone={lfTone(l.lf)} size="thin" />
              <span className="tiny num nowrap">{seatsLine(l)}</span>
              {s.cargoKg > 0 && <span className="tiny muted nowrap">{kg(s.cargoKg)}{s.aviKg ? ' · AVI' : ''}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Overview({ g, r }: { g: GameState; r: Route }) {
  const m = marketOf(r);
  const q = lastQuarters(r, g.now);
  const cur = ratios(q.cur);
  const prev = ratios(q.prev);
  const bars = monthBars(r, g.now);
  const rep = repWord(r.reputation);
  const cmp = useMemo(() => net.acmiCompare(g, r.id), [g.network?.rev, r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = upcoming(r, g.now).slice(0, 8);
  const flown = history(r).slice(0, 8);
  const spend = launchSpend(r);
  return (
    <div className="col gap-14">
      <div className="nw-kpis">
        <Kpi label="Load factor" value={q.months ? pct(cur.lf) : '—'} sub="last 3 months" dir={q.months ? trend(cur.lf, prev.lf).dir : undefined} />
        <Kpi label="Yield" value={q.months ? money(cur.yieldPax) : '—'} sub="ticket revenue a passenger" dir={q.months ? trend(cur.yieldPax, prev.yieldPax).dir : undefined} />
        <Kpi label="Result" value={q.months ? moneyDelta(q.cur.result) : '—'} tone={q.cur.result >= 0 ? 'good' : 'bad'} sub={q.months && q.cur.rev ? `margin ${pct(cur.margin)}` : 'after aircraft and crew time'} dir={q.months ? trend(q.cur.result, q.prev.result).dir : undefined} />
        <Kpi label="Reputation" value={rep.word} tone={rep.tone} sub={`${Math.round(r.reputation)} of 100`} />
      </div>
      <div className="col gap-6">
        <div className="row between"><span className="upper dim">Result by month</span>{spend > 0 && <span className="tiny muted">launch spend {money(spend)}</span>}</div>
        {bars.result.some((v) => v !== 0)
          ? <BarChart values={bars.result} labels={bars.keys.map((k) => fmtMonth(k))} height={150} format={(v) => money(v)} name="Result" />
          : <span className="small muted">No flights flown yet.</span>}
      </div>
      {cmp && <div className="small nw-acmi"><TrendingUp className="sc-ico-s accent" /><span>{cmp}</span></div>}
      <div className="col gap-6">
        <span className="upper dim">Next departures · booked</span>
        {next.length ? next.map((rot) => <RotationLoads key={rot.id} g={g} rot={rot} from={m?.from ?? g.company.homeBase} />) : <span className="small muted">Nothing on sale yet.</span>}
      </div>
      {flown.length > 0 && (
        <div className="col gap-6">
          <span className="upper dim">Last flown</span>
          <div className="nw-flown">
            {flown.map((rot) => {
              const res = rotationResult(rot);
              const l = rotationLoad(rot);
              return (
                <div key={rot.id} className={`nw-flown-row ${rot.status}`}>
                  <span className="small nowrap">{fmtDay(rot.dep)}</span>
                  <span className="mono tiny muted nowrap">{chainOf(rot)}</span>
                  <span className="tiny num ellipsis">{rot.status === 'cancelled' ? 'cancelled' : seatsLine(l)}</span>
                  <span className={`small num nowrap ${res === null ? 'muted' : res >= 0 ? 'good' : 'bad'}`}>{res === null ? '—' : moneyDelta(res)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function rotActions(g: GameState, r: Route, rot: Rotation) {
  const first = rot.sectors.map((s) => s.flightId).find((id) => id && g.flights[id]);
  const f = first ? g.flights[first] : undefined;
  const c = f?.contractId ? g.contracts[f.contractId] : undefined;
  const ids = rot.sectors.map((s) => s.flightId).filter((id): id is string => !!id && g.flights[id]?.status === 'scheduled');
  return {
    move: () => store.openModal({ kind: 'rotationMove', rotId: rot.id, delta: 0, back: { kind: 'route', routeId: r.id, tab: 'timetable' } }),
    cancel: () => confirmCancelRotation(g, r, rot),
    swap: f ? () => store.openModal({ kind: 'sheet', refs: [{ kind: 'flight', id: f.id }] }) : undefined,
    sub: c && ids.length ? () => store.openModal({ kind: 'subcharter', contractId: c.id, flightId: ids[0], flightIds: ids }) : undefined,
  };
}

function TimetableTab({ g, r }: { g: GameState; r: Route }) {
  const m = marketOf(r);
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const rots = upcoming(r, g.now).slice(0, 14);
  const slots = r.slots;
  return (
    <div className="col gap-14">
      <div className="col gap-8">
        <div className="row between"><span className="upper dim">Timetable</span><button className="btn btn-sm" onClick={() => setEdit('new')}><Plus /> Add a series</button></div>
        {edit === 'new' && <TimetableEditor g={g} r={r} onDone={() => setEdit(null)} />}
        {r.series.map((s) => (
          edit === s.id ? <TimetableEditor key={s.id} g={g} r={r} series={s} onDone={() => setEdit(null)} /> : (
            <div key={s.id} className="nw-series">
              <div className="col grow">
                <b className="small">{seriesWords(s)} · {hhmm(s.out)} local{s.nights ? `, ${s.nights} night${s.nights > 1 ? 's' : ''}` : ', same day'}</b>
                <span className="tiny muted">{seriesAircraft(g, s)} · {fmtDayRel(s.from, g.now)} – {fmtDayRel(s.to, g.now)}{s.tail ? ` · ${g.fleet[s.tail]?.reg ?? s.tail}` : ''}</span>
              </div>
              <button className="btn btn-sm" onClick={() => setEdit(s.id)} aria-label="Change this series"><Pencil /> Change</button>
            </div>
          )
        ))}
        {slots && (() => {
          // §D.5 the 80 % rule, on the dates gone by so far (a sub-charter counts as flown, a cancellation does not).
          const past = r.rotations.filter((x) => x.dep < g.now && (x.status === 'flown' || x.status === 'cancelled'));
          const flown = past.filter((x) => x.status === 'flown').length;
          if (!past.length) return <div className="small muted"><Term id="slotSeries">Slots</Term>: held for the season</div>;
          const share = flown / past.length;
          return <div className={`small ${share < 0.8 ? 'warn' : 'muted'}`}><Term id="slotSeries">Slots</Term>: {flown} of {past.length} flown so far ({Math.round(share * 100)} %){share < 0.8 ? ': at risk (80 % keeps them)' : ''}</div>;
        })()}
      </div>
      <div className="col gap-6">
        <span className="upper dim">Rotations</span>
        {!rots.length && <span className="small muted">No rotations planned.</span>}
        {rots.map((rot) => {
          const a = rotActions(g, r, rot);
          const ac = rot.aircraftId ? g.fleet[rot.aircraftId] : undefined;
          const rival = rot.operatedBy ? g.rivals.find((x) => x.id === rot.operatedBy)?.name : undefined;
          const l = rotationLoad(rot);
          return (
            <div key={rot.id} className="nw-rotrow">
              <div className="col grow nw-rotrow-main">
                <span className="small"><b>{depWords(rot.dep, m?.from ?? g.company.homeBase)}</b></span>
                <span className="tiny muted ellipsis">{chainOf(rot)} · {rival ? `operated by ${rival}` : ac ? `${ac.reg} · ${ac.cabin.label}` : 'aircraft picked nearer the day'} · booked {seatsLine(l)}</span>
              </div>
              <div className="nw-rotrow-act">
                <button className="btn btn-sm btn-icon" onClick={a.move} aria-label="Move earlier or later" title="Move earlier or later"><CalendarClock /></button>
                {a.swap && <button className="btn btn-sm btn-icon" onClick={a.swap} aria-label="Swap aircraft" title="Swap aircraft"><ArrowRightLeft /></button>}
                {a.sub && <button className="btn btn-sm btn-icon" onClick={a.sub} aria-label="Sub-charter" title="Sub-charter: another operator flies it, no penalty"><Handshake /></button>}
                <button className="btn btn-sm btn-icon btn-danger" onClick={a.cancel} aria-label="Cancel" title="Cancel this rotation"><CircleSlash /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FARE_WORD: Record<FareLevel, string> = { low: 'Low −12 %', market: 'Market', high: 'High +12 %' };
const MKT_WORD: Record<MarketingLevel, string> = { low: 'Low', normal: 'Normal', high: 'High' };

function SalesTab({ g, r }: { g: GameState; r: Route }) {
  const m = marketOf(r);
  const act = (f: (gg: GameState) => string | null, ok: string) => store.act((gg) => { const w = f(gg); return w ? { ok: false, error: w } : { ok: true, msg: ok }; }, { toastOk: false });
  const block = net.saleBlock(g, r.id);
  const saleOn = r.fares.saleUntil && r.fares.saleUntil > g.now;
  const next = upcoming(r, g.now).slice(0, 10);
  const own = r.model !== 'partner';
  return (
    <div className="col gap-14">
      {!own && <div className="small muted">{modelLabel(g, r)}: the partner sets the fares and sells the seats. We are paid per block hour, plus a share above 70 % full.</div>}
      {own && (
        <div className="nw-setgrid">
          {/* v0.23.1 the cabin: business and economy, or economy only (the comparison before the change). */}
          <CabinRow g={g} r={r} />
          <div className="nw-set"><div><b className="small"><Ticket className="sc-ico-s" /> Fares</b><div className="tiny muted">Cheaper fills more seats; dearer earns more a seat</div></div><Seg<FareLevel> value={r.fares.level} onChange={(v) => act((gg) => net.setFares(gg, r.id, v), 'Fares set')} options={(['low', 'market', 'high'] as FareLevel[]).map((v) => ({ value: v, label: FARE_WORD[v] }))} /></div>
          <div className="nw-set"><div><b className="small"><Megaphone className="sc-ico-s" /> Marketing</b><div className="tiny muted">{money([3_000, 8_000, 15_000][['low', 'normal', 'high'].indexOf(r.marketing)])} a month</div></div><Seg<MarketingLevel> value={r.marketing} onChange={(v) => act((gg) => net.setMarketing(gg, r.id, v), 'Marketing set')} options={(['low', 'normal', 'high'] as MarketingLevel[]).map((v) => ({ value: v, label: MKT_WORD[v] }))} /></div>
          <div className="nw-set"><div><b className="small row gap-6" style={{ alignItems: 'center' }}>Overbook 3 % <Help title="Overbooking">
            Sells a few more seats than the cabin holds, for no-shows. Anyone left behind is compensated and rebooked.
          </Help></b></div><Toggle on={!!r.fares.overbook} onChange={(v) => act((gg) => net.setOverbook(gg, r.id, v), v ? 'Overbooking on' : 'Overbooking off')} label="Overbook 3 %" /></div>
          <div className="nw-set"><div><b className="small">Run a sale</b><div className="tiny muted">{saleOn ? `On until ${fmtDay(r.fares.saleUntil!)}` : block ?? 'Saver fares −25 % for 10 days, $5K of advertising; at most once a month'}</div></div><button className="btn btn-sm" disabled={!!saleOn || !!block} onClick={() => act((gg) => net.runSale(gg, r.id), 'Sale on')}>Start the sale</button></div>
        </div>
      )}
      <div className="col gap-6">
        <span className="upper dim">Bookings, next departures</span>
        {next.length ? next.map((rot) => <RotationLoads key={rot.id} g={g} rot={rot} from={m?.from ?? g.company.homeBase} />) : <span className="small muted">Nothing on sale yet.</span>}
      </div>
    </div>
  );
}

const LINE_WORD: [keyof RouteLegCost, string][] = [
  ['fuel', 'Fuel'], ['fees', 'Airport and passenger charges'], ['handling', 'Ground handling'], ['catering', 'Catering'], ['paxServices', 'Passenger services'],
  ['navCharges', 'Navigation'], ['distribution', 'Distribution (booking systems, agents, cards)'], ['maint', 'Maintenance'],
];

/** §G one sector's cost lines at the last rotation's loads (or the seats half full before one has flown). */
function SectorLines({ g, r }: { g: GameState; r: Route }) {
  const m = marketOf(r);
  const s = r.series[0];
  const last = history(r).find((x) => x.status === 'flown') ?? upcoming(r, g.now)[0];
  if (!m || !s || !last) return null;
  const sec = last.sectors[0];
  const ac = last.aircraftId ? g.fleet[last.aircraftId] ?? null : null;
  const pax = sec.flownY !== undefined ? { j: sec.flownJ ?? 0, y: sec.flownY ?? 0 } : { j: Math.round(sec.capJ / 2), y: Math.round(sec.capY / 2) };
  const c = sectorCost(g, r, sec.from, sec.to, ac?.typeId ?? s.typeId, ac, { ...pax, cargoKg: sec.cargoKg, sold: sec.sold ?? 0 });
  const total = LINE_WORD.reduce((a, [k]) => a + c[k], 0);
  return (
    <div className="col gap-6">
      <span className="upper dim">One sector · {sec.from}–{sec.to} · {pax.j + pax.y} passengers</span>
      <div className="nw-pl">
        {LINE_WORD.map(([k, w]) => <div key={k} className="nw-pl-row"><span className="small">{w}</span><span className="num small muted">{money(c[k])}</span></div>)}
        <div className="nw-pl-row total"><b className="small">Total</b><b className="num">{money(total)}</b></div>
      </div>
    </div>
  );
}

function CostsTab({ g, r }: { g: GameState; r: Route }) {
  const m = marketOf(r);
  const q = lastQuarters(r, g.now);
  const last = history(r).find((x) => x.status === 'flown');
  const stations = [...new Set([m?.from, ...(m?.via ?? []), m?.to, ...(m?.viaBack ?? [])].filter((x): x is string => !!x))];
  const base = m?.from ?? g.company.homeBase;
  const baseCity = AIRPORT_BY_CODE[base]?.city ?? base;
  const act = (on: boolean) => store.act((gg) => { const w = net.setTanker(gg, r.id, on); return w ? { ok: false, error: w } : { ok: true, msg: on ? 'Tankering on' : 'Tankering off' }; }, { toastOk: false });
  const rows: [string, number][] = [
    ['Tickets', q.cur.tickets], ['Cargo and mail', q.cur.cargo], ['Bags, seats and onboard', q.cur.ancillary],
    ['Direct costs', -q.cur.direct], ['Aircraft and crew time', -q.cur.acTime],
  ];
  return (
    <div className="col gap-14">
      <div className="col gap-6">
        <span className="upper dim">Last 3 months</span>
        {q.months ? (
          <div className="nw-pl">
            {rows.map(([k, v]) => <div key={k} className="nw-pl-row"><span className="small">{k}</span><span className={`num small ${v < 0 ? 'muted' : ''}`}>{v < 0 ? `−${money(-v)}` : money(v)}</span></div>)}
            <div className="nw-pl-row total"><b className="small">Result</b><b className={`num ${q.cur.result >= 0 ? 'good' : 'bad'}`}>{moneyDelta(q.cur.result)}</b></div>
            <div className="tiny muted">{int(q.cur.pax)} passengers on {int(q.cur.sectors)} flights · {kg(q.cur.cargoKg)} of cargo · {Math.round(q.cur.bh)} block hours · on time {q.cur.sectors ? pct(q.cur.onTime / q.cur.sectors) : '—'}</div>
          </div>
        ) : <span className="small muted">No month closed yet.</span>}
      </div>
      {last && (
        <div className="col gap-6">
          <span className="upper dim">Last rotation · {fmtDay(last.dep)}</span>
          {last.sectors.map((s, i) => (
            <div key={i} className="nw-pl-row">
              <span className="small"><span className="mono">{s.from}–{s.to}</span> <span className="tiny muted">{seatsLine(sectorLoad(s))}{s.cargoKg ? ` · ${cargoLine(s)}` : ''}</span></span>
              <span className="num small nowrap"><span className="muted">{money(s.rev ?? 0)} in · {money(s.cost ?? 0)} out · </span><b className={(s.rev ?? 0) - (s.cost ?? 0) >= 0 ? 'good' : 'bad'}>{moneyDelta((s.rev ?? 0) - (s.cost ?? 0))}</b></span>
            </div>
          ))}
        </div>
      )}
      <SectorLines g={g} r={r} />
      <div className="col gap-6">
        <span className="upper dim">Stations</span>
        {stations.map((code) => {
          const st = ROUTE_STATIONS[code];
          if (!st) return null;
          return (
            <div key={code} className="nw-station">
              <b className="mono small">{code}</b>
              <span className="tiny muted grow">
                <Fuel className="sc-ico-s" /> fuel {st.fuelX === 1 ? 'at the world price' : `${st.fuelX > 1 ? '+' : '−'}${Math.round(Math.abs(st.fuelX - 1) * 100)} %`}
                {' · '}<Utensils className="sc-ico-s" /> {st.caterer ? 'local catering' : `catered from ${baseCity}`}
                {!st.euCargo && ' · no cargo to Europe'}
                {st.overhead && code !== base ? ` · office ${money(st.overhead)}/month` : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="nw-set"><div><b className="small"><Term id="tankering">Tanker fuel</Term> from {baseCity}</b></div><Toggle on={!!r.tanker} onChange={act} label="Tanker fuel" /></div>
    </div>
  );
}

export function RoutePage({ routeId, tab: tab0 }: { routeId: string; tab?: Tab }) {
  const g = useGame();
  const [tab, setTab] = useState<Tab>(tab0 ?? 'overview');
  const r = g.network?.routes[routeId];
  const close = () => store.closeModal();
  if (!r) return <Modal title="Route" onClose={close}><p className="muted">This route no longer exists.</p></Modal>;
  const m = marketOf(r);
  const s0 = r.series[0];
  return (
    <Modal title={<span className="row gap-8 nw-title"><span className="ellipsis">{routeName(r)}</span><StatusChip r={r} now={g.now} /></span>} icon={<Plane className="accent" />} onClose={close} size="xwide" className="nw-modal nw-route">
      <div className="col gap-12">
        <div className="small muted nw-route-sub">
          <span className="mono">{routeCode(m)}</span> · {modelLabel(g, r)}{s0 ? ` · ${seriesAircraft(g, s0)}` : ''}
          {r.firstFlight && r.firstFlight > g.now ? ` · first flight ${fmtDayRel(r.firstFlight, g.now)} ${fmtTime(r.firstFlight)} UTC` : ''}
        </div>
        <Seg<Tab> value={tab} onChange={setTab} options={[
          { value: 'overview', label: <><BarChart3 className="sc-ico-s" /> Overview</> },
          { value: 'timetable', label: <><CalendarClock className="sc-ico-s" /> Timetable</> },
          { value: 'sales', label: <><Ticket className="sc-ico-s" /> Sales</> },
          { value: 'costs', label: <><Fuel className="sc-ico-s" /> Costs</> },
        ]} />
        {tab === 'overview' && <Overview g={g} r={r} />}
        {tab === 'timetable' && <TimetableTab g={g} r={r} />}
        {tab === 'sales' && <SalesTab g={g} r={r} />}
        {tab === 'costs' && <CostsTab g={g} r={r} />}
      </div>
    </Modal>
  );
}
