// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md §K): Contracts › Network, the list of our scheduled routes and the
// catalogue of markets. Secondary to ACMI: a calm list, one row a route. Loaded lazily with its own stylesheet.

import '../../../styles/acmi/v019.css';
import { ChevronRight, Globe2, Plane, PlusCircle, Route as RouteIcon } from 'lucide-react';
import { useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { flag } from '../../../data/countries';
import { ROUTE_MARKETS, type RouteMarket } from '../../../data/routes';
import type { GameState } from '../../../engine/core/types';
import type { Route } from '../../../engine/network/types';
import { Bar, Empty } from '../../components/ui';
import { money, moneyDelta } from '../../format';
import { store } from '../../store';
import { LaunchProgress, StatusChip, TrendArrow } from './bits';
import {
  depWords, lastQuarters, lfTone, marketBlock, marketOf, modelLabel, networkTotals, repWord, rotationLoad, routeCode, routeName,
  seatsLine, timetableWords, trend, upcoming,
} from './networkLogic';

function RouteRow({ g, r }: { g: GameState; r: Route }) {
  const m = marketOf(r);
  const next = upcoming(r, g.now)[0];
  const load = next ? rotationLoad(next) : null;
  const q = lastQuarters(r, g.now);
  const t = trend(q.cur.result, q.prev.result);
  const rep = repWord(r.reputation);
  const launching = r.status === 'study' || r.status === 'case' || r.status === 'launching';
  const open = () => store.openModal(launching ? { kind: 'routeLaunch', routeId: r.id } : { kind: 'route', routeId: r.id });
  return (
    <button className="card nw-row" onClick={open} aria-label={`${routeName(r)}: open`}>
      <div className="nw-row-head">
        <StatusChip r={r} />
        <b className="nw-row-name ellipsis">{routeName(r)}</b>
        <span className="mono small muted nowrap">{routeCode(m)}</span>
        {!launching && <span className={`small nowrap nw-rep ${rep.tone}`}>{rep.word}</span>}
        <ChevronRight className="sc-ico-s dim nw-row-go" />
      </div>
      <div className="small muted ellipsis">{modelLabel(g, r)} · {timetableWords(r, g.now)}</div>
      {launching ? (
        <LaunchProgress g={g} r={r} compact />
      ) : (
        <div className="nw-row-facts">
          {next && load ? (
            <div className="nw-next">
              <span className="small muted ellipsis">Next {depWords(next.dep, m?.from ?? 'LIS')}</span>
              <div className="nw-lf"><Bar value={load.lf} tone={lfTone(load.lf)} size="thin" /><span className="small num nowrap">{seatsLine(load)}</span></div>
            </div>
          ) : (
            <span className="small muted">No departures planned</span>
          )}
          <div className="nw-res">
            <span className="tiny dim upper">Last 3 months</span>
            <span className={`num nowrap ${q.cur.result >= 0 ? 'good' : 'bad'}`}>{q.months ? moneyDelta(q.cur.result) : '—'} <TrendArrow dir={t.dir} /></span>
          </div>
        </div>
      )}
    </button>
  );
}

function MarketRow({ g, m }: { g: GameState; m: RouteMarket }) {
  const block = marketBlock(g, m);
  const greyed = !!m.closed;
  return (
    <button className={`nw-market ${greyed ? 'off' : ''}`} disabled={greyed || !!block} onClick={() => store.openModal({ kind: 'routeLaunch', marketId: m.id })}>
      <span className="nw-flag" aria-hidden>{flag(AIRPORT_BY_CODE[m.to]?.country ?? '')}</span>
      <span className="col grow nw-market-text">
        <span className="row gap-8"><b className="ellipsis">{m.city}</b><span className="mono tiny muted nowrap">{routeCode(m)}</span></span>
        <span className="tiny muted nw-market-blurb">{block ?? m.blurb}</span>
      </span>
      {!block && <ChevronRight className="sc-ico-s dim" />}
    </button>
  );
}

export default function NetworkView({ g }: { g: GameState }) {
  const rev = g.network?.rev ?? 0;
  const day = Math.floor(g.now / 1440);
  const routes = useMemo(
    () => Object.values(g.network?.routes ?? {}).filter((r) => r.status !== 'closed').sort((a, b) => a.opened - b.opened),
    [g, rev, day], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tot = useMemo(() => networkTotals(g), [g, rev, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const markets = ROUTE_MARKETS;
  return (
    <div className="nw">
      {routes.length > 0 ? (
        <>
          <div className="nw-tiles">
            <div className="card nw-tile"><span className="tiny dim upper">Routes</span><b className="num">{tot.operating}</b><span className="tiny muted">{tot.launching ? `${tot.launching} launching` : 'operating'}</span></div>
            <div className="card nw-tile"><span className="tiny dim upper">Last 3 months</span><b className={`num ${tot.result >= 0 ? 'good' : 'bad'}`}>{tot.months ? moneyDelta(tot.result) : '—'}</b><span className="tiny muted">after aircraft and crew time</span></div>
            <div className="card nw-tile"><span className="tiny dim upper">Tickets sold</span><b className="num">{money(tot.unearned)}</b><span className="tiny muted">cash in, not flown yet</span></div>
          </div>
          <div className="nw-list">{routes.map((r) => <RouteRow key={r.id} g={g} r={r} />)}</div>
        </>
      ) : (
        <Empty icon={<RouteIcon />} title="No scheduled routes">
          Fly your own weekly flights on an aircraft that would otherwise stand idle. Launching one takes months of planning; it earns a modest, steady margin.
        </Empty>
      )}
      <div className="row between wrap gap-8 nw-open">
        <span className="upper dim row gap-6"><Globe2 className="sc-ico-s" /> Markets from Lisbon and Porto</span>
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'routeLaunch' })}><PlusCircle /> Open a new route</button>
      </div>
      <div className="card nw-markets">{markets.map((m) => <MarketRow key={m.id} g={g} m={m} />)}</div>
      <div className="tiny dim row gap-6 nw-foot"><Plane className="sc-ico-s" /> Route flights sit on the Schedule beside your ACMI work. When a job wants the aircraft, you choose: swap, sub-charter, move or cancel.</div>
    </div>
  );
}
