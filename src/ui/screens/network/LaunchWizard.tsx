// v0.19 the launch wizard (docs/UPDATE-0.19.md §C, §K): choose a market, order the study, then follow the eleven
// stages in game time with one decision at a time (the business case: go, change the plan, or shelve). It can be
// closed and reopened; the stages run while it is shut.

import { ArrowLeft, BarChart3, Building2, CalendarClock, Check, ChevronRight, Flag as FlagIcon, Plane, Play, Rocket, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { flag } from '../../../data/countries';
import { ROUTE_MARKETS, type RouteMarket } from '../../../data/routes';
import { BAL } from '../../../engine/core/balance';
import { typeOf } from '../../../engine/core/perf';
import { DAY, fmtDayRel, fmtSpan } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import type { FareLevel, MarketingLevel, Route, RouteModel, StudyDepth } from '../../../engine/network/types';
import { Modal, Seg, Stepper } from '../../components/ui';
import { int, money, moneyDelta, pct } from '../../format';
import { store, useGame } from '../../store';
import { LaunchProgress } from './bits';
import { net, type BusinessCase, type CaseDraft, type Recommendation } from './netApi';
import { DAY_SHORT, daysOf, hhmm, marketBlock, MODEL_HINT, routeCode, routeName, seriesWords, STAGE_LABEL } from './networkLogic';

const MODEL_WORD: Record<RouteModel, string> = { own: 'Own brand', partner: 'For a partner', tour: 'Holidays charter' };
const DEPTHS: StudyDepth[] = ['desk', 'full', 'survey'];
const DEPTH_WORD: Record<StudyDepth, string> = { desk: 'Desk study', full: 'Full study', survey: 'Full + survey' };
const DEPTH_HINT: Record<StudyDepth, string> = {
  desk: 'Published traffic data and rivals\' timetables. Cheap and quick, but it can be well off.',
  full: 'Booking data, the diaspora associations, government and NGO interviews.',
  survey: 'The full study plus a passenger survey: the closest estimate.',
};

type StudyCfg = { days: [number, number]; cost: number; accuracy: number };
function studyCfg(d: StudyDepth): StudyCfg | null {
  const s = (BAL as unknown as { v019?: { launch?: { study?: Record<string, StudyCfg> } } }).v019?.launch?.study?.[d];
  return s ?? null;
}

function MarketFacts({ m }: { m: RouteMarket }) {
  const rivals = m.competitors.filter((c) => c.stops === 0);
  const tt = m.timetable;
  const when = tt.pattern === 'monthly' ? `Monthly, first ${DAY_SHORT[tt.day]}` : `Weekly, ${DAY_SHORT[tt.day]}`;
  const cargo = [m.cargo.south ? `${Math.round(m.cargo.south / 100) / 10} t south` : '', m.cargo.north ? `${Math.round(m.cargo.north / 100) / 10} t north` : 'none north', m.cargo.avi ? `live animals ${Math.round(m.cargo.avi / 100) / 10} t` : ''].filter(Boolean).join(' · ');
  return (
    <div className="nw-facts">
      <div><span>Travellers a year</span><b className="num">{int(m.odPerYear)}</b></div>
      <div><span>Nonstop rivals</span><b>{rivals.length ? rivals.map((c) => `${c.name} ${c.perWeek}/wk`).join(', ') : 'none'}</b></div>
      <div><span>Economy fares</span><b className="num">{m.fareY[0] === m.fareY[1] ? money(m.fareY[0]) : `${money(m.fareY[0])}–${money(m.fareY[1])}`} one way</b></div>
      <div><span>Cargo a rotation</span><b>{cargo}</b></div>
      <div><span>Usual timetable</span><b>{when}, {hhmm(tt.out)}{tt.nights ? `, ${tt.nights} night${tt.nights > 1 ? 's' : ''} there` : ', back the same day'}</b></div>
      <div><span>How it is sold</span><b>{m.models.map((x) => MODEL_WORD[x]).join(' or ')}</b></div>
    </div>
  );
}

/** Step 1 without a route: pick a market, the model and the study depth. */
function NewLaunch({ g, marketId }: { g: GameState; marketId?: string }) {
  const [mid, setMid] = useState<string | undefined>(marketId);
  const m = mid ? ROUTE_MARKETS.find((x) => x.id === mid) : undefined;
  const [model, setModel] = useState<RouteModel | undefined>(undefined);
  const [depth, setDepth] = useState<StudyDepth>('full');
  const close = () => store.closeModal();
  if (!m) {
    return (
      <Modal title="Open a new route" icon={<Rocket className="accent" />} onClose={close} size="wide" className="nw-modal">
        <p className="small muted">Pick a market. A route takes four to six months from the study to the first flight, longer with setbacks.</p>
        <div className="nw-markets nw-pick">
          {ROUTE_MARKETS.map((x) => {
            const block = marketBlock(g, x);
            return (
              <button key={x.id} className={`nw-market ${x.closed ? 'off' : ''}`} disabled={!!block} onClick={() => setMid(x.id)}>
                <span className="nw-flag" aria-hidden>{flag(AIRPORT_BY_CODE[x.to]?.country ?? '')}</span>
                <span className="col grow nw-market-text">
                  <span className="row gap-8"><b>{x.city}</b><span className="mono tiny muted">{routeCode(x)}</span></span>
                  <span className="tiny muted nw-market-blurb">{block ?? x.blurb}</span>
                </span>
                {!block && <ChevronRight className="sc-ico-s dim" />}
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }
  const block = marketBlock(g, m);
  const mdl = model ?? m.model;
  const cfg = studyCfg(depth);
  const go = () => {
    const r = store.act((gg) => {
      const res = net.startStudy(gg, m.id, depth, mdl);
      return res.routeId ? { ok: true, msg: `Study started: ${m.city}` } : { ok: false, error: res.why ?? 'Could not start the study.' };
    });
    if (r.ok) {
      const id = Object.values(store.game?.network?.routes ?? {}).find((x) => x.marketId === m.id && x.status !== 'closed')?.id;
      if (id) store.openModal({ kind: 'routeLaunch', routeId: id });
      else store.closeModal();
    }
  };
  return (
    <Modal title={`${AIRPORT_BY_CODE[m.from]?.city ?? m.from} – ${m.city}`} icon={<Rocket className="accent" />} onClose={close} size="wide" className="nw-modal" footer={
      <>
        {!marketId && <button className="btn btn-ghost" onClick={() => setMid(undefined)}><ArrowLeft /> Markets</button>}
        <span className="grow" />
        <button className="btn" onClick={close}>Not now</button>
        <button className="btn btn-primary" disabled={!!block} onClick={go}><Play /> Order the study{cfg ? ` · ${money(cfg.cost)}` : ''}</button>
      </>
    }>
      <div className="col gap-12">
        <div className="row gap-8 small muted"><span aria-hidden>{flag(AIRPORT_BY_CODE[m.to]?.country ?? '')}</span><span>{m.country}</span><span className="mono">{routeCode(m)}</span>{m.via?.length ? <span>fuel stop {m.via.join(', ')}</span> : null}</div>
        <p className="small nw-blurb">{m.blurb}</p>
        {block && <div className="small warn">{block}</div>}
        <MarketFacts m={m} />
        {m.models.length > 1 && (
          <div className="col gap-6">
            <span className="upper dim">How we sell it</span>
            <Seg<RouteModel> value={mdl} onChange={setModel} options={m.models.map((x) => ({ value: x, label: x === 'partner' && m.partner ? `For ${m.partner.name}` : MODEL_WORD[x] }))} />
            <span className="tiny muted">{MODEL_HINT[mdl]}</span>
          </div>
        )}
        {m.models.length === 1 && <div className="tiny muted">{m.models[0] === 'partner' && m.partner ? `Flown for ${m.partner.name}. ` : ''}{MODEL_HINT[m.models[0]]}</div>}
        <div className="col gap-6">
          <span className="upper dim">Step 1 · Market study</span>
          <div className="nw-depths">
            {DEPTHS.map((d) => {
              const c = studyCfg(d);
              return (
                <button key={d} className={`nw-depth ${depth === d ? 'on' : ''}`} onClick={() => setDepth(d)} aria-pressed={depth === d}>
                  <b>{DEPTH_WORD[d]}</b>
                  {c && <span className="small num">{money(c.cost)} · {fmtSpan(Math.max(1, Math.round(c.days[0] / 7)), Math.max(1, Math.round(c.days[1] / 7)), 'weeks')}</span>}
                  {c && <span className="tiny muted">estimate within ±{Math.round(c.accuracy * 100)} %</span>}
                  <span className="tiny muted">{DEPTH_HINT[d]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="tiny dim row gap-6"><CalendarClock className="sc-ico-s" /> Then: business case · traffic rights · slots · brand · distribution · timetable on sale · campaign · station contracts · crew briefings · first flight.</div>
      </div>
    </Modal>
  );
}

const GAUGE_WORD = { narrow: 'a narrowbody', mid: 'a mid-size widebody', big: 'a big widebody' } as const;

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const words = seriesWords({ days: rec.days, every: rec.every ?? 1, monthly: rec.monthly });
  const type = (() => { try { return typeOf(rec.typeId).name; } catch { return rec.typeId; } })();
  return (
    <div className="nw-rec">
      <div className="row gap-8"><BarChart3 className="sc-ico-s accent" /><b className="small">The study recommends</b></div>
      <div className="nw-rec-line"><b>{words}</b> · leaves {hhmm(rec.out)} · {GAUGE_WORD[rec.gauge]} ({type}) · {MODEL_WORD[rec.model]}</div>
      <ul className="tiny muted nw-why">{rec.why.slice(0, 4).map((w) => <li key={w}>{w}</li>)}</ul>
      {rec.months && rec.months.length === 12 && <MonthRanges months={rec.months} />}
    </div>
  );
}

const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
function MonthRanges({ months }: { months: { p10: number; p50: number; p90: number }[] }) {
  const max = Math.max(1, ...months.map((x) => x.p90));
  return (
    <div className="nw-ranges" aria-label="Expected travellers a week by month (low to high)">
      {months.map((x, i) => (
        <div key={i} className="nw-range" title={`${int(x.p10)}–${int(x.p90)} a week, most likely ${int(x.p50)}`}>
          <div className="nw-range-bar">
            <span className="lo" style={{ bottom: `${(x.p10 / max) * 100}%`, height: `${((x.p90 - x.p10) / max) * 100}%` }} />
            <span className="mid" style={{ bottom: `${(x.p50 / max) * 100}%` }} />
          </div>
          <span className="tiny dim">{MON[i]}</span>
        </div>
      ))}
    </div>
  );
}

function CaseTable({ c }: { c: BusinessCase }) {
  const rows: [string, (b: BusinessCase['p50']) => string][] = [
    ['Passengers a flight', (b) => int(b.paxPerSector)],
    ['Load factor', (b) => pct(b.lf)],
    ['Revenue', (b) => money(b.rev)],
    ['Costs', (b) => money(b.cost)],
    ['Result', (b) => moneyDelta(b.result)],
    ['Margin', (b) => pct(b.margin)],
  ];
  return (
    <table className="nw-case">
      <thead><tr><th /><th>Low</th><th>Likely</th><th>High</th></tr></thead>
      <tbody>
        {rows.map(([k, f]) => (
          <tr key={k}><td className="muted">{k}</td><td className="num">{f(c.p10)}</td><td className="num"><b>{f(c.p50)}</b></td><td className="num">{f(c.p90)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

const FARE_WORD: Record<FareLevel, string> = { low: 'Low', market: 'Market', high: 'High' };
const MKT_WORD: Record<MarketingLevel, string> = { low: 'Low', normal: 'Normal', high: 'High' };

/** The plan's knobs: days, departure time, aircraft type, fares, campaign. */
function DraftEditor({ g, m, d, set }: { g: GameState; m: RouteMarket | undefined; d: CaseDraft; set: (x: CaseDraft) => void }) {
  const types = useMemo(() => {
    const ids = new Set(Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').map((a) => a.typeId));
    ids.add(d.typeId);
    return [...ids];
  }, [g, d.typeId]);
  const monthly = !!d.monthly;
  const toggleDay = (i: number) => {
    const days = d.days ^ (1 << i);
    if (days) set({ ...d, days });
  };
  return (
    <div className="nw-draft">
      <div className="nw-draft-row">
        <span className="small muted">How often</span>
        <Seg<string> value={monthly ? 'm' : String(d.every)} onChange={(v) => set(v === 'm' ? { ...d, monthly: { nth: 1, weekday: daysOf(d.days)[0] ?? 4 } } : { ...d, monthly: undefined, every: Number(v) })} options={[{ value: '1', label: 'Weekly' }, { value: '2', label: 'Every 2 wk' }, { value: 'm', label: 'Monthly' }]} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Days</span>
        <div className="nw-days" role="group" aria-label="Days of the week">
          {DAY_SHORT.map((n, i) => {
            const on = monthly ? d.monthly!.weekday === i : !!(d.days & (1 << i));
            return <button key={n} className={`nw-day ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => (monthly ? set({ ...d, monthly: { ...d.monthly!, weekday: i }, days: 1 << i }) : toggleDay(i))}>{n.slice(0, 2)}</button>;
          })}
        </div>
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Leaves {m?.from ?? ''}</span>
        <Stepper value={d.out} min={0} max={DAY - 15} step={15} onChange={(v) => set({ ...d, out: v })} format={(v) => `${hhmm(v)} local`} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Nights at {m?.to ?? 'the destination'}</span>
        <Stepper value={d.nights} min={0} max={6} onChange={(v) => set({ ...d, nights: v })} format={(v) => (v ? `${v}` : 'Same day')} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Aircraft</span>
        <select className="nw-select" value={d.typeId} onChange={(e) => set({ ...d, typeId: e.target.value })} aria-label="Aircraft type">
          {types.map((id) => <option key={id} value={id}>{(() => { try { return typeOf(id).name; } catch { return id; } })()}</option>)}
        </select>
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Cabin</span>
        <Seg<string> value={d.layout === 'all-economy' ? 'y' : 'jy'} onChange={(v) => set({ ...d, layout: v === 'y' ? 'all-economy' : 'two-class' })} options={[{ value: 'jy', label: 'Business + economy' }, { value: 'y', label: 'All economy' }]} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Fares</span>
        <Seg<FareLevel> value={d.fares} onChange={(v) => set({ ...d, fares: v })} options={(['low', 'market', 'high'] as FareLevel[]).map((v) => ({ value: v, label: FARE_WORD[v] }))} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Launch campaign</span>
        <Seg<MarketingLevel> value={d.marketing} onChange={(v) => set({ ...d, marketing: v })} options={(['low', 'normal', 'high'] as MarketingLevel[]).map((v) => ({ value: v, label: MKT_WORD[v] }))} />
      </div>
    </div>
  );
}

/** Stage 2: the business case, the recommendation and the player's plan, with Go / Shelve. */
function CaseCard({ g, r }: { g: GameState; r: Route }) {
  const m = ROUTE_MARKETS.find((x) => x.id === r.marketId);
  const rec = useMemo(() => net.recommend(g, r.id), [g.network?.rev, r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<CaseDraft | null>(() => net.defaultDraft(g, r.id) ?? (rec ? {
    model: rec.model, days: rec.days, every: rec.every ?? 1, monthly: rec.monthly, out: rec.out, back: rec.back ?? 0, nights: rec.nights ?? m?.timetable.nights ?? 0, typeId: rec.typeId, fares: 'market', marketing: 'normal',
  } : m ? { model: r.model, days: 1 << m.timetable.day, every: 1, monthly: m.timetable.pattern === 'monthly' ? { nth: 1, weekday: m.timetable.day } : undefined, out: m.timetable.out, back: m.timetable.back, nights: m.timetable.nights, typeId: 'b763', fares: 'market', marketing: 'normal' } : null));
  const c = useMemo(() => (draft ? net.businessCase(g, r.id, draft) : null), [g.network?.rev, r.id, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = (d: 'go' | 'shelve') => {
    const res = store.act((gg) => {
      const why = net.decide(gg, r.id, d, draft ?? undefined);
      return why ? { ok: false, error: why } : { ok: true, msg: d === 'go' ? `${routeName(r)}: launch under way` : `${routeName(r)}: shelved` };
    });
    if (res.ok && d === 'shelve') store.closeModal();
  };
  return (
    <div className="col gap-12">
      {r.study?.est && (
        <div className="nw-est small">Study ({r.study.depth === 'desk' ? 'desk' : r.study.depth === 'full' ? 'full' : 'full + survey'}): <b>{int(r.study.est.p50)}</b> travellers a week both ways, likely between {int(r.study.est.p10)} and {int(r.study.est.p90)}.</div>
      )}
      {rec && <RecommendationCard rec={rec} />}
      {draft && <DraftEditor g={g} m={m} d={draft} set={setDraft} />}
      {c ? (
        <div className="col gap-8">
          <div className="row between"><b className="small">First 12 months</b><span className="tiny muted">launch costs {money(c.launchCost)}</span></div>
          <CaseTable c={c} />
          <div className="small">Break-even at {pct(c.breakEvenLf)} full · {c.paybackWeeks ? `pays back the launch in about ${Math.round(c.paybackWeeks / 4.35)} months` : 'does not pay back the launch in a year'}</div>
          <div className="tiny muted">The same aircraft on ACMI for those hours: about {money(c.acmi)}.</div>
          {c.notes.length > 0 && <ul className="small nw-notes">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      ) : (
        <div className="small muted">The figures appear here as you change the plan.</div>
      )}
      <div className="row gap-8 wrap nw-case-actions">
        <button className="btn btn-primary" onClick={() => decide('go')}><Rocket /> Go: start the launch</button>
        <button className="btn" onClick={() => decide('shelve')}>Shelve it</button>
        <span className="tiny muted">A shelved study stays good for 12 months.</span>
      </div>
    </div>
  );
}

function RouteLaunch({ g, routeId }: { g: GameState; routeId: string }) {
  const r = g.network?.routes[routeId];
  const close = () => store.closeModal();
  if (!r) return <Modal title="Route" onClose={close}><p className="muted">This route no longer exists.</p></Modal>;
  const m = ROUTE_MARKETS.find((x) => x.id === r.marketId);
  const waitingCase = r.status === 'case' || r.stages.some((s) => s.id === 'case' && s.state === 'waiting');
  const slotWait = r.stages.find((s) => s.id === 'slots' && s.state === 'waiting');
  const stop = () => store.openModal({
    kind: 'confirm', danger: true, title: `Stop the ${routeName(r)} launch?`, confirm: 'Stop the launch',
    body: 'Money spent stays spent; the permits and slots lapse. You can start again later with a new study.',
    onConfirm: () => store.act((gg) => {
      const why = net.stopLaunch(gg, r.id);
      return why ? { ok: false, error: why } : { ok: true, msg: `${routeName(r)}: launch stopped` };
    }),
  });
  const live = r.status === 'onSale' || r.status === 'operating';
  return (
    <Modal title={routeName(r)} icon={<Rocket className="accent" />} onClose={close} size="xwide" className="nw-modal nw-launch" footer={
      <>
        {!live && r.status !== 'closed' && net.has('stopLaunch') && <button className="btn btn-ghost btn-danger" onClick={stop}><X /> Stop the launch</button>}
        <span className="grow" />
        {live && <button className="btn" onClick={() => store.openModal({ kind: 'route', routeId: r.id })}><Plane /> Route page</button>}
        <button className="btn btn-primary" onClick={close}>Close</button>
      </>
    }>
      <div className="nw-launch-grid">
        <div className="nw-launch-time">
          <div className="row gap-8 small muted"><span className="mono">{routeCode(m)}</span><span>{r.model === 'partner' && m?.partner ? `for ${m.partner.name}` : MODEL_WORD[r.model]}</span></div>
          <LaunchProgress g={g} r={r} />
          {r.firstFlight && <div className="small nw-first"><FlagIcon className="sc-ico-s accent" /> First flight {fmtDayRel(r.firstFlight, g.now)}</div>}
        </div>
        <div className="nw-launch-now">
          {r.status === 'study' && (
            <div className="nw-wait">
              <Users className="accent" />
              <div><b>The study is under way</b><div className="small muted">{r.stages.find((s) => s.id === 'study')?.due ? `Results ${fmtDayRel(r.stages.find((s) => s.id === 'study')!.due!, g.now)}.` : 'Results in a few weeks.'} It sizes the market by month, finds the anchor customers and recommends days, times and aircraft.</div></div>
            </div>
          )}
          {waitingCase && <CaseCard g={g} r={r} />}
          {!waitingCase && slotWait && (
            <div className="nw-decide">
              <b>Slots: {slotWait.setback ?? 'an answer is waiting'}</b>
              <div className="row gap-8 mt-8">
                <button className="btn btn-primary" onClick={() => store.act((gg) => { const w = net.answerSlot(gg, r.id, true); return w ? { ok: false, error: w } : { ok: true, msg: 'Slot accepted' }; })}><Check /> Accept</button>
                <button className="btn" onClick={() => store.act((gg) => { const w = net.answerSlot(gg, r.id, false); return w ? { ok: false, error: w } : { ok: true, msg: 'Asked again' }; })}>Ask again</button>
              </div>
            </div>
          )}
          {r.status === 'launching' && !waitingCase && !slotWait && (
            <>
              <div className="nw-wait">
                <Building2 className="accent" />
                <div>
                  <b>Now: {r.stages.filter((s) => s.state === 'running' || s.state === 'delayed').map((s) => STAGE_LABEL[s.id]).join(' · ') || 'getting ready'}</b>
                  <div className="small muted">Stages run in game time; setbacks arrive in the Inbox.</div>
                </div>
              </div>
              <div className="nw-facts">
                <div><span>First flight</span><b>{r.firstFlight ? fmtDayRel(r.firstFlight, g.now) : 'to be set'}</b></div>
                <div><span>Spent so far</span><b className="num">{money(r.stages.reduce((a, s) => a + s.cost, 0))}</b></div>
                <div><span>Timetable</span><b>{r.series[0] ? `${seriesWords(r.series[0])}, ${hhmm(r.series[0].out)} local` : '—'}</b></div>
                <div><span>Still to come</span><b>{r.stages.filter((s) => s.state === 'todo').map((s) => STAGE_LABEL[s.id].toLowerCase()).join(', ') || 'nothing'}</b></div>
              </div>
            </>
          )}
          {live && (
            <div className="nw-wait">
              <Plane className="accent" />
              <div><b>{r.status === 'onSale' ? 'On sale' : 'Flying'}</b><div className="small muted">Bookings, loads and money are on the route page.</div></div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function LaunchWizard({ routeId, marketId }: { routeId?: string; marketId?: string }) {
  const g = useGame();
  return routeId ? <RouteLaunch g={g} routeId={routeId} /> : <NewLaunch g={g} marketId={marketId} />;
}
