// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md §K): Contracts › Network, the list of our scheduled routes and the
// catalogue of markets. Secondary to ACMI: a calm list, one row a route. Loaded lazily with its own stylesheet.

import '../../../styles/acmi/v019.css';
import { ChevronRight, ClipboardList, Compass, Earth, Globe2, Plane, PlusCircle, Route as RouteIcon } from 'lucide-react';
import { useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { flag } from '../../../data/countries';
import { ROUTE_MARKETS, type RouteMarket } from '../../../data/routes';
import { typeOf } from '../../../engine/core/perf';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { marketById, reopenStudy, routeIdeas, studyList, validStudyFor, type StudyRow } from '../../../engine/network';
import type { Route } from '../../../engine/network/types';
import { Bar, Empty } from '../../components/ui';
import { int, money, moneyDelta, pct } from '../../format';
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

const STUDY_WORD: Record<StudyRow['state'], [string, string]> = {
  waiting: ['Waiting for you', 'warn'], running: ['Under way', 'info'], shelved: ['Shelved', 'info'], launched: ['Launched', 'good'], expired: ['Ran out', ''], stopped: ['Stopped', ''],
};

/** The name of a study's city pair. */
function pairName(marketId: string): string {
  const m = marketById(marketId);
  if (!m) return marketId;
  return `${AIRPORT_BY_CODE[m.from]?.city ?? m.from} – ${m.city}${m.stopover ? ` via ${AIRPORT_BY_CODE[m.stopover.at]?.city ?? m.stopover.at}` : ''}`;
}

/** v0.21 opens a shelved, still-good study at its business case (free), then its dialog. */
export function showStudy(routeId: string): void {
  const res = store.act((gg) => {
    const why = reopenStudy(gg, routeId);
    return why ? { ok: false, error: why } : { ok: true };
  });
  if (res.ok) store.openModal({ kind: 'routeLaunch', routeId });
}

/** v0.21 every market study in one place (report bmwbir591j4cw): under way, waiting, shelved and still good, used, run out. */
function Studies({ g }: { g: GameState }) {
  const rev = g.network?.rev ?? 0;
  const day = Math.floor(g.now / 1440);
  const list = useMemo(() => studyList(g), [g, rev, day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  return (
    <>
      <div className="row between wrap gap-8 nw-open"><span className="upper dim row gap-6"><ClipboardList className="sc-ico-s" /> Studies</span></div>
      <div className="card nw-studies">
        {list.map((x) => {
          const [word, tone] = STUDY_WORD[x.state];
          const dead = x.state === 'expired' || x.state === 'stopped';
          const open = () => (x.state === 'shelved' ? showStudy(x.routeId) : x.state === 'launched' && g.network?.routes[x.routeId]?.status !== 'launching' ? store.openModal({ kind: 'route', routeId: x.routeId }) : store.openModal({ kind: 'routeLaunch', routeId: x.routeId }));
          return (
            <button key={x.routeId} className="nw-study" disabled={dead} onClick={open} aria-label={`${pairName(x.marketId)}: ${x.state === 'shelved' ? 'show study' : word}`}>
              <span className={`nw-chip ${tone}`}>{word}</span>
              <span className="col grow">
                <b className="ellipsis">{pairName(x.marketId)}</b>
                <span className="tiny muted ellipsis">{x.est ? `${int(x.est.p50)} travellers a week (${int(x.est.p10)}–${int(x.est.p90)})` : x.due !== undefined ? `results by ${fmtDay(x.due)}` : ''}{x.done !== undefined ? ` · done ${fmtDay(x.done)}` : ''}</span>
              </span>
              {x.state === 'shelved' && x.validUntil !== undefined && <span className="nw-valid tiny">Valid until {fmtDay(x.validUntil)}</span>}
              {x.state === 'expired' && x.validUntil !== undefined && <span className="tiny dim nowrap">ran out {fmtDay(x.validUntil)}</span>}
              {x.state === 'shelved' && <span className="small accent nowrap">Show study</span>}
              {!dead && <ChevronRight className="sc-ico-s dim" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** v0.21 the network planner's shortlist of pairs worth a study (only with a planner on the team). */
function Ideas({ g }: { g: GameState }) {
  const h = g.heads?.netPlanner;
  const month = Math.floor(g.now / (1440 * 30));
  const ideas = useMemo(() => routeIdeas(g), [g.network?.rev, month, h?.hired?.since, h?.on, Object.keys(g.fleet).length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!h?.hired || !h.on || !ideas.length) return null;
  return (
    <>
      <div className="row between wrap gap-8 nw-open"><span className="upper dim row gap-6"><Earth className="sc-ico-s" /> Worth a study, says {h.hired.name.split(' ')[0]}</span></div>
      <div className="card nw-studies">
        {ideas.map((x) => (
          <button key={x.marketId} className="nw-study" onClick={() => store.openModal({ kind: 'routeBuild', from: x.from, to: x.to })}>
            <span className="nw-flag" aria-hidden>{flag(AIRPORT_BY_CODE[x.to]?.country ?? '')}</span>
            <span className="col grow">
              <b className="ellipsis">{AIRPORT_BY_CODE[x.from]?.city ?? x.from} – {AIRPORT_BY_CODE[x.to]?.city ?? x.to}</b>
              <span className="tiny muted ellipsis">{x.why}</span>
            </span>
            <span className="small num nowrap">first guess {pct(x.margin)} <span className="tiny muted">on the {typeOf(x.typeId)?.short ?? x.typeId}</span></span>
            <ChevronRight className="sc-ico-s dim" />
          </button>
        ))}
      </div>
    </>
  );
}

function MarketRow({ g, m }: { g: GameState; m: RouteMarket }) {
  const block = marketBlock(g, m);
  const greyed = !!m.closed;
  // v0.21 a shelved study of this market still good: show it, never sell a second one.
  const kept = block ? undefined : validStudyFor(g, m.id);
  if (kept) {
    return (
      <button className="nw-market" onClick={() => showStudy(kept.id)}>
        <span className="nw-flag" aria-hidden>{flag(AIRPORT_BY_CODE[m.to]?.country ?? '')}</span>
        <span className="col grow nw-market-text">
          <span className="row gap-8"><b className="ellipsis">{m.city}</b><span className="mono tiny muted nowrap">{routeCode(m)}</span></span>
          <span className="tiny muted nw-market-blurb">{m.blurb}</span>
        </span>
        <span className="nw-valid tiny">Valid until {fmtDay(kept.study?.validUntil ?? 0)}</span>
        <span className="small accent nowrap">Show study</span>
        <ChevronRight className="sc-ico-s dim" />
      </button>
    );
  }
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
      <Studies g={g} />
      <Ideas g={g} />
      <div className="row between wrap gap-8 nw-open">
        <span className="upper dim row gap-6"><Globe2 className="sc-ico-s" /> Suggested markets, researched</span>
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'routeLaunch' })}><PlusCircle /> Open a new route</button>
      </div>
      <div className="card nw-markets">{markets.map((m) => <MarketRow key={m.id} g={g} m={m} />)}</div>
      <button className="card nw-build-card" onClick={() => store.openModal({ kind: 'routeBuild' })} aria-label="Build your own route to any destination">
        <Compass className="accent" aria-hidden />
        <span className="col grow"><b>Build your own route</b><span className="small muted">Any destination in the world from one of our bases, with fuel stops where the aircraft needs them. Not researched: the study tells how many would fly.</span></span>
        <ChevronRight className="sc-ico-s dim" />
      </button>
      <div className="tiny dim row gap-6 nw-foot"><Plane className="sc-ico-s" /> Route flights sit on the Schedule beside your ACMI work. When a job wants the aircraft, you choose: swap, sub-charter, move or cancel.</div>
    </div>
  );
}
